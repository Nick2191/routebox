import { Uri } from 'vscode';
import { afterEach, describe, expect, it } from 'vitest';
import { VscodeProjectUi } from '../../commands/registerCommands.js';
import type { ProjectEntry, ProjectKind } from '../../domain/projectEntry.js';
import { buildProjectQuickPickItems } from '../../ui/projectQuickPick.js';
import { setOpenDialog, setQuickPick } from '../adapters/vscode.js';

const project = (uri: string, kind: ProjectKind, alias?: string): ProjectEntry => ({
  id: uri,
  uri,
  kind,
  alias,
  manuallyRegistered: true,
  discoveredFrom: [],
});

describe('buildProjectQuickPickItems', () => {
  afterEach(() => {
    setOpenDialog(() => Promise.resolve(undefined));
    setQuickPick(() => Promise.resolve(undefined));
  });

  it('builds searchable workspace and folder items with stable kind icons', () => {
    const workspace = project('file:///work/atlas.code-workspace', 'workspace', 'Atlas');
    const folder = project('file:///work/personal', 'folder');

    expect(buildProjectQuickPickItems([folder, workspace], folder.uri)).toEqual([
      expect.objectContaining({
        label: '$(folder) personal',
        description: 'Folder · Current',
        detail: Uri.parse(folder.uri).fsPath,
        entry: folder,
      }),
      expect.objectContaining({
        label: '$(window) Atlas',
        description: 'Workspace',
        detail: Uri.parse(workspace.uri).fsPath,
        entry: workspace,
      }),
    ]);
  });

  it('uses the effective project label for entries without aliases', () => {
    const workspace = project('file:///work/My%20Workspace.code-workspace', 'workspace');
    const folder = project('file:///work/My%20Folder', 'folder');

    expect(buildProjectQuickPickItems([workspace, folder])).toEqual([
      expect.objectContaining({
        label: '$(folder) My Folder',
        description: 'Folder',
      }),
      expect.objectContaining({
        label: '$(window) My Workspace',
        description: 'Workspace',
      }),
    ]);
  });

  it.each([
    'file:///C:/Users/Nick/My%20Workspace.code-workspace',
    'file://workspace-server/projects/Team%20Atlas.code-workspace',
  ])('uses the VS Code native display path for %s', uri => {
    const entry = project(uri, 'workspace');

    expect(buildProjectQuickPickItems([entry])[0]?.detail).toBe(Uri.parse(uri).fsPath);
  });

  it('sorts the current project first and remaining entries by effective label', () => {
    const zulu = project('file:///work/zulu', 'folder');
    const alpha = project('file:///work/alpha.code-workspace', 'workspace');
    const aliased = project('file:///work/middle', 'folder', 'Beta');

    expect(buildProjectQuickPickItems([zulu, aliased, alpha], zulu.uri).map(item => item.entry))
      .toEqual([zulu, alpha, aliased]);
  });

  it('enables description and native-path matching in the project Quick Pick', async () => {
    const options: unknown[] = [];
    setQuickPick((_items, value) => {
      options.push(value);
      return Promise.resolve(undefined);
    });

    await new VscodeProjectUi().pickProject([
      project('file:///work/a.code-workspace', 'workspace'),
    ]);

    expect(options).toEqual([{
      placeHolder: 'Select a workspace or folder',
      matchOnDescription: true,
      matchOnDetail: true,
    }]);
  });

  it('offers workspace-file and folder kinds when adding a project', async () => {
    const items: unknown[] = [];
    setQuickPick((value) => {
      items.push(...value);
      return Promise.resolve(value[1]);
    });

    await expect(new VscodeProjectUi().pickProjectKind()).resolves.toBe('folder');
    expect(items).toEqual([
      { label: 'Workspace File', projectKind: 'workspace' },
      { label: 'Folder', projectKind: 'folder' },
    ]);
  });

  it('opens a multi-select folder-only dialog for durable folder selections', async () => {
    const options: unknown[] = [];
    setOpenDialog(value => {
      options.push(value);
      return Promise.resolve([Uri.file('/work/My Folder')]);
    });

    await expect(new VscodeProjectUi().pickFolders())
      .resolves.toEqual(['file:///work/My%20Folder']);
    expect(options).toEqual([{
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: true,
    }]);
  });

  it.each([
    ['/work/My Workspace.code-workspace', 'file:///work/My%20Workspace.code-workspace'],
    ['/work/literal%20.code-workspace', 'file:///work/literal%2520.code-workspace'],
    ['/work/literal%2F.code-workspace', 'file:///work/literal%252F.code-workspace'],
  ])('encodes durable workspace selections for %s', async (path, expected) => {
    setOpenDialog(() => Promise.resolve([Uri.file(path)]));

    await expect(new VscodeProjectUi().pickWorkspaceFiles()).resolves.toEqual([expected]);
  });

  it('encodes durable discovery-root selections', async () => {
    setOpenDialog(() => Promise.resolve([Uri.file('/work/My Roots')]));

    await expect(new VscodeProjectUi().pickDiscoveryRoot())
      .resolves.toBe('file:///work/My%20Roots');
  });
});
