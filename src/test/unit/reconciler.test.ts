import { beforeEach, describe, expect, it } from 'vitest';
import type { FileKind, FileSystemPort } from '../../domain/discovery.js';
import { WorkspaceReconciler } from '../../domain/reconciler.js';
import {
  ProjectRegistry,
  type RegistryStorage,
} from '../../domain/projectRegistry.js';
import type { ProjectEntry } from '../../domain/projectEntry.js';

class MemoryStorage implements RegistryStorage {
  value: unknown;
  private blocker: {
    started: () => void;
    released: Promise<void>;
  } | undefined;

  read(): Promise<unknown> { return Promise.resolve(this.value); }
  async write(entries: readonly ProjectEntry[]): Promise<void> {
    if (this.blocker) {
      const blocker = this.blocker;
      this.blocker = undefined;
      blocker.started();
      await blocker.released;
    }
    this.value = entries;
  }

  blockNextWrite(): { started: Promise<void>; release(): void } {
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    this.blocker = { started: markStarted, released };
    return { started, release };
  }
}

class FakeFileSystem implements FileSystemPort {
  private readonly existing = new Map<string, boolean>();

  setExists(uri: string, exists: boolean): void { this.existing.set(uri, exists); }
  readDirectory(): Promise<readonly [name: string, kind: FileKind][]> {
    return Promise.resolve([]);
  }
  joinPath(baseUri: string, ...segments: string[]): string {
    return [baseUri.replace(/\/$/, ''), ...segments].join('/');
  }
  canonicalize(uri: string): string { return uri; }
  exists(uri: string): Promise<boolean> { return Promise.resolve(this.existing.get(uri) ?? true); }
  parent(uri: string): string { return uri.slice(0, uri.lastIndexOf('/')); }
}

class BlockingFileSystem extends FakeFileSystem {
  private markStarted!: () => void;
  private releaseChecks!: () => void;
  readonly started = new Promise<void>(resolve => { this.markStarted = resolve; });
  private readonly released = new Promise<void>(resolve => { this.releaseChecks = resolve; });
  private hasStarted = false;

  override async exists(uri: string): Promise<boolean> {
    if (!this.hasStarted) {
      this.hasStarted = true;
      this.markStarted();
    }
    await this.released;
    return super.exists(uri);
  }

  release(): void { this.releaseChecks(); }
}

describe('WorkspaceReconciler', () => {
  let fs: FakeFileSystem;
  let storage: MemoryStorage;
  let registry: ProjectRegistry;
  let reconciler: WorkspaceReconciler;

  beforeEach(async () => {
    fs = new FakeFileSystem();
    storage = new MemoryStorage();
    registry = new ProjectRegistry(storage);
    await registry.load();
    reconciler = new WorkspaceReconciler(registry, fs);
  });

  it('merges discoveries without losing manual metadata', async () => {
    const manual = await registry.upsertManualWorkspace('file:///root/a.code-workspace');
    await registry.setAlias(manual.id, 'Alpha');
    await registry.markOpened(manual.id, 123);

    await reconciler.reconcileSource('configured:file:///root', {
      rootUri: 'file:///root',
      status: 'ok',
      workspaceUris: [manual.uri],
    });

    expect(registry.get(manual.id)).toEqual({
      id: manual.id,
      uri: manual.uri,
      kind: 'workspace',
      alias: 'Alpha',
      lastOpenedAt: 123,
      manuallyRegistered: true,
      discoveredFrom: ['configured:file:///root'],
    });
  });

  it('replaces only the scanned source provenance', async () => {
    const uri = 'file:///root/a.code-workspace';
    await reconciler.reconcileSource('configured:file:///root', {
      rootUri: 'file:///root',
      status: 'ok',
      workspaceUris: [uri],
    });
    await reconciler.reconcileSource('current:file:///root/a', {
      rootUri: 'file:///root/a',
      status: 'ok',
      workspaceUris: [uri],
    });

    await reconciler.reconcileSource('configured:file:///root', {
      rootUri: 'file:///root',
      status: 'ok',
      workspaceUris: [],
    });

    expect(registry.get(uri)).toEqual({
      id: uri,
      uri,
      kind: 'workspace',
      manuallyRegistered: false,
      discoveredFrom: ['current:file:///root/a'],
    });
  });

  it('keeps a manual entry when a source stops discovering it', async () => {
    const manual = await registry.upsertManualWorkspace('file:///root/a.code-workspace');
    await reconciler.reconcileSource('configured:file:///root', {
      rootUri: 'file:///root',
      status: 'ok',
      workspaceUris: [manual.uri],
    });

    await reconciler.reconcileSource('configured:file:///root', {
      rootUri: 'file:///root',
      status: 'ok',
      workspaceUris: [],
    });

    expect(registry.get(manual.id)).toEqual({
      id: manual.id,
      uri: manual.uri,
      kind: 'workspace',
      manuallyRegistered: true,
      discoveredFrom: [],
    });
  });

  it('retains source provenance when its scan fails', async () => {
    const uri = 'file:///root/a.code-workspace';
    await reconciler.reconcileSource('configured:file:///root', {
      rootUri: 'file:///root',
      status: 'ok',
      workspaceUris: [uri],
    });

    await reconciler.reconcileSource('configured:file:///root', {
      rootUri: 'file:///root',
      status: 'error',
      workspaceUris: [],
      error: 'denied',
    });

    expect(registry.get(uri)?.discoveredFrom).toEqual(['configured:file:///root']);
  });

  it('removes transient entries from a retired source', async () => {
    const uri = 'file:///root/a.code-workspace';
    await reconciler.reconcileSource('configured:file:///root', {
      rootUri: 'file:///root',
      status: 'ok',
      workspaceUris: [uri],
    });

    await reconciler.retireSource('configured:file:///root');

    expect(registry.list()).toEqual([]);
  });

  it('preserves other provenance when a source is retired', async () => {
    const uri = 'file:///root/a.code-workspace';
    await reconciler.reconcileSource('configured:file:///root', {
      rootUri: 'file:///root',
      status: 'ok',
      workspaceUris: [uri],
    });
    await reconciler.reconcileSource('current:file:///root/a', {
      rootUri: 'file:///root/a',
      status: 'ok',
      workspaceUris: [uri],
    });

    await reconciler.retireSource('configured:file:///root');

    expect(registry.get(uri)?.discoveredFrom).toEqual(['current:file:///root/a']);
  });

  it('preserves manual entries when their source is retired', async () => {
    const manual = await registry.upsertManualWorkspace('file:///root/a.code-workspace');
    await registry.setAlias(manual.id, 'Alpha');
    await reconciler.reconcileSource('configured:file:///root', {
      rootUri: 'file:///root',
      status: 'ok',
      workspaceUris: [manual.uri],
    });

    await reconciler.retireSource('configured:file:///root');

    expect(registry.get(manual.id)).toEqual({
      id: manual.id,
      uri: manual.uri,
      kind: 'workspace',
      alias: 'Alpha',
      manuallyRegistered: true,
      discoveredFrom: [],
    });
  });

  it('removes only confirmed missing entries, including manual ones', async () => {
    const missing = await registry.upsertManualWorkspace('file:///root/missing.code-workspace');
    const existingUri = 'file:///root/existing.code-workspace';
    await reconciler.reconcileSource('configured:file:///root', {
      rootUri: 'file:///root',
      status: 'ok',
      workspaceUris: [existingUri],
    });
    fs.setExists(missing.uri, false);
    fs.setExists(existingUri, true);

    await expect(reconciler.removeMissing()).resolves.toEqual({ removed: 1 });

    expect(registry.list()).toEqual([{
      id: existingUri,
      uri: existingUri,
      kind: 'workspace',
      manuallyRegistered: false,
      discoveredFrom: ['configured:file:///root'],
    }]);
  });

  it('applies confirmed deletions to fresh registry state after pending stats', async () => {
    const blockingFs = new BlockingFileSystem();
    reconciler = new WorkspaceReconciler(registry, blockingFs);
    const missing = await registry.upsertManualWorkspace('file:///root/missing.code-workspace');
    const retained = await registry.upsertManualWorkspace('file:///root/retained.code-workspace');
    blockingFs.setExists(missing.uri, false);
    blockingFs.setExists(retained.uri, true);
    const cleanup = reconciler.removeMissing();
    await blockingFs.started;

    const added = await registry.upsertManualWorkspace('file:///root/added.code-workspace');
    await registry.setAlias(retained.id, 'Retained Alias');
    await reconciler.reconcileSource('current:file:///root/project', {
      rootUri: 'file:///root/project',
      workspaceUris: [retained.uri],
      status: 'ok',
    });
    blockingFs.release();

    await expect(cleanup).resolves.toEqual({ removed: 1 });
    expect(registry.get(missing.id)).toBeUndefined();
    expect(registry.get(retained.id)).toMatchObject({
      alias: 'Retained Alias',
      discoveredFrom: ['current:file:///root/project'],
    });
    expect(registry.get(added.id)).toEqual(added);
  });

  it('reconciles a source against metadata committed by an earlier queued mutation', async () => {
    const uri = 'file:///root/a.code-workspace';
    await reconciler.reconcileSource('configured:file:///root', {
      rootUri: 'file:///root',
      workspaceUris: [uri],
      status: 'ok',
    });
    const blocked = storage.blockNextWrite();
    const alias = registry.setAlias(uri, 'Concurrent Alias');
    await blocked.started;

    const reconciliation = reconciler.reconcileSource('current:file:///root/project', {
      rootUri: 'file:///root/project',
      workspaceUris: [uri],
      status: 'ok',
    });
    blocked.release();
    await Promise.all([alias, reconciliation]);

    expect(registry.get(uri)).toMatchObject({
      alias: 'Concurrent Alias',
      discoveredFrom: ['configured:file:///root', 'current:file:///root/project'],
    });
  });

  it('retires a source against manual registration committed by an earlier queued mutation', async () => {
    const uri = 'file:///root/a.code-workspace';
    await reconciler.reconcileSource('configured:file:///root', {
      rootUri: 'file:///root',
      workspaceUris: [uri],
      status: 'ok',
    });
    const blocked = storage.blockNextWrite();
    const manualRegistration = registry.upsertManualWorkspace(uri);
    await blocked.started;

    const retirement = reconciler.retireSource('configured:file:///root');
    blocked.release();
    await Promise.all([manualRegistration, retirement]);

    expect(registry.get(uri)).toEqual({
      id: uri,
      uri,
      kind: 'workspace',
      manuallyRegistered: true,
      discoveredFrom: [],
    });
  });
});
