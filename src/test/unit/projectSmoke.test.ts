import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { URI, Utils } from 'vscode-uri';
import {
  commandIds,
  registerProjectCommands,
  type ProjectUi,
} from '../../commands/registerCommands.js';
import {
  WorkspaceDiscoveryService,
  type FileKind,
  type FileSystemPort,
  type TargetKind,
} from '../../domain/discovery.js';
import { ProjectReconciler } from '../../domain/reconciler.js';
import type { ProjectEntry, ProjectKind } from '../../domain/projectEntry.js';
import {
  ProjectRegistry,
  type ProjectRegistryState,
  type RegistryStorage,
} from '../../domain/projectRegistry.js';
import { ProjectOpener } from '../../platform/projectOpener.js';

class MemoryStorage implements RegistryStorage {
  value: unknown;

  read(): Promise<unknown> { return Promise.resolve(this.value); }
  write(state: ProjectRegistryState): Promise<void> {
    this.value = {
      entries: state.entries.map(entry => ({
        ...entry,
        discoveredFrom: [...entry.discoveredFrom],
      })),
      exclusions: state.exclusions.map(exclusion => ({ ...exclusion })),
    };
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

  async statKind(uri: string): Promise<TargetKind> {
    try {
      const result = await stat(URI.parse(uri).fsPath);
      if (result.isFile()) return 'file';
      if (result.isDirectory()) return 'directory';
      return 'other';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
      throw error;
    }
  }

  parent(uri: string): string { return Utils.dirname(URI.parse(uri)).toString(); }
}

class SmokeUi implements ProjectUi {
  projectKind: ProjectKind | undefined;
  workspaceFiles: readonly string[] = [];
  folders: readonly string[] = [];
  alias: string | undefined;

  pickProjectKind(): Promise<ProjectKind | undefined> { return Promise.resolve(this.projectKind); }
  pickWorkspaceFiles(): Promise<readonly string[]> { return Promise.resolve(this.workspaceFiles); }
  pickFolders(): Promise<readonly string[]> { return Promise.resolve(this.folders); }
  pickDiscoveryRoot(): Promise<string | undefined> { return Promise.resolve(undefined); }
  pickDiscoveryRootToRemove(): Promise<string | undefined> { return Promise.resolve(undefined); }
  pickProject(): Promise<ProjectEntry | undefined> { return Promise.resolve(undefined); }
  inputAlias(): Promise<string | undefined> { return Promise.resolve(this.alias); }
  showInfo(): Promise<void> { return Promise.resolve(); }
  showWarning(): Promise<void> { return Promise.resolve(); }
  showError(message: string): Promise<void> { return Promise.reject(new Error(message)); }
  revealFile(): Promise<void> { return Promise.resolve(); }
}

describe('project smoke semantics', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map(root => rm(root, {
      recursive: true,
      force: true,
    })));
  });

  it('keeps an excluded workspace out of current-project discovery', async () => {
    const uri = 'file:///root/excluded.code-workspace';
    const registry = new ProjectRegistry(new MemoryStorage());
    await registry.load();
    await registry.replace([{
      id: uri,
      uri,
      kind: 'workspace',
      manuallyRegistered: false,
      discoveredFrom: ['current:file:///root/project'],
    }]);
    await registry.removeProject(uri);
    const reconciler = new ProjectReconciler(registry, new NodeFileSystem());

    await reconciler.reconcileSource('current:file:///root/project', {
      rootUri: 'file:///root/project',
      status: 'ok',
      workspaceUris: [uri],
    });

    expect(registry.get(uri)).toBeUndefined();
    expect(registry.isExcluded(uri)).toBe(true);
  });

  it('registers, discovers, aliases, opens, cleans stale projects, and removes without deleting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-atlas-smoke-'));
    temporaryRoots.push(root);
    const manualDirectory = join(root, 'manual');
    const folderPath = join(root, 'folder');
    const discoveryDirectory = join(root, 'discovered');
    await mkdir(manualDirectory);
    await mkdir(folderPath);
    await mkdir(discoveryDirectory);
    const manualPath = join(manualDirectory, 'manual.code-workspace');
    const discoveredPath = join(discoveryDirectory, 'discovered.code-workspace');
    await writeFile(manualPath, '{"folders":[]}');
    await writeFile(discoveredPath, '{"folders":[]}');

    const fs = new NodeFileSystem();
    const registry = new ProjectRegistry(new MemoryStorage());
    await registry.load();
    const reconciler = new ProjectReconciler(registry, fs);
    const discovery = new WorkspaceDiscoveryService(fs);
    const manualUri = URI.file(manualPath).toString();
    const folderUri = URI.file(folderPath).toString();
    const discoveredUri = URI.file(discoveredPath).toString();
    const discoveryRootUri = URI.file(discoveryDirectory).toString();
    const opened: [string, ...unknown[]][] = [];
    const opener = new ProjectOpener(
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
    registerProjectCommands({
      registry,
      coordinator: {
        refresh: () => Promise.resolve({
          removed: 0,
          scanErrors: [],
          targetAccessErrors: [],
        }),
      },
      opener,
      tree: { refresh: () => undefined },
      fs,
      current: { currentProjectUri: () => undefined },
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
    ui.folders = [folderUri];
    await run(commandIds.addFolder);
    const result = await discovery.scan(discoveryRootUri);
    await reconciler.reconcileSource(`configured:${discoveryRootUri}`, result);
    expect(registry.list().map(entry => entry.id).sort()).toEqual(
      [manualUri, folderUri, discoveredUri].sort(),
    );

    ui.alias = 'Manual alias';
    await run(commandIds.rename, manualUri);
    expect(registry.get(manualUri)?.alias).toBe('Manual alias');
    await run(commandIds.resetName, manualUri);
    expect(registry.get(manualUri)?.alias).toBeUndefined();

    for (const uri of [manualUri, folderUri, discoveredUri]) {
      await run(commandIds.switchProject, uri);
      await run(commandIds.openNewWindow, uri);
    }
    expect(opened.map(call => call[2])).toEqual([
      { forceReuseWindow: true },
      { forceNewWindow: true },
      { forceReuseWindow: true },
      { forceNewWindow: true },
      { forceReuseWindow: true },
      { forceNewWindow: true },
    ]);

    await rm(folderPath, { recursive: true });
    await rm(discoveryDirectory, { recursive: true });
    const missingRootResult = await discovery.scan(discoveryRootUri);
    expect(missingRootResult.status).toBe('error');
    await reconciler.reconcileSource(`configured:${discoveryRootUri}`, missingRootResult);
    await reconciler.removeMissing();
    expect(registry.get(folderUri)).toBeUndefined();
    expect(registry.get(discoveredUri)).toBeUndefined();

    await run(commandIds.remove, manualUri);
    expect(registry.get(manualUri)).toBeUndefined();
    await expect(stat(manualPath)).resolves.toBeDefined();
  });
});
