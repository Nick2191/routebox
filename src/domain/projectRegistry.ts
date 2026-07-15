import {
  isLocalFileUri,
  isWorkspaceFileUri,
  type ExcludedWorkspace,
  type ProjectEntry,
  type ProjectKind,
} from './projectEntry.js';

export interface ProjectRegistryState {
  entries: ProjectEntry[];
  exclusions: ExcludedWorkspace[];
}

export interface RegistryStorage {
  read(): Promise<unknown>;
  write(state: ProjectRegistryState): Promise<void>;
}

type LoadResult = { discarded: number; reset: boolean; migrated: number };

interface MutableRegistryState {
  entries: Map<string, ProjectEntry>;
  exclusions: Map<string, ExcludedWorkspace>;
}

function copyEntry(entry: ProjectEntry): ProjectEntry {
  return { ...entry, discoveredFrom: [...entry.discoveredFrom] };
}

function copyExclusion(exclusion: ExcludedWorkspace): ExcludedWorkspace {
  return { ...exclusion };
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

function normalizeExclusion(value: unknown): ExcludedWorkspace | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Partial<ExcludedWorkspace>;
  const valid = typeof item.id === 'string'
    && typeof item.uri === 'string'
    && item.id === item.uri
    && item.kind === 'workspace'
    && (item.alias === undefined || typeof item.alias === 'string')
    && (item.lastOpenedAt === undefined || typeof item.lastOpenedAt === 'number')
    && isLocalFileUri(item.uri)
    && isWorkspaceFileUri(item.uri);
  return valid ? { ...(item as ExcludedWorkspace) } : undefined;
}

export class ProjectRegistry {
  private entries = new Map<string, ProjectEntry>();
  private exclusions = new Map<string, ExcludedWorkspace>();
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly storage: RegistryStorage) {}

  async load(): Promise<LoadResult> {
    const stored = await this.storage.read();
    const legacy = Array.isArray(stored);
    const objectState = !legacy && stored && typeof stored === 'object'
      ? stored as Partial<ProjectRegistryState>
      : undefined;
    if (stored !== undefined && !legacy
      && (!objectState || !Array.isArray(objectState.entries)
        || !Array.isArray(objectState.exclusions))) {
      this.entries = new Map();
      this.exclusions = new Map();
      return { discarded: 0, reset: true, migrated: 0 };
    }
    const storedEntries = legacy ? stored : objectState?.entries ?? [];
    const storedExclusions = objectState?.exclusions ?? [];
    const normalized = storedEntries.map(normalizeEntry);
    const valid = normalized.flatMap(result => result.entry ? [result.entry] : []);
    const normalizedExclusions = storedExclusions.map(normalizeExclusion);
    const validExclusions = normalizedExclusions.flatMap(exclusion => exclusion ? [exclusion] : []);
    const migrated = normalized.filter(result => result.migrated).length;
    if (legacy || migrated > 0) {
      await this.storage.write({
        entries: valid.map(copyEntry),
        exclusions: validExclusions.map(copyExclusion),
      });
    }
    this.entries = new Map(valid.map(entry => [entry.id, copyEntry(entry)]));
    this.exclusions = new Map(
      validExclusions.map(exclusion => [exclusion.id, copyExclusion(exclusion)]),
    );
    return {
      discarded: normalized.length - valid.length
        + normalizedExclusions.length - validExclusions.length,
      reset: false,
      migrated,
    };
  }

  list(): ProjectEntry[] { return [...this.entries.values()].map(copyEntry); }

  listExcluded(): ExcludedWorkspace[] {
    return [...this.exclusions.values()].map(copyExclusion);
  }

  isExcluded(id: string): boolean { return this.exclusions.has(id); }

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
      const entry = this.require(candidate.entries, id);
      const clean = alias.trim();
      candidate.entries.set(id, { ...entry, alias: clean || undefined });
    });
  }

  async resetAlias(id: string): Promise<void> { await this.setAlias(id, ''); }

  async removeManual(id: string): Promise<void> {
    await this.mutate(candidate => {
      const entry = this.require(candidate.entries, id);
      if (entry.discoveredFrom.length === 0) candidate.entries.delete(id);
      else candidate.entries.set(id, { ...entry, manuallyRegistered: false });
    });
  }

  removeProject(id: string): Promise<'removed' | 'excluded'> {
    return this.mutate(candidate => {
      const entry = this.require(candidate.entries, id);
      candidate.entries.delete(id);
      if (entry.kind === 'workspace' && entry.discoveredFrom.length > 0) {
        const exclusion: ExcludedWorkspace = {
          id: entry.id,
          uri: entry.uri,
          kind: 'workspace',
          ...(entry.alias === undefined ? {} : { alias: entry.alias }),
          ...(entry.lastOpenedAt === undefined ? {} : { lastOpenedAt: entry.lastOpenedAt }),
        };
        candidate.exclusions.set(id, exclusion);
        return 'excluded';
      }
      return 'removed';
    });
  }

  restoreExcluded(id: string): Promise<ProjectEntry> {
    return this.mutate(candidate => {
      const exclusion = candidate.exclusions.get(id);
      if (!exclusion) throw new Error('Workspace is no longer excluded.');
      const entry: ProjectEntry = {
        ...exclusion,
        manuallyRegistered: true,
        discoveredFrom: [],
      };
      candidate.exclusions.delete(id);
      candidate.entries.set(id, entry);
      return copyEntry(entry);
    });
  }

  async replace(entries: readonly ProjectEntry[]): Promise<void> {
    const replacements = entries.map(copyEntry);
    await this.mutate(candidate => {
      candidate.entries.clear();
      for (const entry of replacements) candidate.entries.set(entry.id, copyEntry(entry));
    });
  }

  async updateEntries(update: (entries: Map<string, ProjectEntry>) => void): Promise<void> {
    await this.mutate(candidate => { update(candidate.entries); });
  }

  async remove(ids: readonly string[]): Promise<number> {
    return this.mutate(candidate => {
      let removed = 0;
      for (const id of ids) {
        if (candidate.entries.delete(id)) removed += 1;
      }
      return removed;
    });
  }

  async markOpened(id: string, at: number): Promise<void> {
    await this.mutate(candidate => {
      const entry = this.require(candidate.entries, id);
      candidate.entries.set(id, { ...entry, lastOpenedAt: at });
    });
  }

  private upsertManual(uri: string, kind: ProjectKind): Promise<ProjectEntry> {
    return this.mutate(candidate => {
      const existing = candidate.entries.get(uri);
      if (existing && existing.kind !== kind) {
        throw new Error('The path is already registered as a different project type.');
      }
      const entry: ProjectEntry = existing
        ? { ...existing, manuallyRegistered: true }
        : { id: uri, uri, kind, manuallyRegistered: true, discoveredFrom: [] };
      candidate.entries.set(entry.id, entry);
      if (kind === 'workspace') candidate.exclusions.delete(entry.id);
      return copyEntry(entry);
    });
  }

  private require(entries: ReadonlyMap<string, ProjectEntry>, id: string): ProjectEntry {
    const entry = entries.get(id);
    if (!entry) throw new Error('Project is no longer registered.');
    return entry;
  }

  private mutate<T>(change: (candidate: MutableRegistryState) => T): Promise<T> {
    const operation = this.mutationQueue.then(async () => {
      const candidate: MutableRegistryState = {
        entries: new Map(
          [...this.entries].map(([id, entry]) => [id, copyEntry(entry)]),
        ),
        exclusions: new Map(
          [...this.exclusions].map(([id, exclusion]) => [id, copyExclusion(exclusion)]),
        ),
      };
      const result = change(candidate);
      await this.storage.write({
        entries: [...candidate.entries.values()].map(copyEntry),
        exclusions: [...candidate.exclusions.values()].map(copyExclusion),
      });
      this.entries = candidate.entries;
      this.exclusions = candidate.exclusions;
      return result;
    });
    this.mutationQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
