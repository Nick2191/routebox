import {
  isLocalFileUri,
  isWorkspaceFileUri,
  type ProjectEntry,
  type ProjectKind,
} from './projectEntry.js';

export interface RegistryStorage {
  read(): Promise<unknown>;
  write(entries: readonly ProjectEntry[]): Promise<void>;
}

type LoadResult = { discarded: number; reset: boolean; migrated: number };

function copyEntry(entry: ProjectEntry): ProjectEntry {
  return { ...entry, discoveredFrom: [...entry.discoveredFrom] };
}

function normalizeEntry(value: unknown): { entry?: ProjectEntry; migrated: boolean } {
  if (!value || typeof value !== 'object') return { migrated: false };
  const item = value as Partial<ProjectEntry>;
  const kind = item.kind === undefined ? 'workspace' : item.kind;
  const sourcesValid = Array.isArray(item.discoveredFrom)
    && item.discoveredFrom.every(source => typeof source === 'string');
  const commonValid = typeof item.id === 'string'
    && typeof item.uri === 'string'
    && (item.alias === undefined || typeof item.alias === 'string')
    && typeof item.manuallyRegistered === 'boolean'
    && sourcesValid
    && (item.lastOpenedAt === undefined || typeof item.lastOpenedAt === 'number');
  const kindValid = kind === 'workspace' || kind === 'folder';
  const localValid = typeof item.uri === 'string' && isLocalFileUri(item.uri);
  const workspaceValid = kind !== 'workspace' || isWorkspaceFileUri(item.uri ?? '');
  const folderValid = kind !== 'folder'
    || (item.manuallyRegistered === true && item.discoveredFrom?.length === 0);
  if (!commonValid || !kindValid || !localValid || !workspaceValid || !folderValid) {
    return { migrated: false };
  }
  return {
    entry: { ...(item as ProjectEntry), kind },
    migrated: item.kind === undefined,
  };
}

export class ProjectRegistry {
  private entries = new Map<string, ProjectEntry>();
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly storage: RegistryStorage) {}

  async load(): Promise<LoadResult> {
    const stored = await this.storage.read();
    if (stored !== undefined && !Array.isArray(stored)) {
      this.entries = new Map();
      return { discarded: 0, reset: true, migrated: 0 };
    }
    const normalized = (stored ?? []).map(normalizeEntry);
    const valid = normalized.flatMap(result => result.entry ? [result.entry] : []);
    const migrated = normalized.filter(result => result.migrated).length;
    if (migrated > 0) await this.storage.write(valid.map(copyEntry));
    this.entries = new Map(valid.map(entry => [entry.id, copyEntry(entry)]));
    return { discarded: normalized.length - valid.length, reset: false, migrated };
  }

  list(): ProjectEntry[] { return [...this.entries.values()].map(copyEntry); }

  get(id: string): ProjectEntry | undefined {
    const entry = this.entries.get(id);
    return entry ? copyEntry(entry) : undefined;
  }

  upsertManualWorkspace(uri: string): Promise<ProjectEntry> {
    if (!isLocalFileUri(uri)) {
      return Promise.reject(new Error('Select a local .code-workspace file.'));
    }
    if (!isWorkspaceFileUri(uri)) {
      return Promise.reject(new Error('Select a .code-workspace file.'));
    }
    return this.upsertManual(uri, 'workspace');
  }

  upsertManualFolder(uri: string): Promise<ProjectEntry> {
    if (!isLocalFileUri(uri)) {
      return Promise.reject(new Error('Select a local folder.'));
    }
    return this.upsertManual(uri, 'folder');
  }

  async setAlias(id: string, alias: string): Promise<void> {
    await this.mutate(candidate => {
      const entry = this.require(candidate, id);
      const clean = alias.trim();
      candidate.set(id, { ...entry, alias: clean || undefined });
    });
  }

  async resetAlias(id: string): Promise<void> { await this.setAlias(id, ''); }

  async removeManual(id: string): Promise<void> {
    await this.mutate(candidate => {
      const entry = this.require(candidate, id);
      if (entry.discoveredFrom.length === 0) candidate.delete(id);
      else candidate.set(id, { ...entry, manuallyRegistered: false });
    });
  }

  async replace(entries: readonly ProjectEntry[]): Promise<void> {
    const replacements = entries.map(copyEntry);
    await this.mutate(candidate => {
      candidate.clear();
      for (const entry of replacements) candidate.set(entry.id, copyEntry(entry));
    });
  }

  async updateEntries(update: (entries: Map<string, ProjectEntry>) => void): Promise<void> {
    await this.mutate(candidate => { update(candidate); });
  }

  async remove(ids: readonly string[]): Promise<number> {
    return this.mutate(candidate => {
      let removed = 0;
      for (const id of ids) {
        if (candidate.delete(id)) removed += 1;
      }
      return removed;
    });
  }

  async markOpened(id: string, at: number): Promise<void> {
    await this.mutate(candidate => {
      const entry = this.require(candidate, id);
      candidate.set(id, { ...entry, lastOpenedAt: at });
    });
  }

  private upsertManual(uri: string, kind: ProjectKind): Promise<ProjectEntry> {
    return this.mutate(candidate => {
      const existing = candidate.get(uri);
      if (existing && existing.kind !== kind) {
        throw new Error('The path is already registered as a different project type.');
      }
      const entry: ProjectEntry = existing
        ? { ...existing, manuallyRegistered: true }
        : { id: uri, uri, kind, manuallyRegistered: true, discoveredFrom: [] };
      candidate.set(entry.id, entry);
      return copyEntry(entry);
    });
  }

  private require(entries: ReadonlyMap<string, ProjectEntry>, id: string): ProjectEntry {
    const entry = entries.get(id);
    if (!entry) throw new Error('Project is no longer registered.');
    return entry;
  }

  private mutate<T>(change: (candidate: Map<string, ProjectEntry>) => T): Promise<T> {
    const operation = this.mutationQueue.then(async () => {
      const candidate = new Map(
        [...this.entries].map(([id, entry]) => [id, copyEntry(entry)]),
      );
      const result = change(candidate);
      await this.storage.write([...candidate.values()].map(copyEntry));
      this.entries = candidate;
      return result;
    });
    this.mutationQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
