import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileKind, FileSystemPort, TargetKind } from '../../domain/discovery.js';
import { ProjectReconciler } from '../../domain/reconciler.js';
import {
  ProjectRegistry,
  type ProjectRegistryState,
  type RegistryStorage,
} from '../../domain/projectRegistry.js';

class MemoryStorage implements RegistryStorage {
  value: unknown;
  private blocker: {
    started: () => void;
    released: Promise<void>;
  } | undefined;

  read(): Promise<unknown> { return Promise.resolve(this.value); }
  async write(state: ProjectRegistryState): Promise<void> {
    if (this.blocker) {
      const blocker = this.blocker;
      this.blocker = undefined;
      blocker.started();
      await blocker.released;
    }
    this.value = {
      entries: state.entries.map(entry => ({
        ...entry,
        discoveredFrom: [...entry.discoveredFrom],
      })),
      exclusions: state.exclusions.map(exclusion => ({ ...exclusion })),
    };
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
  private readonly kinds = new Map<string, TargetKind>();

  setKind(uri: string, kind: TargetKind): void { this.kinds.set(uri, kind); }
  readDirectory(): Promise<readonly [name: string, kind: FileKind][]> {
    return Promise.resolve([]);
  }
  joinPath(baseUri: string, ...segments: string[]): string {
    return [baseUri.replace(/\/$/, ''), ...segments].join('/');
  }
  canonicalize(uri: string): string { return uri; }
  statKind(uri: string): Promise<TargetKind> {
    return Promise.resolve(this.kinds.get(uri) ?? 'file');
  }
  parent(uri: string): string { return uri.slice(0, uri.lastIndexOf('/')); }
}

class BlockingFileSystem extends FakeFileSystem {
  private markStarted!: () => void;
  private releaseChecks!: () => void;
  readonly started = new Promise<void>(resolve => { this.markStarted = resolve; });
  private readonly released = new Promise<void>(resolve => { this.releaseChecks = resolve; });
  private hasStarted = false;

  private async waitForRelease(): Promise<void> {
    if (!this.hasStarted) {
      this.hasStarted = true;
      this.markStarted();
    }
    await this.released;
  }

  override async statKind(uri: string): Promise<TargetKind> {
    await this.waitForRelease();
    return super.statKind(uri);
  }

  release(): void { this.releaseChecks(); }
}

describe('ProjectReconciler', () => {
  let fs: FakeFileSystem;
  let storage: MemoryStorage;
  let registry: ProjectRegistry;
  let reconciler: ProjectReconciler;

  beforeEach(async () => {
    fs = new FakeFileSystem();
    storage = new MemoryStorage();
    registry = new ProjectRegistry(storage);
    await registry.load();
    reconciler = new ProjectReconciler(registry, fs);
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

  it('creates discovered entries as workspaces and never adds provenance to folders', async () => {
    const folder = await registry.upsertManualFolder('file:///work/folder.code-workspace');
    await reconciler.reconcileSource('configured:file:///work', {
      rootUri: 'file:///work',
      workspaceUris: [folder.uri, 'file:///work/real.code-workspace'],
      status: 'ok',
    });

    expect(registry.get(folder.id)).toEqual(folder);
    expect(registry.get('file:///work/real.code-workspace')).toMatchObject({
      kind: 'workspace',
      manuallyRegistered: false,
      discoveredFrom: ['configured:file:///work'],
    });
  });

  it('keeps an excluded workspace out of configured-source discovery', async () => {
    const uri = 'file:///root/excluded.code-workspace';
    await registry.replace([{
      id: uri,
      uri,
      kind: 'workspace',
      manuallyRegistered: false,
      discoveredFrom: ['configured:file:///root'],
    }]);
    await registry.removeProject(uri);

    await reconciler.reconcileSource('configured:file:///root', {
      rootUri: 'file:///root',
      status: 'ok',
      workspaceUris: [uri],
    });

    expect(registry.get(uri)).toBeUndefined();
    expect(registry.isExcluded(uri)).toBe(true);
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
    fs.setKind(missing.uri, 'missing');
    fs.setKind(existingUri, 'file');

    await expect(reconciler.removeMissing()).resolves.toEqual({
      removed: 1,
      targetAccessErrors: [],
    });

    expect(registry.list()).toEqual([{
      id: existingUri,
      uri: existingUri,
      kind: 'workspace',
      manuallyRegistered: false,
      discoveredFrom: ['configured:file:///root'],
    }]);
  });

  it('removes a missing active entry without excluding it', async () => {
    const uri = 'file:///root/missing.code-workspace';
    await registry.replace([{
      id: uri,
      uri,
      kind: 'workspace',
      manuallyRegistered: false,
      discoveredFrom: ['configured:file:///root'],
    }]);
    fs.setKind(uri, 'missing');

    await expect(reconciler.removeMissing()).resolves.toEqual({
      removed: 1,
      targetAccessErrors: [],
    });

    expect(registry.get(uri)).toBeUndefined();
    expect(registry.isExcluded(uri)).toBe(false);
  });

  it('removes confirmed missing entries while retaining and reporting inaccessible targets', async () => {
    const missing = await registry.upsertManualWorkspace('file:///root/missing.code-workspace');
    const inaccessible = await registry.upsertManualFolder('file:///root/inaccessible');
    fs.setKind(missing.uri, 'missing');
    const statKind = fs.statKind.bind(fs);
    vi.spyOn(fs, 'statKind').mockImplementation(uri => (
      uri === inaccessible.uri
        ? Promise.reject(new Error('Permission denied'))
        : statKind(uri)
    ));

    await expect(reconciler.removeMissing()).resolves.toEqual({
      removed: 1,
      targetAccessErrors: [{ uri: inaccessible.uri, error: 'Permission denied' }],
    });
    expect(registry.get(missing.id)).toBeUndefined();
    expect(registry.get(inaccessible.id)).toEqual(inaccessible);
  });

  it('removes missing folders but retains entries whose kind changed', async () => {
    const missing = await registry.upsertManualFolder('file:///work/missing');
    const changed = await registry.upsertManualFolder('file:///work/changed');
    fs.setKind(missing.uri, 'missing');
    fs.setKind(changed.uri, 'file');

    await expect(reconciler.removeMissing()).resolves.toEqual({
      removed: 1,
      targetAccessErrors: [],
    });
    expect(registry.get(missing.id)).toBeUndefined();
    expect(registry.get(changed.id)).toEqual(changed);
  });

  it('applies confirmed deletions to fresh registry state after pending stats', async () => {
    const blockingFs = new BlockingFileSystem();
    reconciler = new ProjectReconciler(registry, blockingFs);
    const missing = await registry.upsertManualWorkspace('file:///root/missing.code-workspace');
    const retained = await registry.upsertManualWorkspace('file:///root/retained.code-workspace');
    blockingFs.setKind(missing.uri, 'missing');
    blockingFs.setKind(retained.uri, 'file');
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

    await expect(cleanup).resolves.toEqual({ removed: 1, targetAccessErrors: [] });
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
