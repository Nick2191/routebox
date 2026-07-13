import { RelativePattern, Uri, workspace, type Disposable } from 'vscode';
import type { DiscoveryResult, FileSystemPort } from '../domain/discovery.js';
import type { WorkspaceEntry, WorkspaceSourceId } from '../domain/workspaceEntry.js';

export type RefreshReason =
  | 'activation'
  | 'view-visible'
  | 'manual'
  | 'settings-change'
  | 'watcher'
  | 'workspace-change';

export interface DiscoverySettings {
  configuredRoots(): readonly string[];
}

export interface CurrentWorkspace {
  workspaceFileUri(): string | undefined;
}

interface DiscoveryPort {
  scan(rootUri: string): Promise<DiscoveryResult>;
}

interface ReconcilerPort {
  reconcileSource(source: WorkspaceSourceId, result: DiscoveryResult): Promise<void>;
  retireSource(source: WorkspaceSourceId): Promise<void>;
  removeMissing(): Promise<{ removed: number }>;
}

interface RegistryPort {
  list(): WorkspaceEntry[];
}

export interface WorkspaceWatcher extends Disposable {
  onDidCreate(listener: (uri: Uri) => unknown): Disposable;
  onDidDelete(listener: (uri: Uri) => unknown): Disposable;
}

export interface DiscoveryCoordinatorOptions {
  settings: DiscoverySettings;
  current: CurrentWorkspace;
  fs: FileSystemPort;
  discovery: DiscoveryPort;
  reconciler: ReconcilerPort;
  registry: RegistryPort;
  createWatcher?: (rootUri: string) => WorkspaceWatcher;
}

export interface RefreshResult {
  removed: number;
  errors: DiscoveryResult[];
}

export class DiscoveryCoordinator {
  private previousConfiguredSources = new Set<`configured:${string}`>();
  private refreshQueue: Promise<void> = Promise.resolve();
  private watchedRootsKey = '';
  private watcherResources: Disposable[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: DiscoveryCoordinatorOptions) {}

  refresh(reason: RefreshReason): Promise<RefreshResult> {
    void reason;
    const result = this.refreshQueue.then(() => this.performRefresh());
    this.refreshQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  updateWatchers(): void {
    const roots = this.activeRoots();
    const rootsKey = JSON.stringify(roots);
    if (rootsKey === this.watchedRootsKey) return;

    this.disposeWatchers();
    this.watchedRootsKey = rootsKey;
    for (const root of roots) {
      const watcher = this.createWatcher(root);
      this.watcherResources.push(
        watcher,
        watcher.onDidCreate(() => { this.scheduleWatcherRefresh(); }),
        watcher.onDidDelete(() => { this.scheduleWatcherRefresh(); }),
      );
    }
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.disposeWatchers();
    this.watchedRootsKey = '';
  }

  private async performRefresh(): Promise<RefreshResult> {
    const roots: Array<{ root: string; source: WorkspaceSourceId }> = this.options.settings
      .configuredRoots()
      .map(value => this.options.fs.canonicalize(value))
      .map(root => ({ root, source: `configured:${root}` }));
    const workspaceFile = this.options.current.workspaceFileUri();
    let currentSource: WorkspaceSourceId | undefined;
    if (workspaceFile) {
      const canonicalWorkspaceFile = this.options.fs.canonicalize(workspaceFile);
      const containing = this.options.fs.parent(canonicalWorkspaceFile);
      const root = this.options.fs.parent(containing);
      currentSource = `current:${root}`;
      roots.push({ root, source: currentSource });
    }

    const persistedSources = this.options.registry.list().flatMap(entry => entry.discoveredFrom);
    const activeConfiguredSources = new Set(
      roots.map(({ source }) => source).filter(
        (source): source is `configured:${string}` => source.startsWith('configured:'),
      ),
    );
    const persistedConfiguredSources = persistedSources.filter(
      (source): source is `configured:${string}` => source.startsWith('configured:'),
    );
    for (const source of new Set([...this.previousConfiguredSources, ...persistedConfiguredSources])) {
      if (!activeConfiguredSources.has(source)) await this.options.reconciler.retireSource(source);
    }
    this.previousConfiguredSources = activeConfiguredSources;

    const persistedCurrentSources = new Set(
      persistedSources
        .filter((source): source is `current:${string}` => source.startsWith('current:')),
    );
    for (const source of persistedCurrentSources) {
      if (source !== currentSource) await this.options.reconciler.retireSource(source);
    }

    const errors: DiscoveryResult[] = [];
    for (const { root, source } of roots) {
      const scanned = await this.options.discovery.scan(root);
      const result: DiscoveryResult = {
        ...scanned,
        rootUri: this.options.fs.canonicalize(scanned.rootUri),
        workspaceUris: scanned.workspaceUris.map(uri => this.options.fs.canonicalize(uri)),
      };
      if (result.status === 'error') errors.push(result);
      await this.options.reconciler.reconcileSource(source, result);
    }
    const { removed } = await this.options.reconciler.removeMissing();
    this.updateWatchers();
    return { removed, errors };
  }

  private activeRoots(): string[] {
    const roots = this.options.settings.configuredRoots()
      .map(root => this.options.fs.canonicalize(root));
    const workspaceFile = this.options.current.workspaceFileUri();
    if (workspaceFile) {
      const containing = this.options.fs.parent(this.options.fs.canonicalize(workspaceFile));
      roots.push(this.options.fs.parent(containing));
    }
    return [...new Set(roots)];
  }

  private scheduleWatcherRefresh(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.refresh('watcher').catch(() => undefined);
    }, 250);
  }

  private createWatcher(root: string): WorkspaceWatcher {
    if (this.options.createWatcher) return this.options.createWatcher(root);
    return workspace.createFileSystemWatcher(
      new RelativePattern(Uri.parse(root), '**/*.code-workspace'),
    );
  }

  private disposeWatchers(): void {
    for (const resource of this.watcherResources) resource.dispose();
    this.watcherResources = [];
  }
}
