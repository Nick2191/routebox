import { describe, expect, it, vi } from 'vitest';
import type { ProjectEntry } from '../../domain/projectEntry.js';
import {
  commandIds,
  registerWorkspaceCommands,
  type WorkspaceUi,
} from '../../commands/registerCommands.js';

const alpha: ProjectEntry = {
  id: 'file:///work/alpha.code-workspace',
  uri: 'file:///work/alpha.code-workspace',
  kind: 'workspace',
  manuallyRegistered: true,
  discoveredFrom: [],
};

class FakeUi implements WorkspaceUi {
  workspaceFiles: readonly string[] = [];
  discoveryRoot: string | undefined;
  rootToRemove: string | undefined;
  pickedWorkspace: ProjectEntry | undefined;
  alias: string | undefined;
  readonly infos: string[] = [];
  readonly warnings: string[] = [];
  readonly errors: string[] = [];
  readonly revealed: string[] = [];

  pickWorkspaceFiles(): Promise<readonly string[]> { return Promise.resolve(this.workspaceFiles); }
  pickDiscoveryRoot(): Promise<string | undefined> { return Promise.resolve(this.discoveryRoot); }
  pickDiscoveryRootToRemove(): Promise<string | undefined> {
    return Promise.resolve(this.rootToRemove);
  }
  pickWorkspace(): Promise<ProjectEntry | undefined> {
    return Promise.resolve(this.pickedWorkspace);
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
    setAlias: ReturnType<typeof vi.fn>;
    resetAlias: ReturnType<typeof vi.fn>;
    removeManual: ReturnType<typeof vi.fn>;
  };
  coordinator: { refresh: ReturnType<typeof vi.fn> };
  opener: { open: ReturnType<typeof vi.fn> };
  fs: { canonical: Map<string, string>; canonicalize(value: string): string };
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
    setAlias: vi.fn(() => Promise.resolve()),
    resetAlias: vi.fn(() => Promise.resolve()),
    removeManual: vi.fn(() => Promise.resolve()),
  };
  const coordinator = {
    refresh: vi.fn(() => Promise.resolve({ removed: 0, errors: [] })),
  };
  const opener = { open: vi.fn(() => Promise.resolve({ status: 'opened' as const })) };
  const fs = {
    canonical: new Map<string, string>(),
    canonicalize(value: string): string {
      return this.canonical.get(value) ?? value.replace('raw:', '');
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
  registerWorkspaceCommands({
    registry,
    coordinator,
    opener,
    roots,
    tree,
    fs,
    current: { workspaceFileUri: () => alpha.uri },
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

describe('workspace command handlers', () => {
  it('rejects a multi-file add containing a non-workspace file before changing the registry', async () => {
    const { run, ui, registry, tree } = createHarness();
    ui.workspaceFiles = [
      'raw:file:///work/valid.code-workspace',
      'raw:file:///work/not-a-workspace.json',
    ];

    await run(commandIds.addWorkspace);

    expect(registry.upsertManualWorkspace.mock.calls).toHaveLength(0);
    expect(ui.errors).toEqual(['Select a .code-workspace file.']);
    expect(tree.refresh.mock.calls).toHaveLength(0);
  });

  it('canonicalizes and adds every selected workspace then refreshes once', async () => {
    const { run, ui, registry, tree } = createHarness();
    ui.workspaceFiles = [
      'raw:file:///work/one.code-workspace',
      'raw:file:///work/two.code-workspace',
    ];

    await run(commandIds.addWorkspace);

    expect(registry.upsertManualWorkspace.mock.calls).toEqual([
      ['file:///work/one.code-workspace'],
      ['file:///work/two.code-workspace'],
    ]);
    expect(tree.refresh.mock.calls).toHaveLength(1);
  });

  it('uses reuse mode for the primary switch command chosen from Quick Pick', async () => {
    const { run, ui, opener } = createHarness();
    ui.pickedWorkspace = alpha;

    await run(commandIds.switchWorkspace);

    expect(opener.open.mock.calls).toEqual([[alpha.id, 'reuse']]);
  });

  it('uses new mode and bypasses Quick Pick when passed an entry id', async () => {
    const { run, ui, opener } = createHarness();
    const pick = vi.spyOn(ui, 'pickWorkspace');

    await run(commandIds.openNewWindow, alpha.id);

    expect(pick).not.toHaveBeenCalled();
    expect(opener.open.mock.calls).toEqual([[alpha.id, 'new']]);
  });

  it('persists a trimmed alias selected through the public command', async () => {
    const { run, ui, registry, tree } = createHarness();
    ui.pickedWorkspace = alpha;
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
      errors: [{
        rootUri: 'file:///unreadable',
        workspaceUris: [],
        status: 'error',
        error: 'Permission denied',
      }],
    });

    await run(commandIds.refresh);

    expect(coordinator.refresh.mock.calls).toEqual([['manual']]);
    expect(ui.infos).toEqual(['Removed 2 missing workspaces.']);
    expect(ui.warnings).toHaveLength(1);
    expect(ui.warnings[0]).toContain('Permission denied');
    expect(tree.refresh.mock.calls).toHaveLength(1);
  });

  it('does not show scan warnings while refreshing provenance after root removal', async () => {
    const { run, coordinator, roots, ui, tree } = createHarness();
    roots.values = ['file:///keep', 'file:///remove'];
    ui.rootToRemove = 'file:///remove';
    coordinator.refresh.mockResolvedValue({
      removed: 1,
      errors: [{
        rootUri: 'file:///keep',
        workspaceUris: [],
        status: 'error',
        error: 'Temporarily unavailable',
      }],
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

    await run(commandIds.switchWorkspace, alpha);

    expect(ui.errors).toEqual(['VS Code refused to open the workspace']);
    expect(tree.refresh.mock.calls).toHaveLength(0);
  });

  it('removes only manual registration and never touches the filesystem', async () => {
    const { run, registry, tree } = createHarness();

    await run(commandIds.remove, alpha.id);

    expect(registry.removeManual.mock.calls).toEqual([[alpha.id]]);
    expect(tree.refresh.mock.calls).toHaveLength(1);
  });
});
