import {
  ConfigurationTarget,
  Uri,
  commands as vscodeCommands,
  window,
  workspace,
  type Disposable,
} from 'vscode';
import type { FileSystemPort } from '../domain/discovery.js';
import {
  isWorkspaceFileUri,
  projectLabel,
  type ProjectEntry,
} from '../domain/projectEntry.js';
import type { RefreshResult } from '../platform/discoveryCoordinator.js';
import type { OpenMode, OpenResult } from '../platform/projectOpener.js';
import { buildProjectQuickPickItems } from '../ui/projectQuickPick.js';

export const commandIds = {
  switchWorkspace: 'workspaceAtlas.switchWorkspace',
  openNewWindow: 'workspaceAtlas.openWorkspaceInNewWindow',
  addWorkspace: 'workspaceAtlas.addWorkspace',
  addDiscoveryRoot: 'workspaceAtlas.addDiscoveryRoot',
  removeDiscoveryRoot: 'workspaceAtlas.removeDiscoveryRoot',
  refresh: 'workspaceAtlas.refreshWorkspaces',
  rename: 'workspaceAtlas.renameWorkspace',
  resetName: 'workspaceAtlas.resetWorkspaceName',
  remove: 'workspaceAtlas.removeWorkspace',
  reveal: 'workspaceAtlas.revealWorkspaceFile',
} as const;

export const openCurrentCommandId = 'workspaceAtlas.openEntryInCurrentWindow';

export interface WorkspaceUi {
  pickWorkspaceFiles(): Promise<readonly string[]>;
  pickDiscoveryRoot(): Promise<string | undefined>;
  pickDiscoveryRootToRemove(roots: readonly string[]): Promise<string | undefined>;
  pickWorkspace(
    entries: readonly ProjectEntry[],
    currentUri?: string,
  ): Promise<ProjectEntry | undefined>;
  inputAlias(entry: ProjectEntry): Promise<string | undefined>;
  showInfo(message: string): Promise<void>;
  showWarning(message: string): Promise<void>;
  showError(message: string): Promise<void>;
  revealFile(uri: string): Promise<void>;
}

interface RegistryCommandPort {
  list(): ProjectEntry[];
  get(id: string): ProjectEntry | undefined;
  upsertManualWorkspace(uri: string): Promise<unknown>;
  setAlias(id: string, alias: string): Promise<void>;
  resetAlias(id: string): Promise<void>;
  removeManual(id: string): Promise<void>;
}

interface CoordinatorCommandPort {
  refresh(reason: 'manual' | 'settings-change'): Promise<RefreshResult>;
}

interface OpenerCommandPort {
  open(id: string, mode: OpenMode): Promise<OpenResult>;
}

interface DiscoveryRootSettings {
  configuredRoots(): readonly string[];
  update(roots: readonly string[]): Promise<void>;
}

interface TreeRefreshPort { refresh(): void }
interface CurrentWorkspacePort { workspaceFileUri(): string | undefined }

interface CommandRegistry {
  registerCommand(
    command: string,
    callback: (...args: unknown[]) => unknown,
  ): Disposable;
}

export interface RegisterWorkspaceCommandsDependencies {
  registry: RegistryCommandPort;
  coordinator: CoordinatorCommandPort;
  opener: OpenerCommandPort;
  tree: TreeRefreshPort;
  fs: Pick<FileSystemPort, 'canonicalize'>;
  current: CurrentWorkspacePort;
  roots?: DiscoveryRootSettings;
  ui?: WorkspaceUi;
  commands?: CommandRegistry;
}

type EntryArgument = ProjectEntry | string | {
  entry?: ProjectEntry;
  id?: string;
};

class VscodeDiscoveryRootSettings implements DiscoveryRootSettings {
  configuredRoots(): readonly string[] {
    return workspace.getConfiguration('workspaceAtlas').get<string[]>('discoveryRoots', []);
  }

  async update(roots: readonly string[]): Promise<void> {
    await workspace.getConfiguration('workspaceAtlas').update(
      'discoveryRoots',
      [...roots],
      ConfigurationTarget.Global,
    );
  }
}

export class VscodeWorkspaceUi implements WorkspaceUi {
  async pickWorkspaceFiles(): Promise<readonly string[]> {
    const selected = await window.showOpenDialog({
      canSelectMany: true,
      filters: { 'VS Code Workspaces': ['code-workspace'] },
    });
    return selected?.map(uri => uri.toString()) ?? [];
  }

  async pickDiscoveryRoot(): Promise<string | undefined> {
    const selected = await window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
    });
    return selected?.[0]?.toString();
  }

  async pickDiscoveryRootToRemove(roots: readonly string[]): Promise<string | undefined> {
    const selected = await window.showQuickPick(
      roots.map(uri => ({ label: Uri.parse(uri).fsPath, uri })),
      { placeHolder: 'Select a discovery root to remove' },
    );
    return selected?.uri;
  }

  async pickWorkspace(
    entries: readonly ProjectEntry[],
    currentUri?: string,
  ): Promise<ProjectEntry | undefined> {
    const selected = await window.showQuickPick(
      buildProjectQuickPickItems(entries, currentUri),
      {
        placeHolder: 'Select a workspace',
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );
    return selected?.entry;
  }

  async inputAlias(entry: ProjectEntry): Promise<string | undefined> {
    return await window.showInputBox({
      prompt: 'Enter a name for this workspace',
      value: entry.alias ?? projectLabel(entry),
    });
  }

  async showInfo(message: string): Promise<void> {
    await window.showInformationMessage(message);
  }

  async showWarning(message: string): Promise<void> {
    await window.showWarningMessage(message);
  }

  async showError(message: string): Promise<void> {
    await window.showErrorMessage(message);
  }

  async revealFile(uri: string): Promise<void> {
    await vscodeCommands.executeCommand('revealFileInOS', Uri.parse(uri));
  }
}

export function registerWorkspaceCommands(
  dependencies: RegisterWorkspaceCommandsDependencies,
): Disposable[] {
  const ui = dependencies.ui ?? new VscodeWorkspaceUi();
  const roots = dependencies.roots ?? new VscodeDiscoveryRootSettings();
  const commandRegistry = dependencies.commands ?? vscodeCommands;

  const selectEntry = async (argument?: EntryArgument): Promise<ProjectEntry | undefined> => {
    if (argument === undefined) {
      return ui.pickWorkspace(
        dependencies.registry.list(),
        dependencies.current.workspaceFileUri(),
      );
    }
    const id = entryId(argument);
    const entry = id ? dependencies.registry.get(id) : undefined;
    if (!entry) throw new Error('Workspace is no longer registered.');
    return entry;
  };

  const open = async (mode: OpenMode, argument?: EntryArgument): Promise<void> => {
    const entry = await selectEntry(argument);
    if (!entry) return;
    const result = await dependencies.opener.open(entry.id, mode);
    dependencies.tree.refresh();
    if (result.status === 'missing') await ui.showWarning('Workspace no longer exists.');
  };

  const addWorkspace = async (): Promise<void> => {
    const selected = (await ui.pickWorkspaceFiles())
      .map(uri => dependencies.fs.canonicalize(uri));
    if (selected.some(uri => !isWorkspaceFileUri(uri))) {
      throw new Error('Select a .code-workspace file.');
    }
    for (const uri of selected) await dependencies.registry.upsertManualWorkspace(uri);
    if (selected.length > 0) dependencies.tree.refresh();
  };

  const refreshAfterSettingsChange = async (): Promise<void> => {
    await dependencies.coordinator.refresh('settings-change');
    dependencies.tree.refresh();
  };

  const addDiscoveryRoot = async (): Promise<void> => {
    const selected = await ui.pickDiscoveryRoot();
    if (!selected) return;
    const canonical = dependencies.fs.canonicalize(selected);
    const configured = roots.configuredRoots()
      .map(root => dependencies.fs.canonicalize(root));
    await roots.update([...new Set([...configured, canonical])]);
    await refreshAfterSettingsChange();
  };

  const removeDiscoveryRoot = async (): Promise<void> => {
    const existing = roots.configuredRoots();
    const selected = await ui.pickDiscoveryRootToRemove(existing);
    if (!selected) return;
    const canonicalSelected = dependencies.fs.canonicalize(selected);
    const configured = [...new Set(
      existing.map(root => dependencies.fs.canonicalize(root)),
    )];
    await roots.update(configured.filter(root => root !== canonicalSelected));
    await refreshAfterSettingsChange();
  };

  const refresh = async (): Promise<void> => {
    const result = await dependencies.coordinator.refresh('manual');
    dependencies.tree.refresh();
    if (result.removed > 0) {
      const suffix = result.removed === 1 ? 'workspace' : 'workspaces';
      await ui.showInfo(`Removed ${result.removed} missing ${suffix}.`);
    }
    if (result.errors.length > 0) {
      await ui.showWarning(result.errors.map(error => {
        const detail = error.error ?? 'Unknown scan error.';
        return `Unable to scan ${error.rootUri}: ${detail}`;
      }).join('\n'));
    }
  };

  const rename = async (argument?: EntryArgument): Promise<void> => {
    const entry = await selectEntry(argument);
    if (!entry) return;
    const alias = await ui.inputAlias(entry);
    if (alias === undefined) return;
    await dependencies.registry.setAlias(entry.id, alias.trim());
    dependencies.tree.refresh();
  };

  const resetName = async (argument?: EntryArgument): Promise<void> => {
    const entry = await selectEntry(argument);
    if (!entry) return;
    await dependencies.registry.resetAlias(entry.id);
    dependencies.tree.refresh();
  };

  const remove = async (argument?: EntryArgument): Promise<void> => {
    const entry = await selectEntry(argument);
    if (!entry) return;
    await dependencies.registry.removeManual(entry.id);
    dependencies.tree.refresh();
  };

  const reveal = async (argument?: EntryArgument): Promise<void> => {
    const entry = await selectEntry(argument);
    if (entry) await ui.revealFile(entry.uri);
  };

  const register = (
    id: string,
    handler: (argument?: EntryArgument) => Promise<void>,
  ): Disposable => commandRegistry.registerCommand(id, (argument?: unknown) => (
    handler(argument as EntryArgument | undefined).catch(async error => {
      await ui.showError(errorMessage(error));
    })
  ));

  return [
    register(commandIds.switchWorkspace, argument => open('reuse', argument)),
    register(commandIds.openNewWindow, argument => open('new', argument)),
    register(commandIds.addWorkspace, addWorkspace),
    register(commandIds.addDiscoveryRoot, addDiscoveryRoot),
    register(commandIds.removeDiscoveryRoot, removeDiscoveryRoot),
    register(commandIds.refresh, refresh),
    register(commandIds.rename, rename),
    register(commandIds.resetName, resetName),
    register(commandIds.remove, remove),
    register(commandIds.reveal, reveal),
    register(openCurrentCommandId, argument => open('reuse', argument)),
  ];
}

function entryId(argument: EntryArgument): string | undefined {
  if (typeof argument === 'string') return argument;
  if ('entry' in argument && argument.entry) return argument.entry.id;
  return argument.id;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
