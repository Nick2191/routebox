import { describe, expect, it, vi } from 'vitest';
import type { TargetKind } from '../../domain/discovery.js';
import type { ProjectEntry, ProjectKind } from '../../domain/projectEntry.js';
import type { RefreshResult } from '../../platform/discoveryCoordinator.js';
import {
  commandIds,
  registerProjectCommands,
  type ProjectUi,
} from '../../commands/registerCommands.js';

const alpha: ProjectEntry = {
  id: 'file:///work/alpha.code-workspace',
  uri: 'file:///work/alpha.code-workspace',
  kind: 'workspace',
  manuallyRegistered: true,
  discoveredFrom: [],
};

class FakeUi implements ProjectUi {
  projectKind: ProjectKind | undefined;
  workspaceFiles: readonly string[] = [];
  folders: readonly string[] = [];
  discoveryRoot: string | undefined;
  rootToRemove: string | undefined;
  pickedProject: ProjectEntry | undefined;
  alias: string | undefined;
  readonly infos: string[] = [];
  readonly warnings: string[] = [];
  readonly errors: string[] = [];
  readonly revealed: string[] = [];

  pickProjectKind(): Promise<ProjectKind | undefined> { return Promise.resolve(this.projectKind); }
  pickWorkspaceFiles(): Promise<readonly string[]> { return Promise.resolve(this.workspaceFiles); }
  pickFolders(): Promise<readonly string[]> { return Promise.resolve(this.folders); }
  pickDiscoveryRoot(): Promise<string | undefined> { return Promise.resolve(this.discoveryRoot); }
  pickDiscoveryRootToRemove(): Promise<string | undefined> {
    return Promise.resolve(this.rootToRemove);
  }
  pickProject(): Promise<ProjectEntry | undefined> {
    return Promise.resolve(this.pickedProject);
  }
  inputAlias(): Promise<string | undefined> { return Promise.resolve(this.alias); }
  showInfo(message: string): Promise<void> { this.infos.push(message); return Promise.resolve(); }
  showWarning(message: string): Promise<void> {
    this.warnings.push(message);
    return Promise.resolve();
  }
  showError(message: string): Promise<void> { this.errors.push(message); return Promise.resolve(); }
  revealFile(uri: string): Promise<void> { this.revealed.push(uri); return Promise.resolve(); }
}

function createHarness(): {
  run: (id: string, argument?: unknown) => Promise<void>;
  ui: FakeUi;
  registry: {
    entries: ProjectEntry[];
    upsertManualWorkspace: ReturnType<typeof vi.fn>;
    upsertManualFolder: ReturnType<typeof vi.fn>;
    setAlias: ReturnType<typeof vi.fn>;
    resetAlias: ReturnType<typeof vi.fn>;
    removeManual: ReturnType<typeof vi.fn>;
  };
  coordinator: { refresh: ReturnType<typeof vi.fn> };
  opener: { open: ReturnType<typeof vi.fn> };
  fs: {
    canonical: Map<string, string>;
    kinds: Map<string, TargetKind>;
    canonicalize(value: string): string;
    statKind(uri: string): Promise<TargetKind>;
  };
  roots: { values: string[]; update: ReturnType<typeof vi.fn> };
  tree: { refresh: ReturnType<typeof vi.fn> };
} {
  const callbacks = new Map<string, (...args: unknown[]) => unknown>();
  const ui = new FakeUi();
  const registry = {
    entries: [alpha],
    list(): ProjectEntry[] { return this.entries; },
    get(id: string): ProjectEntry | undefined {
      return this.entries.find(entry => entry.id === id);
    },
    upsertManualWorkspace: vi.fn(() => Promise.resolve(alpha)),
    upsertManualFolder: vi.fn((uri: string) => Promise.resolve({
      id: uri,
      uri,
      kind: 'folder' as const,
      manuallyRegistered: true,
      discoveredFrom: [],
    })),
    setAlias: vi.fn(() => Promise.resolve()),
    resetAlias: vi.fn(() => Promise.resolve()),
    removeManual: vi.fn(() => Promise.resolve()),
  };
  const coordinator = {
    refresh: vi.fn<() => Promise<RefreshResult>>(() => Promise.resolve({
      removed: 0,
      scanErrors: [],
      targetAccessErrors: [],
    })),
  };
  const opener = { open: vi.fn(() => Promise.resolve({ status: 'opened' as const })) };
  const fs = {
    canonical: new Map<string, string>(),
    kinds: new Map<string, TargetKind>(),
    canonicalize(value: string): string {
      return this.canonical.get(value) ?? value.replace('raw:', '');
    },
    statKind(uri: string): Promise<TargetKind> {
      return Promise.resolve(this.kinds.get(uri) ?? 'missing');
    },
  };
  const roots = {
    values: [] as string[],
    configuredRoots(): readonly string[] { return this.values; },
    update: vi.fn((values: readonly string[]) => {
      roots.values = [...values];
      return Promise.resolve();
    }),
  };
  const tree = { refresh: vi.fn() };
  registerProjectCommands({
    registry,
    coordinator,
    opener,
    roots,
    tree,
    fs,
    current: { currentProjectUri: () => alpha.uri },
    ui,
    commands: {
      registerCommand(id, callback): { dispose(): void } {
        callbacks.set(id, callback);
        return { dispose(): void { callbacks.delete(id); } };
      },
    },
  });
  const run = async (id: string, argument?: unknown): Promise<void> => {
    await callbacks.get(id)?.(argument);
  };
  return {
    run,
    ui,
    registry,
    coordinator,
    opener,
    fs,
    roots,
    tree,
  };
}

describe('project command handlers', () => {
  it('rejects a multi-file add containing a non-workspace file before changing the registry', async () => {
    const { run, ui, registry, fs, tree } = createHarness();
    ui.workspaceFiles = [
      'raw:file:///work/valid.code-workspace',
      'raw:file:///work/not-a-workspace.json',
    ];
    fs.kinds.set('file:///work/valid.code-workspace', 'file');
    fs.kinds.set('file:///work/not-a-workspace.json', 'file');

    await run(commandIds.addWorkspace);

    expect(registry.upsertManualWorkspace.mock.calls).toHaveLength(0);
    expect(ui.errors).toEqual(['Select .code-workspace files only.']);
    expect(tree.refresh.mock.calls).toHaveLength(0);
  });

  it('canonicalizes and adds every selected workspace then refreshes once', async () => {
    const { run, ui, registry, fs, tree } = createHarness();
    ui.workspaceFiles = [
      'raw:file:///work/one.code-workspace',
      'raw:file:///work/two.code-workspace',
    ];
    fs.kinds.set('file:///work/one.code-workspace', 'file');
    fs.kinds.set('file:///work/two.code-workspace', 'file');

    await run(commandIds.addWorkspace);

    expect(registry.upsertManualWorkspace.mock.calls).toEqual([
      ['file:///work/one.code-workspace'],
      ['file:///work/two.code-workspace'],
    ]);
    expect(tree.refresh.mock.calls).toHaveLength(1);
  });

  it('rejects a non-local workspace before filesystem inspection or registry mutation', async () => {
    const { run, ui, registry, fs, tree } = createHarness();
    ui.workspaceFiles = ['vscode-remote://ssh-remote+host/work/a.code-workspace'];
    const statKind = vi.spyOn(fs, 'statKind');

    await run(commandIds.addWorkspace);

    expect(statKind).not.toHaveBeenCalled();
    expect(registry.upsertManualWorkspace).not.toHaveBeenCalled();
    expect(tree.refresh).not.toHaveBeenCalled();
    expect(ui.errors).toEqual(['Select a local .code-workspace file.']);
  });

  it.each(['workspace', 'folder'] as const)('routes Add Project choice %s', async kind => {
    const harness = createHarness();
    harness.ui.projectKind = kind;
    harness.ui.workspaceFiles = kind === 'workspace' ? ['file:///work/a.code-workspace'] : [];
    harness.ui.folders = kind === 'folder' ? ['file:///work/a'] : [];
    harness.fs.kinds.set(
      kind === 'workspace' ? 'file:///work/a.code-workspace' : 'file:///work/a',
      kind === 'workspace' ? 'file' : 'directory',
    );

    await harness.run(commandIds.addProject);

    expect(kind === 'workspace'
      ? harness.registry.upsertManualWorkspace.mock.calls
      : harness.registry.upsertManualFolder.mock.calls).toHaveLength(1);
    expect(harness.tree.refresh).toHaveBeenCalledOnce();
  });

  it('canonicalizes, validates, and adds multiple folders atomically', async () => {
    const { run, ui, registry, fs, tree } = createHarness();
    ui.folders = ['raw:file:///work/one', 'raw:file:///work/two'];
    fs.kinds.set('file:///work/one', 'directory');
    fs.kinds.set('file:///work/two', 'directory');

    await run(commandIds.addFolder);

    expect(registry.upsertManualFolder.mock.calls).toEqual([
      ['file:///work/one'],
      ['file:///work/two'],
    ]);
    expect(tree.refresh).toHaveBeenCalledOnce();
  });

  it('rejects the complete folder selection before mutating when one target is not a directory', async () => {
    const { run, ui, registry, fs, tree } = createHarness();
    ui.folders = ['file:///work/folder', 'file:///work/file.txt'];
    fs.kinds.set('file:///work/folder', 'directory');
    fs.kinds.set('file:///work/file.txt', 'file');

    await run(commandIds.addFolder);

    expect(registry.upsertManualFolder).not.toHaveBeenCalled();
    expect(tree.refresh).not.toHaveBeenCalled();
    expect(ui.errors).toEqual(['Select folders only.']);
  });

  it('rejects a non-local folder before filesystem inspection or registry mutation', async () => {
    const { run, ui, registry, fs, tree } = createHarness();
    ui.folders = ['vscode-remote://ssh-remote+host/work/folder'];
    const statKind = vi.spyOn(fs, 'statKind');

    await run(commandIds.addFolder);

    expect(statKind).not.toHaveBeenCalled();
    expect(registry.upsertManualFolder).not.toHaveBeenCalled();
    expect(tree.refresh).not.toHaveBeenCalled();
    expect(ui.errors).toEqual(['Select a local folder.']);
  });

  it('uses reuse mode for the primary switch command chosen from Quick Pick', async () => {
    const { run, ui, opener } = createHarness();
    ui.pickedProject = alpha;

    await run(commandIds.switchProject);

    expect(opener.open.mock.calls).toEqual([[alpha.id, 'reuse']]);
  });

  it('uses new mode and bypasses Quick Pick when passed an entry id', async () => {
    const { run, ui, opener } = createHarness();
    const pick = vi.spyOn(ui, 'pickProject');

    await run(commandIds.openNewWindow, alpha.id);

    expect(pick).not.toHaveBeenCalled();
    expect(opener.open.mock.calls).toEqual([[alpha.id, 'new']]);
  });

  it('persists a trimmed alias selected through the public command', async () => {
    const { run, ui, registry, tree } = createHarness();
    ui.pickedProject = alpha;
    ui.alias = '  Atlas Alpha  ';

    await run(commandIds.rename);

    expect(registry.setAlias.mock.calls).toEqual([[alpha.id, 'Atlas Alpha']]);
    expect(tree.refresh.mock.calls).toHaveLength(1);
  });

  it('clears an alias and refreshes when passed a tree entry', async () => {
    const { run, registry, tree } = createHarness();

    await run(commandIds.resetName, { entry: alpha });

    expect(registry.resetAlias.mock.calls).toEqual([[alpha.id]]);
    expect(tree.refresh.mock.calls).toHaveLength(1);
  });

  it('aggregates deleted entries and scan errors on manual refresh', async () => {
    const { run, coordinator, ui, tree } = createHarness();
    coordinator.refresh.mockResolvedValue({
      removed: 2,
      scanErrors: [{
        rootUri: 'file:///unreadable',
        workspaceUris: [],
        status: 'error',
        error: 'Permission denied',
      }],
      targetAccessErrors: [],
    });

    await run(commandIds.refresh);

    expect(coordinator.refresh.mock.calls).toEqual([['manual']]);
    expect(ui.infos).toEqual(['Removed 2 missing projects.']);
    expect(ui.warnings).toHaveLength(1);
    expect(ui.warnings[0]).toContain('Permission denied');
    expect(tree.refresh.mock.calls).toHaveLength(1);
  });

  it('reports scan and target-access failures in one warning on manual refresh', async () => {
    const { run, coordinator, ui } = createHarness();
    coordinator.refresh.mockResolvedValue({
      removed: 0,
      scanErrors: [{
        rootUri: 'file:///unreadable-root',
        workspaceUris: [],
        status: 'error',
        error: 'Root permission denied',
      }],
      targetAccessErrors: [{
        uri: 'file:///inaccessible.code-workspace',
        error: 'Target permission denied',
      }],
    });

    await run(commandIds.refresh);

    expect(ui.warnings).toHaveLength(1);
    expect(ui.warnings[0]).toContain('Root permission denied');
    expect(ui.warnings[0]).toContain('Target permission denied');
  });

  it('does not show scan warnings while refreshing provenance after root removal', async () => {
    const { run, coordinator, roots, ui, tree } = createHarness();
    roots.values = ['file:///keep', 'file:///remove'];
    ui.rootToRemove = 'file:///remove';
    coordinator.refresh.mockResolvedValue({
      removed: 1,
      scanErrors: [{
        rootUri: 'file:///keep',
        workspaceUris: [],
        status: 'error',
        error: 'Temporarily unavailable',
      }],
      targetAccessErrors: [],
    });

    await run(commandIds.removeDiscoveryRoot);

    expect(roots.update.mock.calls).toEqual([[['file:///keep']]]);
    expect(coordinator.refresh.mock.calls).toEqual([['settings-change']]);
    expect(ui.warnings).toEqual([]);
    expect(ui.infos).toEqual([]);
    expect(tree.refresh.mock.calls).toHaveLength(1);
  });

  it('canonicalizes existing roots before deduplicating a Windows drive variant', async () => {
    const { run, fs, roots, ui } = createHarness();
    const existing = 'file:///C:/Work%20Trees';
    const selected = 'file:///c%3A/Work Trees';
    const canonical = 'file:///c%3A/Work%20Trees';
    roots.values = [existing];
    ui.discoveryRoot = selected;
    fs.canonical.set(existing, canonical);
    fs.canonical.set(selected, canonical);

    await run(commandIds.addDiscoveryRoot);

    expect(roots.update.mock.calls).toEqual([[[canonical]]]);
  });

  it('rejects a non-local discovery root before filesystem inspection or settings mutation', async () => {
    const { run, ui, roots, fs, coordinator } = createHarness();
    ui.discoveryRoot = 'vscode-remote://ssh-remote+host/work';
    const statKind = vi.spyOn(fs, 'statKind');

    await run(commandIds.addDiscoveryRoot);

    expect(statKind).not.toHaveBeenCalled();
    expect(roots.update).not.toHaveBeenCalled();
    expect(coordinator.refresh).not.toHaveBeenCalled();
    expect(ui.errors).toEqual(['Select a local discovery root.']);
  });

  it('canonicalizes and deduplicates existing roots before complete removal', async () => {
    const { run, fs, roots, ui, coordinator } = createHarness();
    const driveCase = 'file:///C:/Work%20Trees';
    const encodedDrive = 'file:///c%3A/Work Trees';
    const canonical = 'file:///c%3A/Work%20Trees';
    roots.values = [driveCase, encodedDrive];
    ui.rootToRemove = driveCase;
    fs.canonical.set(driveCase, canonical);
    fs.canonical.set(encodedDrive, canonical);

    await run(commandIds.removeDiscoveryRoot);

    expect(roots.update.mock.calls).toEqual([[[]]]);
    expect(coordinator.refresh.mock.calls).toEqual([['settings-change']]);
  });

  it('reports opening failures at the command boundary without refreshing', async () => {
    const { run, opener, ui, tree } = createHarness();
    opener.open.mockRejectedValue(new Error('VS Code refused to open the workspace'));

    await run(commandIds.switchProject, alpha);

    expect(ui.errors).toEqual(['VS Code refused to open the workspace']);
    expect(tree.refresh.mock.calls).toHaveLength(0);
  });

  it('reports kind mismatch without dispatching another open', async () => {
    const harness = createHarness();
    const folder: ProjectEntry = {
      id: 'file:///work/folder',
      uri: 'file:///work/folder',
      kind: 'folder',
      manuallyRegistered: true,
      discoveredFrom: [],
    };
    harness.registry.entries = [folder];
    harness.opener.open.mockResolvedValue({
      status: 'kind-mismatch',
      expected: 'directory',
      actual: 'file',
    });

    await harness.run(commandIds.switchProject, folder.id);

    expect(harness.ui.warnings).toEqual([
      'Project is no longer a folder. Remove it from Workspace Atlas and add it again.',
    ]);
    expect(harness.opener.open).toHaveBeenCalledOnce();
    expect(harness.tree.refresh).toHaveBeenCalledOnce();
  });

  it('removes only manual registration and never touches the filesystem', async () => {
    const { run, registry, tree } = createHarness();

    await run(commandIds.remove, alpha.id);

    expect(registry.removeManual.mock.calls).toEqual([[alpha.id]]);
    expect(tree.refresh.mock.calls).toHaveLength(1);
  });
});
