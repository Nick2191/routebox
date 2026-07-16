import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

function routeboxExtension(): vscode.Extension<unknown> {
  const extension = vscode.extensions.all.find(candidate => {
    const manifest = candidate.packageJSON as { name?: unknown; displayName?: unknown };
    return manifest.name === 'routebox' && manifest.displayName === 'Routebox';
  });
  assert.ok(extension);
  const manifest = extension.packageJSON as { publisher?: unknown };
  assert.ok(typeof manifest.publisher === 'string');
  assert.equal(extension.id, `${manifest.publisher}.routebox`);
  return extension;
}

suite('Routebox extension', () => {
  test('activates and registers its public commands', async () => {
    const extension = routeboxExtension();
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'routebox.switchProject',
      'routebox.openProjectInNewWindow',
      'routebox.addProject',
      'routebox.addWorkspace',
      'routebox.addFolder',
      'routebox.addDiscoveryRoot',
      'routebox.removeDiscoveryRoot',
      'routebox.refreshProjects',
      'routebox.showExcludedWorkspaces',
      'routebox.renameProject',
      'routebox.resetProjectName',
      'routebox.removeProject',
      'routebox.revealProject',
      'routebox.openProjectInCurrentWindow',
    ]) assert.ok(commands.includes(id), `${id} was not registered`);
  });

  test('contributes its complete workbench surface without keybindings', () => {
    const extension = routeboxExtension();
    const manifest = extension.packageJSON as Record<string, unknown>;
    assert.deepEqual(manifest.repository, {
      type: 'git',
      url: 'https://github.com/Nick2191/routebox.git',
    });
    assert.equal(manifest.homepage, 'https://github.com/Nick2191/routebox#readme');
    assert.deepEqual(manifest.bugs, {
      url: 'https://github.com/Nick2191/routebox/issues',
    });
    assert.equal(manifest.pricing, 'Free');
    assert.equal(manifest.icon, 'resources/routebox-marketplace.png');
    assert.deepEqual(manifest.galleryBanner, {
      color: '#172033',
      theme: 'dark',
    });
    assert.deepEqual(manifest.categories, ['Other']);
    assert.deepEqual(manifest.keywords, [
      'workspace',
      'switcher',
      'code-workspace',
      'project manager',
      'folder',
      'project switcher',
    ]);
    assert.deepEqual(manifest.extensionKind, ['ui']);
    assert.deepEqual(manifest.capabilities, {
      untrustedWorkspaces: { supported: true },
      virtualWorkspaces: {
        supported: false,
        description: 'Routebox manages local workspace files and folders.',
      },
    });
    const contributes = (extension.packageJSON as { contributes?: Record<string, unknown> })
      .contributes;
    assert.ok(contributes);
    assert.deepEqual(contributes.views, {
      routebox: [{ id: 'routebox.projects', name: 'Projects' }],
    });
    assert.deepEqual(contributes.commands, [
      { command: 'routebox.switchProject', title: 'Routebox: Switch Project' },
      { command: 'routebox.openProjectInNewWindow', title: 'Routebox: Open Project in New Window', icon: '$(empty-window)' },
      { command: 'routebox.addProject', title: 'Routebox: Add Project...', icon: '$(add)' },
      { command: 'routebox.addWorkspace', title: 'Routebox: Add Workspace...' },
      { command: 'routebox.addFolder', title: 'Routebox: Add Folder...' },
      { command: 'routebox.addDiscoveryRoot', title: 'Routebox: Add Discovery Root...' },
      { command: 'routebox.removeDiscoveryRoot', title: 'Routebox: Remove Discovery Root...' },
      { command: 'routebox.refreshProjects', title: 'Routebox: Refresh Projects', icon: '$(refresh)' },
      { command: 'routebox.showExcludedWorkspaces', title: 'Routebox: Show Excluded Workspaces', icon: '$(eye-closed)' },
      { command: 'routebox.renameProject', title: 'Routebox: Rename Project' },
      { command: 'routebox.resetProjectName', title: 'Routebox: Reset Project Name' },
      { command: 'routebox.removeProject', title: 'Routebox: Remove from Routebox', icon: '$(trash)' },
      { command: 'routebox.revealProject', title: 'Routebox: Reveal in File Manager' },
      { command: 'routebox.openProjectInCurrentWindow', title: 'Open Project' },
    ]);

    assert.deepEqual(contributes.viewsContainers, {
      activitybar: [{
        id: 'routebox',
        title: 'Routebox',
        icon: 'resources/routebox.svg',
      }],
    });
    const menus = contributes.menus as Record<string, unknown>;
    assert.deepEqual(menus['view/title'], [
      { command: 'routebox.addProject', when: 'view == routebox.projects', group: 'navigation@1' },
      { command: 'routebox.refreshProjects', when: 'view == routebox.projects', group: 'navigation@2' },
      { command: 'routebox.showExcludedWorkspaces', when: 'view == routebox.projects', group: 'navigation@3' },
      { command: 'routebox.addDiscoveryRoot', when: 'view == routebox.projects', group: 'management@1' },
      { command: 'routebox.removeDiscoveryRoot', when: 'view == routebox.projects', group: 'management@2' },
    ]);
    assert.deepEqual(menus['view/item/context'], [
      { command: 'routebox.openProjectInNewWindow', when: 'view == routebox.projects', group: 'inline@1' },
      { command: 'routebox.removeProject', when: 'view == routebox.projects', group: 'inline@2' },
      { command: 'routebox.renameProject', when: 'view == routebox.projects', group: 'manage@1' },
      { command: 'routebox.resetProjectName', when: 'view == routebox.projects', group: 'manage@2' },
      { command: 'routebox.removeProject', when: 'view == routebox.projects', group: 'manage@3' },
      { command: 'routebox.revealProject', when: 'view == routebox.projects', group: 'navigation@1' },
    ]);
    assert.deepEqual(contributes.viewsWelcome, [{
      view: 'routebox.projects',
      contents: 'No projects registered.\n[Add Project](command:routebox.addProject)\n[Add Discovery Root](command:routebox.addDiscoveryRoot)',
    }]);
    const configuration = contributes.configuration as {
      title: string;
      properties: Record<string, unknown>;
    };
    assert.equal(configuration.title, 'Routebox');
    assert.deepEqual(Object.keys(configuration.properties), ['routebox.discoveryRoots']);
    assert.equal('keybindings' in contributes, false);
  });
});
