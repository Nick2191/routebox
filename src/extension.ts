import {
  commands,
  window,
  workspace,
  type ExtensionContext,
} from 'vscode';
import { registerWorkspaceCommands } from './commands/registerCommands.js';
import { WorkspaceDiscoveryService } from './domain/discovery.js';
import { WorkspaceReconciler } from './domain/reconciler.js';
import { WorkspaceRegistry } from './domain/workspaceRegistry.js';
import {
  DiscoveryCoordinator,
  type RefreshReason,
} from './platform/discoveryCoordinator.js';
import { VscodeFileSystem } from './platform/vscodeFileSystem.js';
import { VscodeRegistryStorage } from './platform/vscodeRegistryStorage.js';
import { WorkspaceOpener } from './platform/workspaceOpener.js';
import { WorkspaceTreeProvider } from './ui/workspaceTreeProvider.js';

export async function activate(context: ExtensionContext): Promise<void> {
  const registry = new WorkspaceRegistry(new VscodeRegistryStorage(context.globalState));
  const loaded = await registry.load();
  if (loaded.reset) {
    void window.showWarningMessage(
      'Workspace Atlas could not read its local registry and started with an empty list.',
    );
  }

  const fs = new VscodeFileSystem();
  const current = {
    workspaceFileUri: (): string | undefined => workspace.workspaceFile?.toString(true),
  };
  const settings = {
    configuredRoots: (): readonly string[] => workspace
      .getConfiguration('workspaceAtlas')
      .get<string[]>('discoveryRoots', []),
  };
  const discovery = new WorkspaceDiscoveryService(fs);
  const reconciler = new WorkspaceReconciler(registry, fs);
  const coordinator = new DiscoveryCoordinator({
    settings,
    current,
    fs,
    discovery,
    reconciler,
    registry,
  });
  const opener = new WorkspaceOpener(
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
  const tree = new WorkspaceTreeProvider(registry, current);
  const treeView = window.createTreeView('workspaceAtlas.workspaces', {
    treeDataProvider: tree,
  });

  const refresh = (reason: RefreshReason): void => {
    void coordinator.refresh(reason).then(
      () => { tree.refresh(); },
      (error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        void window.showWarningMessage(`Workspace Atlas could not refresh workspaces: ${detail}`);
      },
    );
  };

  context.subscriptions.push(
    coordinator,
    tree,
    treeView,
    ...registerWorkspaceCommands({
      registry,
      coordinator,
      opener,
      tree,
      fs,
      current,
    }),
    treeView.onDidChangeVisibility(event => {
      if (event.visible) refresh('view-visible');
    }),
    workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('workspaceAtlas.discoveryRoots')) {
        refresh('settings-change');
      }
    }),
    workspace.onDidChangeWorkspaceFolders(() => { refresh('workspace-change'); }),
  );

  refresh('activation');
}
export function deactivate(): void {}
