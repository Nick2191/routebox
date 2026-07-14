import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { URI, Utils } from 'vscode-uri';
import {
  commandIds,
  registerWorkspaceCommands,
  type WorkspaceUi,
} from '../../commands/registerCommands.js';
import {
  WorkspaceDiscoveryService,
  type FileKind,
  type FileSystemPort,
} from '../../domain/discovery.js';
import { WorkspaceReconciler } from '../../domain/reconciler.js';
import type { WorkspaceEntry } from '../../domain/workspaceEntry.js';
import {
  WorkspaceRegistry,
  type RegistryStorage,
} from '../../domain/workspaceRegistry.js';
import { WorkspaceOpener } from '../../platform/workspaceOpener.js';

class MemoryStorage implements RegistryStorage {
  value: unknown;

  read(): Promise<unknown> { return Promise.resolve(this.value); }
  write(entries: readonly WorkspaceEntry[]): Promise<void> {
    this.value = entries;
    return Promise.resolve();
  }
}

class NodeFileSystem implements FileSystemPort {
  async readDirectory(uri: string): Promise<readonly [name: string, kind: FileKind][]> {
    return (await readdir(URI.parse(uri).fsPath, { withFileTypes: true })).map(entry => [
      entry.name,
      entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
    ]);
  }

  joinPath(baseUri: string, ...segments: string[]): string {
    return Utils.joinPath(URI.parse(baseUri), ...segments).toString();
  }

  canonicalize(uri: string): string { return URI.parse(uri).toString(); }

  async exists(uri: string): Promise<boolean> {
    try {
      await stat(URI.parse(uri).fsPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  parent(uri: string): string { return Utils.dirname(URI.parse(uri)).toString(); }
}

class SmokeUi implements WorkspaceUi {
  workspaceFiles: readonly string[] = [];
  alias: string | undefined;

  pickWorkspaceFiles(): Promise<readonly string[]> { return Promise.resolve(this.workspaceFiles); }
  pickDiscoveryRoot(): Promise<string | undefined> { return Promise.resolve(undefined); }
  pickDiscoveryRootToRemove(): Promise<string | undefined> { return Promise.resolve(undefined); }
  pickWorkspace(): Promise<WorkspaceEntry | undefined> { return Promise.resolve(undefined); }
  inputAlias(): Promise<string | undefined> { return Promise.resolve(this.alias); }
  showInfo(): Promise<void> { return Promise.resolve(); }
  showWarning(): Promise<void> { return Promise.resolve(); }
  showError(message: string): Promise<void> { return Promise.reject(new Error(message)); }
  revealFile(): Promise<void> { return Promise.resolve(); }
}

describe('Stage 1 smoke semantics', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map(root => rm(root, {
      recursive: true,
      force: true,
    })));
  });

  it('registers, discovers, aliases, opens, cleans stale entries, and removes without deleting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-atlas-smoke-'));
    temporaryRoots.push(root);
    const manualDirectory = join(root, 'manual');
    const discoveryDirectory = join(root, 'discovered');
    await mkdir(manualDirectory);
    await mkdir(discoveryDirectory);
    const manualPath = join(manualDirectory, 'manual.code-workspace');
    const discoveredPath = join(discoveryDirectory, 'discovered.code-workspace');
    await writeFile(manualPath, '{"folders":[]}');
    await writeFile(discoveredPath, '{"folders":[]}');

    const fs = new NodeFileSystem();
    const registry = new WorkspaceRegistry(new MemoryStorage());
    await registry.load();
    const reconciler = new WorkspaceReconciler(registry, fs);
    const discovery = new WorkspaceDiscoveryService(fs);
    const manualUri = URI.file(manualPath).toString();
    const discoveredUri = URI.file(discoveredPath).toString();
    const discoveryRootUri = URI.file(discoveryDirectory).toString();
    const opened: [string, ...unknown[]][] = [];
    const opener = new WorkspaceOpener(
      registry,
      fs,
      {
        execute: (command, ...args): Promise<unknown> => {
          opened.push([command, ...args]);
          return Promise.resolve();
        },
      },
      { now: (): number => 42 },
    );
    const ui = new SmokeUi();
    const callbacks = new Map<string, (...args: unknown[]) => unknown>();
    registerWorkspaceCommands({
      registry,
      coordinator: { refresh: () => Promise.resolve({ removed: 0, errors: [] }) },
      opener,
      tree: { refresh: () => undefined },
      fs,
      current: { workspaceFileUri: () => undefined },
      ui,
      commands: {
        registerCommand(id, callback) {
          callbacks.set(id, callback);
          return { dispose: (): void => { callbacks.delete(id); } };
        },
      },
    });
    const run = async (id: string, argument?: unknown): Promise<void> => {
      await callbacks.get(id)?.(argument);
    };

    ui.workspaceFiles = [manualUri];
    await run(commandIds.addWorkspace);
    const result = await discovery.scan(discoveryRootUri);
    await reconciler.reconcileSource(`configured:${discoveryRootUri}`, result);
    expect(registry.list().map(entry => entry.id).sort()).toEqual(
      [manualUri, discoveredUri].sort(),
    );

    ui.alias = 'Manual alias';
    await run(commandIds.rename, manualUri);
    expect(registry.get(manualUri)?.alias).toBe('Manual alias');
    await run(commandIds.resetName, manualUri);
    expect(registry.get(manualUri)?.alias).toBeUndefined();

    for (const uri of [manualUri, discoveredUri]) {
      await run(commandIds.switchWorkspace, uri);
      await run(commandIds.openNewWindow, uri);
    }
    expect(opened.map(call => call[2])).toEqual([
      { forceReuseWindow: true },
      { forceNewWindow: true },
      { forceReuseWindow: true },
      { forceNewWindow: true },
    ]);

    await rm(discoveryDirectory, { recursive: true });
    const missingRootResult = await discovery.scan(discoveryRootUri);
    expect(missingRootResult.status).toBe('error');
    await reconciler.reconcileSource(`configured:${discoveryRootUri}`, missingRootResult);
    await reconciler.removeMissing();
    expect(registry.get(discoveredUri)).toBeUndefined();

    await run(commandIds.remove, manualUri);
    expect(registry.get(manualUri)).toBeUndefined();
    await expect(stat(manualPath)).resolves.toBeDefined();
  });
});
