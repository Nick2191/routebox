import { beforeEach, describe, expect, it } from 'vitest';
import type { FileKind, FileSystemPort } from '../../domain/discovery.js';
import { WorkspaceReconciler } from '../../domain/reconciler.js';
import {
  WorkspaceRegistry,
  type RegistryStorage,
} from '../../domain/workspaceRegistry.js';
import type { WorkspaceEntry } from '../../domain/workspaceEntry.js';

class MemoryStorage implements RegistryStorage {
  value: unknown;

  read(): Promise<unknown> { return Promise.resolve(this.value); }
  write(entries: readonly WorkspaceEntry[]): Promise<void> {
    this.value = entries;
    return Promise.resolve();
  }
}

class FakeFileSystem implements FileSystemPort {
  private readonly existing = new Map<string, boolean>();

  setExists(uri: string, exists: boolean): void { this.existing.set(uri, exists); }
  readDirectory(): Promise<readonly [name: string, kind: FileKind][]> {
    return Promise.resolve([]);
  }
  joinPath(baseUri: string, ...segments: string[]): string {
    return [baseUri.replace(/\/$/, ''), ...segments].join('/');
  }
  canonicalize(uri: string): string { return uri; }
  exists(uri: string): Promise<boolean> { return Promise.resolve(this.existing.get(uri) ?? true); }
  parent(uri: string): string { return uri.slice(0, uri.lastIndexOf('/')); }
}

describe('WorkspaceReconciler', () => {
  let fs: FakeFileSystem;
  let registry: WorkspaceRegistry;
  let reconciler: WorkspaceReconciler;

  beforeEach(async () => {
    fs = new FakeFileSystem();
    registry = new WorkspaceRegistry(new MemoryStorage());
    await registry.load();
    reconciler = new WorkspaceReconciler(registry, fs);
  });

  it('merges discoveries without losing manual metadata', async () => {
    const manual = await registry.upsertManual('file:///root/a.code-workspace');
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
      alias: 'Alpha',
      lastOpenedAt: 123,
      manuallyRegistered: true,
      discoveredFrom: ['configured:file:///root'],
    });
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
      manuallyRegistered: false,
      discoveredFrom: ['current:file:///root/a'],
    });
  });

  it('keeps a manual entry when a source stops discovering it', async () => {
    const manual = await registry.upsertManual('file:///root/a.code-workspace');
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
    const manual = await registry.upsertManual('file:///root/a.code-workspace');
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
      alias: 'Alpha',
      manuallyRegistered: true,
      discoveredFrom: [],
    });
  });

  it('removes only confirmed missing entries, including manual ones', async () => {
    const missing = await registry.upsertManual('file:///root/missing.code-workspace');
    const existingUri = 'file:///root/existing.code-workspace';
    await reconciler.reconcileSource('configured:file:///root', {
      rootUri: 'file:///root',
      status: 'ok',
      workspaceUris: [existingUri],
    });
    fs.setExists(missing.uri, false);
    fs.setExists(existingUri, true);

    await expect(reconciler.removeMissing()).resolves.toEqual({ removed: 1 });

    expect(registry.list()).toEqual([{
      id: existingUri,
      uri: existingUri,
      manuallyRegistered: false,
      discoveredFrom: ['configured:file:///root'],
    }]);
  });
});
