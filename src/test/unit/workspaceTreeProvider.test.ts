import {
  MarkdownString,
  ThemeIcon,
  TreeItemCollapsibleState,
  Uri,
} from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceEntry } from '../../domain/workspaceEntry.js';
import {
  WorkspaceTreeProvider,
  type WorkspaceTreeItem,
} from '../../ui/workspaceTreeProvider.js';

const current: WorkspaceEntry = {
  id: 'file:///work/zulu/Current%20Workspace.code-workspace',
  uri: 'file:///work/zulu/Current%20Workspace.code-workspace',
  manuallyRegistered: false,
  discoveredFrom: ['current:file:///work'],
};

const manual: WorkspaceEntry = {
  id: 'file:///outside/alpha.code-workspace',
  uri: 'file:///outside/alpha.code-workspace',
  alias: 'Alpha',
  manuallyRegistered: true,
  discoveredFrom: [],
};

function createProvider(): WorkspaceTreeProvider {
  return new WorkspaceTreeProvider(
    { list: () => [manual, current] },
    { workspaceFileUri: () => current.uri },
  );
}

describe('WorkspaceTreeProvider', () => {
  it('places the current workspace first with its indicator and current-window command', () => {
    const [item] = createProvider().getChildren();

    expect(item?.entry).toEqual(current);
    expect(item?.label).toBe('Current Workspace');
    expect(item?.description).toBe('Current');
    expect(item?.iconPath).toEqual(new ThemeIcon('circle-filled'));
    expect(item?.collapsibleState).toBe(TreeItemCollapsibleState.None);
    expect(item?.command).toEqual({
      command: 'workspaceAtlas.openEntryInCurrentWindow',
      title: 'Open Workspace',
      arguments: [current.id],
    });
  });

  it('marks manual workspaces with the manual item context and a workspace icon', () => {
    const item = createProvider().getChildren()[1];

    expect(item?.entry).toEqual(manual);
    expect(item?.contextValue).toBe('workspace.manual');
    expect(item?.iconPath).toEqual(new ThemeIcon('workspace-untrusted'));
  });

  it('includes the filename, native path, and provenance in a Markdown tooltip', () => {
    const item = createProvider().getChildren()[0];

    expect(item?.tooltip).toBeInstanceOf(MarkdownString);
    const tooltip = (item?.tooltip as MarkdownString).value;
    expect(tooltip).toContain('**Current Workspace.code-workspace**');
    expect(tooltip).toContain(Uri.parse(current.uri).fsPath);
    expect(tooltip).toContain('Current workspace area');
    expect(tooltip).toContain('Status: Current');
  });

  it('identifies a non-current workspace as available in its tooltip', () => {
    const item = createProvider().getChildren()[1];

    expect(item?.tooltip).toBeInstanceOf(MarkdownString);
    const tooltip = (item?.tooltip as MarkdownString).value;
    expect(tooltip).toContain('**alpha.code-workspace**');
    expect(tooltip).toContain(Uri.parse(manual.uri).fsPath);
    expect(tooltip).toContain('Manually registered');
    expect(tooltip).toContain('Status: Available');
  });

  it('returns the native item and fires one tree-change event on refresh', () => {
    const provider = createProvider();
    const listener = vi.fn();
    provider.onDidChangeTreeData(listener);
    const item = provider.getChildren()[0] as WorkspaceTreeItem;

    expect(provider.getTreeItem(item)).toBe(item);
    provider.refresh();

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(undefined);
  });
});
