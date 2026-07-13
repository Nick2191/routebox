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

  it('accepts only code-workspace URIs case-insensitively', () => {
    expect(isWorkspaceFileUri('file:///work/a.code-workspace')).toBe(true);
    expect(isWorkspaceFileUri('file:///work/a.CODE-WORKSPACE')).toBe(true);
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
