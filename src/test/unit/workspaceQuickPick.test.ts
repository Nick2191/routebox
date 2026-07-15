import { Uri } from 'vscode';
import { afterEach, describe, expect, it } from 'vitest';
import { VscodeWorkspaceUi } from '../../commands/registerCommands.js';
import type { ProjectEntry } from '../../domain/projectEntry.js';
import { buildWorkspaceQuickPickItems } from '../../ui/workspaceQuickPick.js';
import { setOpenDialog, setQuickPick } from '../adapters/vscode.js';

function workspaceEntry(uri: string, alias?: string): ProjectEntry {
  return {
    id: uri,
    uri,
    kind: 'workspace',
    alias,
    manuallyRegistered: false,
    discoveredFrom: [],
  };
}

describe('buildWorkspaceQuickPickItems', () => {
  afterEach(() => {
    setOpenDialog(() => Promise.resolve(undefined));
    setQuickPick(() => Promise.resolve(undefined));
  });

  it('includes searchable alias, filename, native path, current indicator, and entry', () => {
    const entry = workspaceEntry('file:///work/a.code-workspace', 'Alpha');

    expect(buildWorkspaceQuickPickItems([entry], entry.uri)[0]).toMatchObject({
      label: '$(circle-filled) Alpha',
      description: 'a.code-workspace · Current',
      detail: Uri.parse(entry.uri).fsPath,
      entry,
    });
  });

  it('uses the filename label and description for entries without aliases', () => {
    const entry = workspaceEntry('file:///work/My%20Workspace.code-workspace');

    expect(buildWorkspaceQuickPickItems([entry])[0]).toMatchObject({
      label: 'My Workspace',
      description: 'My Workspace.code-workspace',
      detail: Uri.parse(entry.uri).fsPath,
      entry,
    });
  });

  it.each([
    'file:///C:/Users/Nick/My%20Workspace.code-workspace',
    'file://workspace-server/projects/Team%20Atlas.code-workspace',
  ])('uses the VS Code native display path for %s', uri => {
    const entry = workspaceEntry(uri);

    expect(buildWorkspaceQuickPickItems([entry])[0]?.detail).toBe(Uri.parse(uri).fsPath);
  });

  it('sorts the current entry first and remaining entries by effective label', () => {
    const zulu = workspaceEntry('file:///work/zulu.code-workspace');
    const alpha = workspaceEntry('file:///work/alpha.code-workspace');
    const aliased = workspaceEntry('file:///work/middle.code-workspace', 'Beta');

    expect(buildWorkspaceQuickPickItems([zulu, aliased, alpha], zulu.uri).map(item => item.entry))
      .toEqual([zulu, alpha, aliased]);
  });

  it('enables filename and native-path matching in the workspace Quick Pick', async () => {
    const options: unknown[] = [];
    setQuickPick((_items, value) => {
      options.push(value);
      return Promise.resolve(undefined);
    });

    await new VscodeWorkspaceUi().pickWorkspace([workspaceEntry('file:///work/a.code-workspace')]);

    expect(options).toEqual([{
      placeHolder: 'Select a workspace',
      matchOnDescription: true,
      matchOnDetail: true,
    }]);
  });

  it.each([
    ['/work/My Workspace.code-workspace', 'file:///work/My%20Workspace.code-workspace'],
    ['/work/literal%20.code-workspace', 'file:///work/literal%2520.code-workspace'],
    ['/work/literal%2F.code-workspace', 'file:///work/literal%252F.code-workspace'],
  ])('encodes durable workspace selections for %s', async (path, expected) => {
    setOpenDialog(() => Promise.resolve([Uri.file(path)]));

    await expect(new VscodeWorkspaceUi().pickWorkspaceFiles()).resolves.toEqual([expected]);
  });

  it('encodes durable discovery-root selections', async () => {
    setOpenDialog(() => Promise.resolve([Uri.file('/work/My Roots')]));

    await expect(new VscodeWorkspaceUi().pickDiscoveryRoot())
      .resolves.toBe('file:///work/My%20Roots');
  });
});
