import { describe, expect, it } from 'vitest';
import {
  isWorkspaceFileUri,
  sortWorkspaceEntries,
  workspaceLabel,
  type WorkspaceEntry,
} from '../../domain/workspaceEntry.js';

const entry = (uri: string, alias?: string): WorkspaceEntry => ({
  id: uri,
  uri,
  alias,
  manuallyRegistered: false,
  discoveredFrom: [],
});

describe('workspace entries', () => {
  it('uses an alias before the workspace filename', () => {
    expect(workspaceLabel(entry('file:///work/bois.code-workspace', 'BOIS'))).toBe('BOIS');
    expect(workspaceLabel(entry('file:///work/bois.code-workspace'))).toBe('bois');
  });

  it('handles Windows drive-letter file URIs', () => {
    const uri = 'file:///C:/Users/Nick/My%20Workspace.CODE-WORKSPACE?profile=windows';

    expect(isWorkspaceFileUri(uri)).toBe(true);
    expect(workspaceLabel(entry(uri))).toBe('My Workspace');
  });

  it('handles UNC file URIs', () => {
    const uri = 'file://workspace-server/projects/Team%20Atlas.code-workspace#current';

    expect(isWorkspaceFileUri(uri)).toBe(true);
    expect(workspaceLabel(entry(uri))).toBe('Team Atlas');
  });

  it('decodes percent-encoded workspace filenames', () => {
    const uri = 'file:///work/R%26D%20Atlas%2Ecode-workspace';

    expect(isWorkspaceFileUri(uri)).toBe(true);
    expect(workspaceLabel(entry(uri))).toBe('R&D Atlas');
  });

  it('accepts only code-workspace URI paths case-insensitively', () => {
    expect(isWorkspaceFileUri('file:///work/a.code-workspace')).toBe(true);
    expect(isWorkspaceFileUri('file:///work/a.CoDe-WoRkSpAcE?profile=case-test')).toBe(true);
    expect(isWorkspaceFileUri('file:///work/a.json')).toBe(false);
  });

  it('places the current workspace first then sorts by effective label', () => {
    const values = [
      entry('file:///work/z.code-workspace'),
      entry('file:///work/a.code-workspace'),
      entry('file:///work/m.code-workspace', 'Beta'),
    ];
    expect(sortWorkspaceEntries(values, values[0]!.uri).map(workspaceLabel)).toEqual([
      'z',
      'a',
      'Beta',
    ]);
  });
});
