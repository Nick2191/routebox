import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

suite('Workspace Atlas extension', () => {
  test('activates and registers its public commands', async () => {
    const extension = vscode.extensions.getExtension('nick.workspace-atlas');
    assert.ok(extension);
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'workspaceAtlas.switchWorkspace',
      'workspaceAtlas.openWorkspaceInNewWindow',
      'workspaceAtlas.addWorkspace',
      'workspaceAtlas.addDiscoveryRoot',
      'workspaceAtlas.removeDiscoveryRoot',
      'workspaceAtlas.refreshWorkspaces',
      'workspaceAtlas.renameWorkspace',
      'workspaceAtlas.resetWorkspaceName',
      'workspaceAtlas.removeWorkspace',
      'workspaceAtlas.revealWorkspaceFile',
      'workspaceAtlas.openEntryInCurrentWindow',
    ]) assert.ok(commands.includes(id), `${id} was not registered`);
  });

  test('contributes its complete workbench surface without keybindings', () => {
    const extension = vscode.extensions.getExtension('nick.workspace-atlas');
    assert.ok(extension);
    const packageJson: unknown = extension.packageJSON;
    assert.deepEqual((packageJson as { contributes?: unknown }).contributes, {
      viewsContainers: {
        activitybar: [{
          id: 'workspaceAtlas',
          title: 'Workspace Atlas',
          icon: 'resources/workspace-atlas.svg',
        }],
      },
      views: {
        workspaceAtlas: [{ id: 'workspaceAtlas.workspaces', name: 'Workspaces' }],
      },
      commands: [
        { command: 'workspaceAtlas.switchWorkspace', title: 'Workspace Atlas: Switch Workspace' },
        { command: 'workspaceAtlas.openWorkspaceInNewWindow', title: 'Workspace Atlas: Open Workspace in New Window', icon: '$(empty-window)' },
        { command: 'workspaceAtlas.addWorkspace', title: 'Workspace Atlas: Add Workspace...', icon: '$(add)' },
        { command: 'workspaceAtlas.addDiscoveryRoot', title: 'Workspace Atlas: Add Discovery Root...' },
        { command: 'workspaceAtlas.removeDiscoveryRoot', title: 'Workspace Atlas: Remove Discovery Root...' },
        { command: 'workspaceAtlas.refreshWorkspaces', title: 'Workspace Atlas: Refresh Workspaces', icon: '$(refresh)' },
        { command: 'workspaceAtlas.renameWorkspace', title: 'Workspace Atlas: Rename Workspace' },
        { command: 'workspaceAtlas.resetWorkspaceName', title: 'Workspace Atlas: Reset Workspace Name' },
        { command: 'workspaceAtlas.removeWorkspace', title: 'Workspace Atlas: Remove Workspace' },
        { command: 'workspaceAtlas.revealWorkspaceFile', title: 'Workspace Atlas: Reveal Workspace File' },
        { command: 'workspaceAtlas.openEntryInCurrentWindow', title: 'Open Workspace' },
      ],
      menus: {
        'view/title': [
          { command: 'workspaceAtlas.addWorkspace', when: 'view == workspaceAtlas.workspaces', group: 'navigation@1' },
          { command: 'workspaceAtlas.refreshWorkspaces', when: 'view == workspaceAtlas.workspaces', group: 'navigation@2' },
          { command: 'workspaceAtlas.addDiscoveryRoot', when: 'view == workspaceAtlas.workspaces', group: 'management@1' },
          { command: 'workspaceAtlas.removeDiscoveryRoot', when: 'view == workspaceAtlas.workspaces', group: 'management@2' },
        ],
        'view/item/context': [
          { command: 'workspaceAtlas.openWorkspaceInNewWindow', when: 'view == workspaceAtlas.workspaces', group: 'inline@1' },
          { command: 'workspaceAtlas.renameWorkspace', when: 'view == workspaceAtlas.workspaces', group: 'manage@1' },
          { command: 'workspaceAtlas.resetWorkspaceName', when: 'view == workspaceAtlas.workspaces', group: 'manage@2' },
          { command: 'workspaceAtlas.removeWorkspace', when: 'view == workspaceAtlas.workspaces && viewItem == workspace.manual', group: 'manage@3' },
          { command: 'workspaceAtlas.revealWorkspaceFile', when: 'view == workspaceAtlas.workspaces', group: 'navigation@1' },
        ],
      },
      viewsWelcome: [{
        view: 'workspaceAtlas.workspaces',
        contents: 'No workspaces registered.\n[Add Workspace](command:workspaceAtlas.addWorkspace)\n[Add Discovery Root](command:workspaceAtlas.addDiscoveryRoot)',
      }],
      configuration: {
        title: 'Workspace Atlas',
        properties: {
          'workspaceAtlas.discoveryRoots': {
            type: 'array',
            scope: 'machine-overridable',
            default: [],
            items: { type: 'string' },
            description: 'Folder URIs recursively searched for .code-workspace files.',
          },
        },
      },
    });
  });
});
