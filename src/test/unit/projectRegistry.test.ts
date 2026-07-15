import { beforeEach, describe, expect, it } from 'vitest';
import { ProjectRegistry, type RegistryStorage } from '../../domain/projectRegistry.js';
import type { ProjectEntry } from '../../domain/projectEntry.js';

class MemoryStorage implements RegistryStorage {
  value: unknown;
  failNext: Error | undefined;
  readonly writes: ProjectEntry[][] = [];

  read(): Promise<unknown> { return Promise.resolve(this.value); }
  write(entries: readonly ProjectEntry[]): Promise<void> {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = undefined;
      return Promise.reject(error);
    }
    const copy = entries.map(entry => ({ ...entry, discoveredFrom: [...entry.discoveredFrom] }));
    this.writes.push(copy);
    this.value = copy;
    return Promise.resolve();
  }
}

class BlockingFirstWriteStorage extends MemoryStorage {
  private releaseFirst!: () => void;
  private markFirstStarted!: () => void;
  readonly firstStarted = new Promise<void>(resolve => { this.markFirstStarted = resolve; });
  private readonly firstReleased = new Promise<void>(resolve => { this.releaseFirst = resolve; });
  private writeCount = 0;

  override async write(entries: readonly ProjectEntry[]): Promise<void> {
    this.writeCount += 1;
    if (this.writeCount === 1) {
      this.markFirstStarted();
      await this.firstReleased;
    }
    await super.write(entries);
  }

  release(): void { this.releaseFirst(); }
}

function discoveredEntry(): ProjectEntry {
  return {
    id: 'file:///work/a.code-workspace',
    uri: 'file:///work/a.code-workspace',
    kind: 'workspace',
    manuallyRegistered: false,
    discoveredFrom: ['configured:file:///work'],
  };
}

describe('ProjectRegistry', () => {
  let storage: MemoryStorage;
  let registry: ProjectRegistry;

  beforeEach(async () => {
    storage = new MemoryStorage();
    registry = new ProjectRegistry(storage);
    await registry.load();
  });

  it('persists one canonical entry for duplicate manual registration', async () => {
    await registry.upsertManualWorkspace('file:///work/a.code-workspace');
    await registry.upsertManualWorkspace('file:///work/a.code-workspace');
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]!.manuallyRegistered).toBe(true);
  });

  it('sets and resets aliases without changing the URI', async () => {
    const saved = await registry.upsertManualWorkspace('file:///work/a.code-workspace');
    await registry.setAlias(saved.id, 'Alpha');
    expect(registry.get(saved.id)?.alias).toBe('Alpha');
    await registry.resetAlias(saved.id);
    expect(registry.get(saved.id)?.alias).toBeUndefined();
  });

  it('keeps a discovered entry when manual registration is removed', async () => {
    const saved = await registry.upsertManualWorkspace('file:///work/a.code-workspace');
    await registry.replace([{ ...saved, discoveredFrom: ['configured:file:///work'] }]);
    await registry.removeManual(saved.id);
    expect(registry.get(saved.id)?.manuallyRegistered).toBe(false);
  });

  it('isolates discovered sources loaded from storage', async () => {
    const stored = discoveredEntry();
    storage.value = [stored];
    registry = new ProjectRegistry(storage);
    await registry.load();

    stored.discoveredFrom.push('current:file:///work');

    expect(registry.get(stored.id)?.discoveredFrom).toEqual(['configured:file:///work']);
  });

  it('isolates discovered sources replaced by a caller', async () => {
    const replacement = discoveredEntry();
    await registry.replace([replacement]);

    replacement.discoveredFrom.push('current:file:///work');

    expect(registry.get(replacement.id)?.discoveredFrom).toEqual(['configured:file:///work']);
  });

  it('isolates discovered sources returned by get', async () => {
    const entry = discoveredEntry();
    await registry.replace([entry]);
    const returned = registry.get(entry.id)!;

    returned.discoveredFrom.push('current:file:///work');

    expect(registry.get(entry.id)?.discoveredFrom).toEqual(['configured:file:///work']);
  });

  it('isolates discovered sources returned by list', async () => {
    const entry = discoveredEntry();
    await registry.replace([entry]);
    const returned = registry.list()[0]!;

    returned.discoveredFrom.push('current:file:///work');

    expect(registry.list()[0]?.discoveredFrom).toEqual(['configured:file:///work']);
  });

  it('isolates discovered sources returned by manual registration', async () => {
    const returned = await registry.upsertManualWorkspace('file:///work/a.code-workspace');

    returned.discoveredFrom.push('configured:file:///work');

    expect(registry.get(returned.id)?.discoveredFrom).toEqual([]);
  });

  it('drops invalid persisted records but loads valid ones', async () => {
    storage.value = [
      { id: 'file:///a.code-workspace', uri: 'file:///a.code-workspace', kind: 'workspace', manuallyRegistered: true, discoveredFrom: [] },
      { broken: true },
    ];
    registry = new ProjectRegistry(storage);
    const report = await registry.load();
    expect(registry.list()).toHaveLength(1);
    expect(report).toEqual({ discarded: 1, reset: false, migrated: 0 });
  });

  it('discards explicit and legacy non-local project records', async () => {
    storage.value = [
      { id: 'vscode-remote://ssh-remote+host/work/a.code-workspace', uri: 'vscode-remote://ssh-remote+host/work/a.code-workspace', kind: 'workspace', manuallyRegistered: true, discoveredFrom: [] },
      { id: 'vscode-remote://ssh-remote+host/work/folder', uri: 'vscode-remote://ssh-remote+host/work/folder', kind: 'folder', manuallyRegistered: true, discoveredFrom: [] },
      { id: 'vscode-remote://ssh-remote+host/work/legacy.code-workspace', uri: 'vscode-remote://ssh-remote+host/work/legacy.code-workspace', manuallyRegistered: true, discoveredFrom: [] },
    ];
    registry = new ProjectRegistry(storage);

    await expect(registry.load()).resolves.toEqual({
      discarded: 3,
      reset: false,
      migrated: 0,
    });
    expect(registry.list()).toEqual([]);
  });

  it('discards a persisted record with a non-string alias', async () => {
    storage.value = [
      {
        id: 'file:///a.code-workspace',
        uri: 'file:///a.code-workspace',
        kind: 'workspace',
        alias: 42,
        manuallyRegistered: true,
        discoveredFrom: [],
      },
    ];
    registry = new ProjectRegistry(storage);
    expect(await registry.load()).toEqual({ discarded: 1, reset: false, migrated: 0 });
    expect(registry.list()).toEqual([]);
  });

  it('discards a persisted record with a non-number last-opened timestamp', async () => {
    storage.value = [
      {
        id: 'file:///a.code-workspace',
        uri: 'file:///a.code-workspace',
        kind: 'workspace',
        manuallyRegistered: true,
        discoveredFrom: [],
        lastOpenedAt: 'yesterday',
      },
    ];
    registry = new ProjectRegistry(storage);
    expect(await registry.load()).toEqual({ discarded: 1, reset: false, migrated: 0 });
    expect(registry.list()).toEqual([]);
  });

  it('reports an unusable top-level stored value', async () => {
    storage.value = { broken: true };
    registry = new ProjectRegistry(storage);
    expect(await registry.load()).toEqual({ discarded: 0, reset: true, migrated: 0 });
    expect(registry.list()).toEqual([]);
  });

  it('migrates and rewrites legacy workspace records without losing metadata', async () => {
    storage.value = [{
      id: 'file:///work/atlas.code-workspace',
      uri: 'file:///work/atlas.code-workspace',
      alias: 'Atlas',
      manuallyRegistered: true,
      discoveredFrom: ['configured:file:///work'],
      lastOpenedAt: 42,
    }];
    registry = new ProjectRegistry(storage);

    await expect(registry.load()).resolves.toEqual({
      discarded: 0,
      reset: false,
      migrated: 1,
    });
    expect(registry.list()).toEqual([{
      ...(storage.value as ProjectEntry[])[0],
      kind: 'workspace',
    }]);
    expect(storage.writes.at(-1)?.[0]).toMatchObject({
      kind: 'workspace',
      alias: 'Atlas',
      lastOpenedAt: 42,
    });
  });

  it('registers folders idempotently without clearing aliases', async () => {
    const first = await registry.upsertManualFolder('file:///work/atlas');
    await registry.setAlias(first.id, 'Atlas folder');
    await registry.upsertManualFolder(first.uri);

    expect(registry.list()).toEqual([{
      ...first,
      kind: 'folder',
      alias: 'Atlas folder',
    }]);
  });

  it('rejects non-local manual workspace and folder registrations', async () => {
    await expect(registry.upsertManualWorkspace(
      'vscode-remote://ssh-remote+host/work/a.code-workspace',
    )).rejects.toThrow('Select a local .code-workspace file.');
    await expect(registry.upsertManualFolder(
      'vscode-remote://ssh-remote+host/work/folder',
    )).rejects.toThrow('Select a local folder.');
    expect(registry.list()).toEqual([]);
  });

  it('uses project-oriented copy when a queued mutation targets a stale entry', async () => {
    await expect(registry.setAlias('file:///work/missing', 'Missing'))
      .rejects.toThrow('Project is no longer registered.');
  });

  it('rejects explicit unknown kinds and impossible discovered folders', async () => {
    storage.value = [
      { id: 'file:///bad', uri: 'file:///bad', kind: 'repository', manuallyRegistered: true, discoveredFrom: [] },
      { id: 'file:///folder', uri: 'file:///folder', kind: 'folder', manuallyRegistered: false, discoveredFrom: ['configured:file:///work'] },
    ];
    registry = new ProjectRegistry(storage);

    await expect(registry.load()).resolves.toEqual({ discarded: 2, reset: false, migrated: 0 });
    expect(registry.list()).toEqual([]);
  });

  it('rolls back memory when manual registration persistence fails', async () => {
    storage.failNext = new Error('write failed');

    await expect(registry.upsertManualWorkspace('file:///work/new.code-workspace'))
      .rejects.toThrow('write failed');

    expect(registry.list()).toEqual([]);
  });

  it('rolls back memory when alias persistence fails', async () => {
    const entry = await registry.upsertManualWorkspace('file:///work/a.code-workspace');
    const before = registry.list();
    storage.failNext = new Error('write failed');

    await expect(registry.setAlias(entry.id, 'Alpha')).rejects.toThrow('write failed');

    expect(registry.list()).toEqual(before);
  });

  it('rolls back memory when removal persistence fails', async () => {
    const entry = await registry.upsertManualWorkspace('file:///work/a.code-workspace');
    const before = registry.list();
    storage.failNext = new Error('write failed');

    await expect(registry.removeManual(entry.id)).rejects.toThrow('write failed');

    expect(registry.list()).toEqual(before);
  });

  it('rolls back memory when replacement persistence fails', async () => {
    await registry.upsertManualWorkspace('file:///work/a.code-workspace');
    const before = registry.list();
    storage.failNext = new Error('write failed');

    await expect(registry.replace([{
      id: 'file:///work/b.code-workspace',
      uri: 'file:///work/b.code-workspace',
      kind: 'workspace',
      manuallyRegistered: false,
      discoveredFrom: ['configured:file:///work'],
    }])).rejects.toThrow('write failed');

    expect(registry.list()).toEqual(before);
  });

  it('rolls back memory when last-opened persistence fails', async () => {
    const entry = await registry.upsertManualWorkspace('file:///work/a.code-workspace');
    const before = registry.list();
    storage.failNext = new Error('write failed');

    await expect(registry.markOpened(entry.id, 123)).rejects.toThrow('write failed');

    expect(registry.list()).toEqual(before);
  });

  it('serializes concurrent successful mutations in call order without losing either', async () => {
    const blockingStorage = new BlockingFirstWriteStorage();
    registry = new ProjectRegistry(blockingStorage);
    await registry.load();

    const first = registry.upsertManualWorkspace('file:///work/a.code-workspace');
    await blockingStorage.firstStarted;
    const second = registry.upsertManualWorkspace('file:///work/b.code-workspace');
    blockingStorage.release();
    await Promise.all([first, second]);

    expect(blockingStorage.writes.map(write => write.map(entry => entry.id))).toEqual([
      ['file:///work/a.code-workspace'],
      ['file:///work/a.code-workspace', 'file:///work/b.code-workspace'],
    ]);
    expect(registry.list().map(entry => entry.id)).toEqual([
      'file:///work/a.code-workspace',
      'file:///work/b.code-workspace',
    ]);
  });

  it('continues with a successful mutation after a failed mutation', async () => {
    storage.failNext = new Error('write failed');
    const failed = registry.upsertManualWorkspace('file:///work/a.code-workspace');
    const successful = registry.upsertManualWorkspace('file:///work/b.code-workspace');

    await expect(failed).rejects.toThrow('write failed');
    await expect(successful).resolves.toMatchObject({ id: 'file:///work/b.code-workspace' });

    expect(registry.list().map(entry => entry.id)).toEqual(['file:///work/b.code-workspace']);
  });
});
