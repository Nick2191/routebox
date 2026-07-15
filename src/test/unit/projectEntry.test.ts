import { describe, expect, it } from 'vitest';
import {
  isWorkspaceFileUri,
  projectLabel,
  sortProjectEntries,
  type ProjectEntry,
  type ProjectKind,
} from '../../domain/projectEntry.js';

const project = (uri: string, kind: ProjectKind, alias?: string): ProjectEntry => ({
  id: uri,
  uri,
  kind,
  alias,
  manuallyRegistered: true,
  discoveredFrom: [],
});

describe('project entries', () => {
  it('derives workspace and folder labels while preferring aliases', () => {
    expect(projectLabel(project('file:///work/atlas.code-workspace', 'workspace')))
      .toBe('atlas');
    expect(projectLabel(project('file:///work/My%20Folder', 'folder')))
      .toBe('My Folder');
    expect(projectLabel(project('file:///work/My%20Folder', 'folder', 'Personal')))
      .toBe('Personal');
  });

  it('handles Windows drive-letter file URIs', () => {
    const uri = 'file:///C:/Users/Nick/My%20Workspace.CODE-WORKSPACE?profile=windows';

    expect(isWorkspaceFileUri(uri)).toBe(true);
    expect(projectLabel(project(uri, 'workspace'))).toBe('My Workspace');
  });

  it('handles UNC file URIs', () => {
    const uri = 'file://workspace-server/projects/Team%20Atlas.code-workspace#current';

    expect(isWorkspaceFileUri(uri)).toBe(true);
    expect(projectLabel(project(uri, 'workspace'))).toBe('Team Atlas');
  });

  it('decodes percent-encoded workspace filenames', () => {
    const uri = 'file:///work/R%26D%20Atlas%2Ecode-workspace';

    expect(isWorkspaceFileUri(uri)).toBe(true);
    expect(projectLabel(project(uri, 'workspace'))).toBe('R&D Atlas');
  });

  it('accepts only code-workspace URI paths case-insensitively', () => {
    expect(isWorkspaceFileUri('file:///work/a.code-workspace')).toBe(true);
    expect(isWorkspaceFileUri('file:///work/a.CoDe-WoRkSpAcE?profile=case-test')).toBe(true);
    expect(isWorkspaceFileUri('file:///work/a.json')).toBe(false);
  });

  it('places the current project first then sorts by effective label', () => {
    const values = [
      project('file:///work/z.code-workspace', 'workspace'),
      project('file:///work/a.code-workspace', 'workspace'),
      project('file:///work/m.code-workspace', 'workspace', 'Beta'),
    ];
    expect(sortProjectEntries(values, values[0]!.uri).map(projectLabel)).toEqual([
      'z',
      'a',
      'Beta',
    ]);
  });
});
