import { beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceRegistry, type RegistryStorage } from '../../domain/workspaceRegistry.js';

class MemoryStorage implements RegistryStorage {
  value: unknown;

  read(): Promise<unknown> { return Promise.resolve(this.value); }
  write(entries: unknown): Promise<void> {
    this.value = entries;
    return Promise.resolve();
  }
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

  it('reports an unusable top-level stored value', async () => {
    storage.value = { broken: true };
    registry = new WorkspaceRegistry(storage);
    expect(await registry.load()).toEqual({ discarded: 0, reset: true });
    expect(registry.list()).toEqual([]);
  });
});
