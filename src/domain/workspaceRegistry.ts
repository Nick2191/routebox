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
    && typeof item.manuallyRegistered === 'boolean'
    && Array.isArray(item.discoveredFrom)
    && item.discoveredFrom.every(source => typeof source === 'string');
}

export class WorkspaceRegistry {
  private entries = new Map<string, WorkspaceEntry>();

  constructor(private readonly storage: RegistryStorage) {}

  async load(): Promise<{ discarded: number; reset: boolean }> {
    const stored = await this.storage.read();
    const values = Array.isArray(stored) ? stored : [];
    const valid = values.filter(isEntry);
    this.entries = new Map(valid.map(entry => [entry.id, { ...entry }]));
    return {
      discarded: values.length - valid.length,
      reset: stored !== undefined && !Array.isArray(stored),
    };
  }

  list(): WorkspaceEntry[] { return [...this.entries.values()].map(entry => ({ ...entry })); }

  get(id: string): WorkspaceEntry | undefined {
    const entry = this.entries.get(id);
    return entry ? { ...entry } : undefined;
  }

  async upsertManual(uri: string): Promise<WorkspaceEntry> {
    if (!isWorkspaceFileUri(uri)) throw new Error('Select a .code-workspace file.');
    const existing = this.entries.get(uri);
    const entry: WorkspaceEntry = existing
      ? { ...existing, manuallyRegistered: true }
      : { id: uri, uri, manuallyRegistered: true, discoveredFrom: [] };
    this.entries.set(entry.id, entry);
    await this.persist();
    return { ...entry };
  }

  async setAlias(id: string, alias: string): Promise<void> {
    const entry = this.require(id);
    const clean = alias.trim();
    this.entries.set(id, { ...entry, alias: clean || undefined });
    await this.persist();
  }

  async resetAlias(id: string): Promise<void> { await this.setAlias(id, ''); }

  async removeManual(id: string): Promise<void> {
    const entry = this.require(id);
    if (entry.discoveredFrom.length === 0) this.entries.delete(id);
    else this.entries.set(id, { ...entry, manuallyRegistered: false });
    await this.persist();
  }

  async replace(entries: readonly WorkspaceEntry[]): Promise<void> {
    this.entries = new Map(entries.map(entry => [entry.id, { ...entry }]));
    await this.persist();
  }

  async markOpened(id: string, at: number): Promise<void> {
    const entry = this.require(id);
    this.entries.set(id, { ...entry, lastOpenedAt: at });
    await this.persist();
  }

  private require(id: string): WorkspaceEntry {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('Workspace is no longer registered.');
    return entry;
  }

  private async persist(): Promise<void> { await this.storage.write(this.list()); }
}
