import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileSystemError, Uri } from 'vscode';
import type { DiscoveryResult, FileSystemPort } from '../../domain/discovery.js';
import type { WorkspaceEntry, WorkspaceSourceId } from '../../domain/workspaceEntry.js';
import {
  DiscoveryCoordinator,
  type DiscoveryCoordinatorOptions,
} from '../../platform/discoveryCoordinator.js';
import {
  RelativePattern,
  setFileSystemWatcherFactory,
} from '../adapters/vscode.js';

class FakeFileSystem implements FileSystemPort {
  readonly canonical = new Map<string, string>();

  readDirectory(): Promise<readonly [name: string, kind: 'file' | 'directory' | 'other'][]> {
    return Promise.resolve([]);
  }
  joinPath(baseUri: string, ...segments: string[]): string {
    return [baseUri, ...segments].join('/');
  }
  canonicalize(uri: string): string { return this.canonical.get(uri) ?? uri; }
  exists(): Promise<boolean> { return Promise.resolve(true); }
  parent(uri: string): string { return uri.slice(0, uri.lastIndexOf('/')); }
}

class FakeDiscovery {
  readonly scanned: string[] = [];
  readonly failures = new Set<string>();
  workspaceUris = (rootUri: string): string[] => [`${rootUri}/found.code-workspace`];

  scan(rootUri: string): Promise<DiscoveryResult> {
    this.scanned.push(rootUri);
    if (this.failures.has(rootUri)) {
      return Promise.resolve({
        rootUri,
        workspaceUris: [],
        status: 'error',
        error: `Cannot scan ${rootUri}`,
      });
    }
    return Promise.resolve({
      rootUri,
      workspaceUris: this.workspaceUris(rootUri),
      status: 'ok',
    });
  }
}

class BlockingDiscovery extends FakeDiscovery {
  private releaseFirstScan!: () => void;
  private readonly firstScan = new Promise<void>(resolve => { this.releaseFirstScan = resolve; });

  override async scan(rootUri: string): Promise<DiscoveryResult> {
    this.scanned.push(rootUri);
    if (this.scanned.length === 1) await this.firstScan;
    return { rootUri, workspaceUris: [`${rootUri}/found.code-workspace`], status: 'ok' };
  }

  release(): void { this.releaseFirstScan(); }
}

class FakeRegistry {
  readonly entries: WorkspaceEntry[] = [];

  list(): WorkspaceEntry[] {
    return this.entries.map(entry => ({ ...entry, discoveredFrom: [...entry.discoveredFrom] }));
  }

  seedDiscoveredSource(source: WorkspaceSourceId): void {
    this.entries.push({
      id: `file:///${this.entries.length}.code-workspace`,
      uri: `file:///${this.entries.length}.code-workspace`,
      manuallyRegistered: false,
      discoveredFrom: [source],
    });
  }
}

class FakeReconciler {
  readonly retired: WorkspaceSourceId[] = [];
  readonly reconciled: Array<{ source: WorkspaceSourceId; result: DiscoveryResult }> = [];
  removed = 0;
  removeMissingCount = 0;
  removeMissingError: Error | undefined;

  constructor(private readonly registry: FakeRegistry) {}

  reconcileSource(source: WorkspaceSourceId, result: DiscoveryResult): Promise<void> {
    this.reconciled.push({ source, result });
    if (result.status === 'ok') this.registry.seedDiscoveredSource(source);
    return Promise.resolve();
  }
  retireSource(source: WorkspaceSourceId): Promise<void> {
    this.retired.push(source);
    for (const entry of this.registry.entries) {
      entry.discoveredFrom = entry.discoveredFrom.filter(value => value !== source);
    }
    return Promise.resolve();
  }
  removeMissing(): Promise<{ removed: number }> {
    this.removeMissingCount += 1;
    if (this.removeMissingError) return Promise.reject(this.removeMissingError);
    return Promise.resolve({ removed: this.removed });
  }
}

class FakeWatcher {
  private readonly createListeners = new Set<(uri: Uri) => unknown>();
  private readonly deleteListeners = new Set<(uri: Uri) => unknown>();
  disposed = false;

  get subscriptionCount(): number {
    return this.createListeners.size + this.deleteListeners.size;
  }

  onDidCreate(listener: (uri: Uri) => unknown): { dispose(): void } {
    this.createListeners.add(listener);
    return { dispose: (): void => { this.createListeners.delete(listener); } };
  }

  onDidDelete(listener: (uri: Uri) => unknown): { dispose(): void } {
    this.deleteListeners.add(listener);
    return { dispose: (): void => { this.deleteListeners.delete(listener); } };
  }

  onDidChange(): { dispose(): void } { return { dispose(): void {} }; }

  fireCreate(uri: string): void {
    for (const listener of this.createListeners) listener(Uri.parse(uri));
  }
  fireDelete(uri: string): void {
    for (const listener of this.deleteListeners) listener(Uri.parse(uri));
  }
  dispose(): void { this.disposed = true; }
}

function createHarness(
  discovery: FakeDiscovery = new FakeDiscovery(),
  useDefaultWatcher = false,
): {
  coordinator: DiscoveryCoordinator;
  current: { workspaceFile: string | undefined; workspaceFileUri(): string | undefined };
  discovery: FakeDiscovery;
  fs: FakeFileSystem;
  reconciler: FakeReconciler;
  registry: FakeRegistry;
  settings: { roots: string[]; configuredRoots(): readonly string[] };
  watchedRoots: string[];
  watcherFailures: Set<string>;
  watchers: FakeWatcher[];
} {
  const settings = {
    roots: [] as string[],
    configuredRoots(): readonly string[] { return this.roots; },
  };
  const current = {
    workspaceFile: undefined as string | undefined,
    workspaceFileUri(): string | undefined { return this.workspaceFile; },
  };
  const fs = new FakeFileSystem();
  const registry = new FakeRegistry();
  const reconciler = new FakeReconciler(registry);
  const watchers: FakeWatcher[] = [];
  const watchedRoots: string[] = [];
  const watcherFailures = new Set<string>();
  const options = {
    settings,
    current,
    fs,
    discovery,
    reconciler,
    registry,
  } satisfies Omit<DiscoveryCoordinatorOptions, 'createWatcher'>;
  const createWatcher = (root: string): FakeWatcher => {
    watchedRoots.push(root);
    if (watcherFailures.has(root)) throw new Error(`Cannot watch ${root}`);
    const watcher = new FakeWatcher();
    watchers.push(watcher);
    return watcher;
  };
  const coordinator = new DiscoveryCoordinator({
    ...options,
    ...(useDefaultWatcher ? {} : { createWatcher }),
  });
  return {
    coordinator,
    current,
    discovery,
    fs,
    reconciler,
    registry,
    settings,
    watchedRoots,
    watcherFailures,
    watchers,
  };
}

describe('DiscoveryCoordinator', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('scans every configured root plus the current surrounding root', async () => {
    const { coordinator, current, discovery, settings } = createHarness();
    settings.roots = ['file:///configured'];
    current.workspaceFile = 'file:///worktrees/BOIS-1/bois.code-workspace';

    await coordinator.refresh('manual');

    expect(discovery.scanned).toEqual(['file:///configured', 'file:///worktrees']);
  });

  it('retires the previous transient current source after a workspace change', async () => {
    const { coordinator, current, reconciler } = createHarness();
    current.workspaceFile = 'file:///old/A/a.code-workspace';
    await coordinator.refresh('activation');
    current.workspaceFile = 'file:///new/B/b.code-workspace';

    await coordinator.refresh('workspace-change');

    expect(reconciler.retired).toContain('current:file:///old');
  });

  it('retires transient current sources restored from a previous session', async () => {
    const { coordinator, current, reconciler, registry } = createHarness();
    registry.seedDiscoveredSource('current:file:///stale');
    current.workspaceFile = undefined;

    await coordinator.refresh('activation');

    expect(reconciler.retired).toContain('current:file:///stale');
  });

  it('retires configured sources removed before the current session', async () => {
    const { coordinator, reconciler, registry, settings } = createHarness();
    registry.seedDiscoveredSource('configured:file:///removed');
    settings.roots = ['file:///kept'];

    await coordinator.refresh('activation');

    expect(reconciler.retired).toContain('configured:file:///removed');
  });

  it('retires a configured source removed after a successful refresh on the same instance', async () => {
    const { coordinator, reconciler, settings } = createHarness();
    settings.roots = ['file:///removed'];
    await coordinator.refresh('activation');
    settings.roots = [];

    await coordinator.refresh('settings-change');

    expect(reconciler.retired).toContain('configured:file:///removed');
  });

  it('returns removed entries and scan errors from a manual refresh', async () => {
    const { coordinator, discovery, reconciler, settings } = createHarness();
    settings.roots = ['file:///good', 'file:///unreadable'];
    discovery.failures.add('file:///unreadable');
    reconciler.removed = 3;

    const result = await coordinator.refresh('manual');

    expect(result).toEqual({
      removed: 3,
      errors: [{
        rootUri: 'file:///unreadable',
        workspaceUris: [],
        status: 'error',
        error: 'Cannot scan file:///unreadable',
      }],
    });
    expect(reconciler.removeMissingCount).toBe(1);
  });

  it('preserves inaccessible entries and scan errors when missing-file cleanup is denied', async () => {
    const { coordinator, discovery, reconciler, registry, settings } = createHarness();
    settings.roots = ['file:///inaccessible'];
    registry.seedDiscoveredSource('configured:file:///inaccessible');
    const before = registry.list();
    discovery.failures.add('file:///inaccessible');
    reconciler.removeMissingError = FileSystemError.NoPermissions();

    await expect(coordinator.refresh('manual')).resolves.toEqual({
      removed: 0,
      errors: [{
        rootUri: 'file:///inaccessible',
        workspaceUris: [],
        status: 'error',
        error: 'Cannot scan file:///inaccessible',
      }],
    });
    expect(registry.list()).toEqual(before);
    expect(reconciler.removeMissingCount).toBe(1);
  });

  it('does not hide unexpected cleanup failures behind a scan error', async () => {
    const { coordinator, discovery, reconciler, settings } = createHarness();
    settings.roots = ['file:///unreadable'];
    discovery.failures.add('file:///unreadable');
    const unexpected = new Error('Registry write failed');
    reconciler.removeMissingError = unexpected;

    await expect(coordinator.refresh('manual')).rejects.toBe(unexpected);
  });

  it('canonicalizes every discovered workspace URI before reconciliation', async () => {
    const { coordinator, discovery, fs, reconciler, settings } = createHarness();
    settings.roots = ['file:///root'];
    const discovered = 'file:///root/nested/../found.code-workspace';
    discovery.workspaceUris = (): string[] => [discovered];
    const canonical = 'file:///root/found.code-workspace';
    fs.canonical.set(discovered, canonical);

    await coordinator.refresh('manual');

    expect(reconciler.reconciled[0]?.result.workspaceUris).toEqual([canonical]);
  });

  it('serializes refreshes so a later scan cannot overtake an older scan', async () => {
    const discovery = new BlockingDiscovery();
    const { coordinator, settings } = createHarness(discovery);
    settings.roots = ['file:///first'];
    const first = coordinator.refresh('activation');

    const second = coordinator.refresh('watcher');
    await Promise.resolve();

    expect(discovery.scanned).toEqual(['file:///first']);
    discovery.release();
    await Promise.all([first, second]);
    expect(discovery.scanned).toEqual(['file:///first', 'file:///first']);
  });

  it('does not recreate watchers when queued and in-flight refreshes complete after disposal', async () => {
    const discovery = new BlockingDiscovery();
    const { coordinator, settings, watchers } = createHarness(discovery);
    settings.roots = ['file:///configured'];
    const refresh = coordinator.refresh('activation');
    const queuedRefresh = coordinator.refresh('watcher');
    await Promise.resolve();

    coordinator.dispose();
    discovery.release();
    await Promise.all([refresh, queuedRefresh]);

    expect(watchers).toEqual([]);
  });

  it('debounces watcher bursts into one refresh', async () => {
    vi.useFakeTimers();
    const { coordinator, discovery, settings, watchers } = createHarness();
    settings.roots = ['file:///configured'];
    coordinator.updateWatchers();
    const watcher = watchers[0];
    if (!watcher) throw new Error('Expected a watcher');

    watcher.fireCreate('file:///configured/a.code-workspace');
    watcher.fireDelete('file:///configured/b.code-workspace');
    await vi.advanceTimersByTimeAsync(249);
    expect(discovery.scanned).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(discovery.scanned).toEqual(['file:///configured']);
  });

  it('rebuilds watchers for changed roots and disposes all resources', () => {
    const { coordinator, current, settings, watchedRoots, watchers } = createHarness();
    settings.roots = ['file:///configured'];
    current.workspaceFile = 'file:///old/A/a.code-workspace';
    coordinator.updateWatchers();
    const replaced = [...watchers];

    current.workspaceFile = 'file:///new/B/b.code-workspace';
    coordinator.updateWatchers();

    expect(watchedRoots).toEqual([
      'file:///configured',
      'file:///old',
      'file:///configured',
      'file:///new',
    ]);
    expect(replaced.every(watcher => watcher.disposed)).toBe(true);
    const active = watchers.slice(replaced.length);

    coordinator.dispose();

    expect(active.every(watcher => watcher.disposed)).toBe(true);
  });

  it('keeps the complete watcher set when replacement creation fails and retries later', () => {
    const {
      coordinator,
      settings,
      watcherFailures,
      watchers,
    } = createHarness();
    settings.roots = ['file:///old'];
    coordinator.updateWatchers();
    const oldWatcher = watchers[0];
    if (!oldWatcher) throw new Error('Expected the old watcher');
    settings.roots = ['file:///new', 'file:///broken'];
    watcherFailures.add('file:///broken');

    expect(() => { coordinator.updateWatchers(); }).toThrow('Cannot watch file:///broken');

    const partialWatcher = watchers[1];
    if (!partialWatcher) throw new Error('Expected a partial replacement watcher');
    expect(oldWatcher.disposed).toBe(false);
    expect(oldWatcher.subscriptionCount).toBe(2);
    expect(partialWatcher.disposed).toBe(true);
    expect(partialWatcher.subscriptionCount).toBe(0);

    watcherFailures.clear();
    coordinator.updateWatchers();

    expect(oldWatcher.disposed).toBe(true);
    expect(watchers.slice(2).map(watcher => watcher.subscriptionCount)).toEqual([2, 2]);
    coordinator.dispose();
  });

  it('updates active watchers after a refresh changes the surrounding root', async () => {
    const { coordinator, current, settings, watchedRoots, watchers } = createHarness();
    settings.roots = ['file:///configured'];
    current.workspaceFile = 'file:///old/A/a.code-workspace';
    await coordinator.refresh('activation');
    const oldWatchers = [...watchers];
    current.workspaceFile = 'file:///new/B/b.code-workspace';

    await coordinator.refresh('workspace-change');

    expect(watchedRoots).toEqual([
      'file:///configured',
      'file:///old',
      'file:///configured',
      'file:///new',
    ]);
    expect(oldWatchers.every(watcher => watcher.disposed)).toBe(true);
    coordinator.dispose();
  });

  it('uses a VS Code RelativePattern for the default watcher factory', () => {
    const patterns: RelativePattern[] = [];
    setFileSystemWatcherFactory(pattern => {
      patterns.push(pattern);
      return new FakeWatcher();
    });
    const { coordinator, settings } = createHarness(new FakeDiscovery(), true);
    settings.roots = ['file:///configured'];

    coordinator.updateWatchers();

    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.baseUri.toString(true)).toBe('file:///configured');
    expect(patterns[0]?.pattern).toBe('**/*.code-workspace');
    coordinator.dispose();
  });
});
