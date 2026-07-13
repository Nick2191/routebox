import { Uri } from 'vscode';
import { describe, expect, it } from 'vitest';
import type { WorkspaceEntry } from '../../domain/workspaceEntry.js';
import { buildWorkspaceQuickPickItems } from '../../ui/workspaceQuickPick.js';

function workspaceEntry(uri: string, alias?: string): WorkspaceEntry {
  return {
    id: uri,
    uri,
    alias,
    manuallyRegistered: false,
    discoveredFrom: [],
  };
}

describe('buildWorkspaceQuickPickItems', () => {
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
});
