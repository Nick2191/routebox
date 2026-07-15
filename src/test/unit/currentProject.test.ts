import { describe, expect, it } from 'vitest';
import { resolveCurrentProjectUri } from '../../platform/currentProject.js';

describe('resolveCurrentProjectUri', () => {
  it.each([
    [{ workspaceFileUri: 'file:///work/atlas.code-workspace', workspaceFolderUris: ['file:///work/a'] }, 'file:///work/atlas.code-workspace'],
    [{ workspaceFolderUris: ['file:///work/atlas'] }, 'file:///work/atlas'],
    [{ workspaceFileUri: 'untitled:Untitled-1', workspaceFolderUris: ['file:///work/atlas'] }, undefined],
    [{ workspaceFolderUris: ['file:///work/a', 'file:///work/b'] }, undefined],
    [{ workspaceFolderUris: ['vscode-remote://ssh-remote%2Bhost/work'] }, undefined],
  ] as const)('resolves current project from %o', (snapshot, expected) => {
    expect(resolveCurrentProjectUri(snapshot)).toBe(expected);
  });
});
