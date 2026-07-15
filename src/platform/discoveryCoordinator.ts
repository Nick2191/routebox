import { homedir } from 'node:os';
import { FileSystemError, RelativePattern, Uri, workspace, type Disposable } from 'vscode';
import type { DiscoveryResult, FileSystemPort } from '../domain/discovery.js';
import type { ProjectEntry, WorkspaceSourceId } from '../domain/projectEntry.js';

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
  list(): ProjectEntry[];
}

export interface AutomaticRootPolicy {
  allows(rootUri: string): boolean;
}

export class VscodeAutomaticRootPolicy implements AutomaticRootPolicy {
  constructor(private readonly homeUri = Uri.file(homedir()).toString()) {}

  allows(rootUri: string): boolean {
    const root = Uri.parse(rootUri);
    if (this.isFileSystemRoot(root)) return false;
    const home = Uri.parse(this.homeUri);
    if (root.scheme !== home.scheme || root.authority !== home.authority) return true;
    const normalizeCase = (value: string): string => (
      process.platform === 'win32' ? value.toLowerCase() : value
    );
    const rootPath = normalizeCase(root.path).replace(/\/$/, '');
    const homePath = normalizeCase(home.path).replace(/\/$/, '');
    return homePath !== rootPath && !homePath.startsWith(`${rootPath}/`);
  }

  private isFileSystemRoot(uri: Uri): boolean {
    if (uri.path === '/' || /^\/[A-Za-z]:\/?$/.test(uri.path)) return true;
    return uri.scheme === 'file'
      && uri.authority.length > 0
      && uri.path.split('/').filter(Boolean).length <= 1;
  }
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
  automaticRootPolicy?: AutomaticRootPolicy;
  onDidRefresh?: (reason: RefreshReason, result: RefreshResult) => void;
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
  private disposed = false;
  private readonly automaticRootPolicy: AutomaticRootPolicy;

  constructor(private readonly options: DiscoveryCoordinatorOptions) {
    this.automaticRootPolicy = options.automaticRootPolicy ?? new VscodeAutomaticRootPolicy();
  }

  refresh(reason: RefreshReason): Promise<RefreshResult> {
    const result = this.refreshQueue.then(() => (
      this.disposed ? this.emptyResult() : this.performRefresh()
    ));
    const completed = result.then(value => {
      if (!this.disposed) this.options.onDidRefresh?.(reason, value);
      return value;
    });
    this.refreshQueue = completed.then(() => undefined, () => undefined);
    return completed;
  }

  updateWatchers(): void {
    if (this.disposed) return;
    const roots = this.activeRoots();
    const rootsKey = JSON.stringify(roots);
    if (rootsKey === this.watchedRootsKey) return;

    const replacements: Disposable[] = [];
    try {
      for (const root of roots) {
        const watcher = this.createWatcher(root);
        replacements.push(watcher);
        replacements.push(watcher.onDidCreate(() => { this.scheduleWatcherRefresh(); }));
        replacements.push(watcher.onDidDelete(() => { this.scheduleWatcherRefresh(); }));
      }
    } catch (error) {
      this.disposeResources(replacements);
      throw error;
    }

    const previous = this.watcherResources;
    this.watcherResources = replacements;
    this.watchedRootsKey = rootsKey;
    this.disposeResources(previous);
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.disposeWatchers();
    this.watchedRootsKey = '';
  }

  private async performRefresh(): Promise<RefreshResult> {
    if (this.disposed) return this.emptyResult();
    const roots: Array<{ root: string; source: WorkspaceSourceId }> = this.configuredRoots()
      .map(root => ({ root, source: `configured:${root}` }));
    const workspaceFile = this.options.current.workspaceFileUri();
    let currentSource: WorkspaceSourceId | undefined;
    if (workspaceFile) {
      const canonicalWorkspaceFile = this.options.fs.canonicalize(workspaceFile);
      const containing = this.options.fs.parent(canonicalWorkspaceFile);
      const root = this.options.fs.parent(containing);
      if (this.automaticRootPolicy.allows(root)) {
        currentSource = `current:${root}`;
        roots.push({ root, source: currentSource });
      }
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
    const configuredSourcesToRetire = [
      ...new Set([...this.previousConfiguredSources, ...persistedConfiguredSources]),
    ].filter(source => !activeConfiguredSources.has(source));

    const persistedCurrentSources = new Set(
      persistedSources
        .filter((source): source is `current:${string}` => source.startsWith('current:')),
    );
    const currentSourcesToRetire = [...persistedCurrentSources]
      .filter(source => source !== currentSource);

    const errors: DiscoveryResult[] = [];
    const results: Array<{ source: WorkspaceSourceId; result: DiscoveryResult }> = [];
    for (const { root, source } of roots) {
      const scanned = await this.options.discovery.scan(root);
      if (this.disposed) return this.emptyResult();
      const result: DiscoveryResult = {
        ...scanned,
        rootUri: this.options.fs.canonicalize(scanned.rootUri),
        workspaceUris: scanned.workspaceUris.map(uri => this.options.fs.canonicalize(uri)),
      };
      if (result.status === 'error') errors.push(result);
      results.push({ source, result });
    }
    if (this.disposed) return this.emptyResult();
    for (const source of [...configuredSourcesToRetire, ...currentSourcesToRetire]) {
      if (this.disposed) return this.emptyResult();
      await this.options.reconciler.retireSource(source);
    }
    this.previousConfiguredSources = activeConfiguredSources;
    for (const { source, result } of results) {
      if (this.disposed) return this.emptyResult();
      await this.options.reconciler.reconcileSource(source, result);
    }
    if (this.disposed) return this.emptyResult();
    let removed = 0;
    try {
      ({ removed } = await this.options.reconciler.removeMissing());
    } catch (error) {
      if (errors.length === 0 || !(error instanceof FileSystemError)) throw error;
    }
    this.updateWatchers();
    return { removed, errors };
  }

  private activeRoots(): string[] {
    const roots = this.configuredRoots();
    const workspaceFile = this.options.current.workspaceFileUri();
    if (workspaceFile) {
      const containing = this.options.fs.parent(this.options.fs.canonicalize(workspaceFile));
      const automaticRoot = this.options.fs.parent(containing);
      if (this.automaticRootPolicy.allows(automaticRoot)) roots.push(automaticRoot);
    }
    return [...new Set(roots)];
  }

  private configuredRoots(): string[] {
    return [...new Set(
      this.options.settings.configuredRoots()
        .map(root => this.options.fs.canonicalize(root)),
    )];
  }

  private scheduleWatcherRefresh(): void {
    if (this.disposed) return;
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

  private emptyResult(): RefreshResult { return { removed: 0, errors: [] }; }

  private disposeWatchers(): void {
    this.disposeResources(this.watcherResources);
    this.watcherResources = [];
  }

  private disposeResources(resources: readonly Disposable[]): void {
    for (const resource of resources) resource.dispose();
  }
}
