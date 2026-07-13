import { beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceRegistry, type RegistryStorage } from '../../domain/workspaceRegistry.js';
import type { WorkspaceEntry } from '../../domain/workspaceEntry.js';

class MemoryStorage implements RegistryStorage {
  value: unknown;

  read(): Promise<unknown> { return Promise.resolve(this.value); }
  write(entries: unknown): Promise<void> {
    this.value = entries;
    return Promise.resolve();
  }
}

function discoveredEntry(): WorkspaceEntry {
  return {
    id: 'file:///work/a.code-workspace',
    uri: 'file:///work/a.code-workspace',
    manuallyRegistered: false,
    discoveredFrom: ['configured:file:///work'],
  };
}

describe('WorkspaceRegistry', () => {
  let storage: MemoryStorage;
  let registry: WorkspaceRegistry;

  beforeEach(async () => {
    storage = new MemoryStorage();
    registry = new WorkspaceRegistry(storage);
    await registry.load();
  });

  it('persists one canonical entry for duplicate manual registration', async () => {
    await registry.upsertManual('file:///work/a.code-workspace');
    await registry.upsertManual('file:///work/a.code-workspace');
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]!.manuallyRegistered).toBe(true);
  });

  it('sets and resets aliases without changing the URI', async () => {
    const saved = await registry.upsertManual('file:///work/a.code-workspace');
    await registry.setAlias(saved.id, 'Alpha');
    expect(registry.get(saved.id)?.alias).toBe('Alpha');
    await registry.resetAlias(saved.id);
    expect(registry.get(saved.id)?.alias).toBeUndefined();
  });

  it('keeps a discovered entry when manual registration is removed', async () => {
    const saved = await registry.upsertManual('file:///work/a.code-workspace');
    await registry.replace([{ ...saved, discoveredFrom: ['configured:file:///work'] }]);
    await registry.removeManual(saved.id);
    expect(registry.get(saved.id)?.manuallyRegistered).toBe(false);
  });

  it('isolates discovered sources loaded from storage', async () => {
    const stored = discoveredEntry();
    storage.value = [stored];
    registry = new WorkspaceRegistry(storage);
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
    const returned = await registry.upsertManual('file:///work/a.code-workspace');

    returned.discoveredFrom.push('configured:file:///work');

    expect(registry.get(returned.id)?.discoveredFrom).toEqual([]);
  });

  it('drops invalid persisted records but loads valid ones', async () => {
    storage.value = [
      { id: 'file:///a.code-workspace', uri: 'file:///a.code-workspace', manuallyRegistered: true, discoveredFrom: [] },
      { broken: true },
    ];
    registry = new WorkspaceRegistry(storage);
    const report = await registry.load();
    expect(registry.list()).toHaveLength(1);
    expect(report).toEqual({ discarded: 1, reset: false });
  });

  it('discards a persisted record with a non-string alias', async () => {
    storage.value = [
      {
        id: 'file:///a.code-workspace',
        uri: 'file:///a.code-workspace',
        alias: 42,
        manuallyRegistered: true,
        discoveredFrom: [],
      },
    ];
    registry = new WorkspaceRegistry(storage);
    expect(await registry.load()).toEqual({ discarded: 1, reset: false });
    expect(registry.list()).toEqual([]);
  });

  it('discards a persisted record with a non-number last-opened timestamp', async () => {
    storage.value = [
      {
        id: 'file:///a.code-workspace',
        uri: 'file:///a.code-workspace',
        manuallyRegistered: true,
        discoveredFrom: [],
        lastOpenedAt: 'yesterday',
      },
    ];
    registry = new WorkspaceRegistry(storage);
    expect(await registry.load()).toEqual({ discarded: 1, reset: false });
    expect(registry.list()).toEqual([]);
  });

  it('reports an unusable top-level stored value', async () => {
    storage.value = { broken: true };
    registry = new WorkspaceRegistry(storage);
    expect(await registry.load()).toEqual({ discarded: 0, reset: true });
    expect(registry.list()).toEqual([]);
  });
});
