import {
  commands,
  window,
  workspace,
  type ExtensionContext,
} from 'vscode';
import { registerProjectCommands } from './commands/registerCommands.js';
import { WorkspaceDiscoveryService } from './domain/discovery.js';
import { ProjectReconciler } from './domain/reconciler.js';
import { ProjectRegistry } from './domain/projectRegistry.js';
import { resolveCurrentProjectUri } from './platform/currentProject.js';
import {
  DiscoveryCoordinator,
  type RefreshReason,
} from './platform/discoveryCoordinator.js';
import { VscodeFileSystem } from './platform/vscodeFileSystem.js';
import { VscodeRegistryStorage } from './platform/vscodeRegistryStorage.js';
import { ProjectOpener } from './platform/projectOpener.js';
import { ProjectTreeProvider } from './ui/projectTreeProvider.js';
import { VscodeExcludedWorkspacePicker } from './ui/excludedWorkspaceQuickPick.js';

export async function activate(context: ExtensionContext): Promise<void> {
  const registry = new ProjectRegistry(new VscodeRegistryStorage(context.globalState));
  const loaded = await registry.load();
  const loadWarning = registryLoadWarning(loaded);
  if (loadWarning) void window.showWarningMessage(loadWarning);

  const fs = new VscodeFileSystem();
  const currentWorkspace = {
    workspaceFileUri: (): string | undefined => workspace.workspaceFile?.toString(),
  };
  const currentProject = {
    currentProjectUri: (): string | undefined => {
      const resolved = resolveCurrentProjectUri({
        workspaceFileUri: workspace.workspaceFile?.toString(),
        workspaceFolderUris: workspace.workspaceFolders
          ?.map(folder => folder.uri.toString()) ?? [],
      });
      return resolved ? fs.canonicalize(resolved) : undefined;
    },
  };
  const settings = {
    configuredRoots: (): readonly string[] => workspace
      .getConfiguration('routebox')
      .get<string[]>('discoveryRoots', []),
  };
  const discovery = new WorkspaceDiscoveryService(fs);
  const reconciler = new ProjectReconciler(registry, fs);
  const tree = new ProjectTreeProvider(registry, currentProject);
  const excludedPicker = new VscodeExcludedWorkspacePicker();
  const coordinator = new DiscoveryCoordinator({
    settings,
    current: currentWorkspace,
    fs,
    discovery,
    reconciler,
    registry,
    onDidRefresh: (reason, result): void => {
      tree.refresh();
      const message = activationCleanupMessage(reason, result.removed);
      if (message) void window.showInformationMessage(message);
    },
  });
  const opener = new ProjectOpener(
    registry,
    fs,
    {
      execute: async (command, ...args): Promise<unknown> => commands.executeCommand(
        command,
        ...args,
      ),
    },
    { now: (): number => Date.now() },
  );
  const treeView = window.createTreeView('routebox.projects', {
    treeDataProvider: tree,
  });

  const refresh = (reason: RefreshReason): void => {
    void coordinator.refresh(reason).catch(
      (error: unknown): void => {
        const detail = error instanceof Error ? error.message : String(error);
        void window.showWarningMessage(`Routebox could not refresh projects: ${detail}`);
      },
    );
  };

  context.subscriptions.push(
    coordinator,
    tree,
    treeView,
    ...registerProjectCommands({
      registry,
      coordinator,
      opener,
      tree,
      fs,
      current: currentProject,
      excludedPicker,
    }),
    treeView.onDidChangeVisibility(event => {
      if (event.visible) refresh('view-visible');
    }),
    workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('routebox.discoveryRoots')) {
        refresh('settings-change');
      }
    }),
    workspace.onDidChangeWorkspaceFolders(() => { refresh('workspace-change'); }),
  );

  refresh('activation');
}

export function activationCleanupMessage(
  reason: RefreshReason,
  removed: number,
): string | undefined {
  if (reason !== 'activation' || removed <= 0) return undefined;
  const suffix = removed === 1 ? 'project' : 'projects';
  return `Removed ${removed} missing ${suffix}.`;
}

export function registryLoadWarning(result: {
  discarded: number;
  reset: boolean;
  migrated: number;
}): string | undefined {
  if (result.reset) {
    return 'Routebox could not read its local registry and started with an empty list.';
  }
  if (result.discarded <= 0) return undefined;
  const suffix = result.discarded === 1 ? 'project' : 'projects';
  return `Routebox ignored ${result.discarded} invalid saved ${suffix}.`;
}

export function deactivate(): void {}
