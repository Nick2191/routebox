import { isWorkspaceFileUri, type WorkspaceEntry } from './workspaceEntry.js';

export interface RegistryStorage {
  read(): Promise<unknown>;
  write(entries: readonly WorkspaceEntry[]): Promise<void>;
}

function isEntry(value: unknown): value is WorkspaceEntry {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<WorkspaceEntry>;
  return typeof item.id === 'string'
    && typeof item.uri === 'string'
    && isWorkspaceFileUri(item.uri)
    && (item.alias === undefined || typeof item.alias === 'string')
    && typeof item.manuallyRegistered === 'boolean'
    && Array.isArray(item.discoveredFrom)
    && item.discoveredFrom.every(source => typeof source === 'string')
    && (item.lastOpenedAt === undefined || typeof item.lastOpenedAt === 'number');
}

function copyEntry(entry: WorkspaceEntry): WorkspaceEntry {
  return { ...entry, discoveredFrom: [...entry.discoveredFrom] };
}

export class WorkspaceRegistry {
  private entries = new Map<string, WorkspaceEntry>();
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly storage: RegistryStorage) {}

  async load(): Promise<{ discarded: number; reset: boolean }> {
    const stored = await this.storage.read();
    const values = Array.isArray(stored) ? stored : [];
    const valid = values.filter(isEntry);
    this.entries = new Map(valid.map(entry => [entry.id, copyEntry(entry)]));
    return {
      discarded: values.length - valid.length,
      reset: stored !== undefined && !Array.isArray(stored),
    };
  }

  list(): WorkspaceEntry[] { return [...this.entries.values()].map(copyEntry); }

  get(id: string): WorkspaceEntry | undefined {
    const entry = this.entries.get(id);
    return entry ? copyEntry(entry) : undefined;
  }

  async upsertManual(uri: string): Promise<WorkspaceEntry> {
    if (!isWorkspaceFileUri(uri)) throw new Error('Select a .code-workspace file.');
    return this.mutate(candidate => {
      const existing = candidate.get(uri);
      const entry: WorkspaceEntry = existing
        ? { ...existing, manuallyRegistered: true }
        : { id: uri, uri, manuallyRegistered: true, discoveredFrom: [] };
      candidate.set(entry.id, entry);
      return copyEntry(entry);
    });
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

  async replace(entries: readonly WorkspaceEntry[]): Promise<void> {
    const replacements = entries.map(copyEntry);
    await this.mutate(candidate => {
      candidate.clear();
      for (const entry of replacements) candidate.set(entry.id, copyEntry(entry));
    });
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

  private require(entries: ReadonlyMap<string, WorkspaceEntry>, id: string): WorkspaceEntry {
    const entry = entries.get(id);
    if (!entry) throw new Error('Workspace is no longer registered.');
    return entry;
  }

  private mutate<T>(change: (candidate: Map<string, WorkspaceEntry>) => T): Promise<T> {
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
