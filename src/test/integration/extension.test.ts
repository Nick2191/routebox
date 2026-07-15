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
      'workspaceAtlas.addProject',
      'workspaceAtlas.addWorkspace',
      'workspaceAtlas.addFolder',
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
    const contributes = (extension.packageJSON as { contributes?: Record<string, unknown> })
      .contributes;
    assert.ok(contributes);
    assert.deepEqual(contributes.views, {
      workspaceAtlas: [{ id: 'workspaceAtlas.workspaces', name: 'Projects' }],
    });
    assert.deepEqual(contributes.commands, [
      { command: 'workspaceAtlas.switchWorkspace', title: 'Workspace Atlas: Switch Project' },
      { command: 'workspaceAtlas.openWorkspaceInNewWindow', title: 'Workspace Atlas: Open Project in New Window', icon: '$(empty-window)' },
      { command: 'workspaceAtlas.addProject', title: 'Workspace Atlas: Add Project...', icon: '$(add)' },
      { command: 'workspaceAtlas.addWorkspace', title: 'Workspace Atlas: Add Workspace...' },
      { command: 'workspaceAtlas.addFolder', title: 'Workspace Atlas: Add Folder...' },
      { command: 'workspaceAtlas.addDiscoveryRoot', title: 'Workspace Atlas: Add Discovery Root...' },
      { command: 'workspaceAtlas.removeDiscoveryRoot', title: 'Workspace Atlas: Remove Discovery Root...' },
      { command: 'workspaceAtlas.refreshWorkspaces', title: 'Workspace Atlas: Refresh Projects', icon: '$(refresh)' },
      { command: 'workspaceAtlas.renameWorkspace', title: 'Workspace Atlas: Rename Project' },
      { command: 'workspaceAtlas.resetWorkspaceName', title: 'Workspace Atlas: Reset Project Name' },
      { command: 'workspaceAtlas.removeWorkspace', title: 'Workspace Atlas: Remove from Workspace Atlas' },
      { command: 'workspaceAtlas.revealWorkspaceFile', title: 'Workspace Atlas: Reveal in File Manager' },
      { command: 'workspaceAtlas.openEntryInCurrentWindow', title: 'Open Project' },
    ]);

    assert.deepEqual(contributes.viewsContainers, {
      activitybar: [{
        id: 'workspaceAtlas',
        title: 'Workspace Atlas',
        icon: 'resources/workspace-routes-thin.svg',
      }],
    });
    const menus = contributes.menus as Record<string, unknown>;
    assert.deepEqual(menus['view/title'], [
      { command: 'workspaceAtlas.addProject', when: 'view == workspaceAtlas.workspaces', group: 'navigation@1' },
      { command: 'workspaceAtlas.refreshWorkspaces', when: 'view == workspaceAtlas.workspaces', group: 'navigation@2' },
      { command: 'workspaceAtlas.addDiscoveryRoot', when: 'view == workspaceAtlas.workspaces', group: 'management@1' },
      { command: 'workspaceAtlas.removeDiscoveryRoot', when: 'view == workspaceAtlas.workspaces', group: 'management@2' },
    ]);
    assert.deepEqual(menus['view/item/context'], [
      { command: 'workspaceAtlas.openWorkspaceInNewWindow', when: 'view == workspaceAtlas.workspaces', group: 'inline@1' },
      { command: 'workspaceAtlas.renameWorkspace', when: 'view == workspaceAtlas.workspaces', group: 'manage@1' },
      { command: 'workspaceAtlas.resetWorkspaceName', when: 'view == workspaceAtlas.workspaces', group: 'manage@2' },
      { command: 'workspaceAtlas.removeWorkspace', when: 'view == workspaceAtlas.workspaces && viewItem == project.manual', group: 'manage@3' },
      { command: 'workspaceAtlas.revealWorkspaceFile', when: 'view == workspaceAtlas.workspaces', group: 'navigation@1' },
    ]);
    assert.deepEqual(contributes.viewsWelcome, [{
      view: 'workspaceAtlas.workspaces',
      contents: 'No projects registered.\n[Add Project](command:workspaceAtlas.addProject)\n[Add Discovery Root](command:workspaceAtlas.addDiscoveryRoot)',
    }]);
    assert.equal('keybindings' in contributes, false);
  });
});
