import {
  MarkdownString,
  ThemeColor,
  ThemeIcon,
  TreeItemCollapsibleState,
  Uri,
} from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectEntry, ProjectKind } from '../../domain/projectEntry.js';
import {
  ProjectTreeProvider,
  type ProjectTreeItem,
} from '../../ui/projectTreeProvider.js';

const project = (
  uri: string,
  kind: ProjectKind,
  overrides: Partial<ProjectEntry> = {},
): ProjectEntry => ({
  id: uri,
  uri,
  kind,
  manuallyRegistered: true,
  discoveredFrom: [],
  ...overrides,
});

const current = project('file:///work/personal', 'folder');

const discovered = project(
  'file:///work/zulu/Current%20Workspace.code-workspace',
  'workspace',
  {
    manuallyRegistered: false,
    discoveredFrom: ['current:file:///work'],
  },
);

const manual = project('file:///outside/alpha.code-workspace', 'workspace', {
  alias: 'Alpha',
});

function createProvider(): ProjectTreeProvider {
  return new ProjectTreeProvider(
    { list: () => [manual, discovered, current] },
    { currentProjectUri: () => current.uri },
  );
}

describe('ProjectTreeProvider', () => {
  it('uses the current-project icon while marking the current folder', () => {
    const item = createProvider().getChildren()[0];

    expect(item?.entry).toEqual(current);
    expect(item?.label).toBe('personal');
    expect(item?.description).toBe('Current');
    expect(item?.iconPath).toEqual(
      new ThemeIcon('pass-filled', new ThemeColor('charts.blue')),
    );
    expect(item?.contextValue).toBe('project.manual');
    expect(item?.collapsibleState).toBe(TreeItemCollapsibleState.None);
    expect(item?.command).toEqual({
      command: 'workspaceAtlas.openEntryInCurrentWindow',
      title: 'Open Project',
      arguments: [current.id],
    });
  });

  it('uses the current-project icon for a current workspace', () => {
    const currentWorkspace = project(
      'file:///work/current.code-workspace',
      'workspace',
    );
    const provider = new ProjectTreeProvider(
      { list: (): ProjectEntry[] => [currentWorkspace] },
      { currentProjectUri: (): string => currentWorkspace.uri },
    );

    const item = provider.getChildren()[0];

    expect(item?.description).toBe('Current');
    expect(item?.iconPath).toEqual(
      new ThemeIcon('pass-filled', new ThemeColor('charts.blue')),
    );
  });

  it('uses a stable workspace icon and discovered project context', () => {
    const item = createProvider().getChildren()[2];

    expect(item?.entry).toEqual(discovered);
    expect(item?.contextValue).toBe('project.discovered');
    expect(item?.iconPath).toEqual(new ThemeIcon('file-code'));
  });

  it('leaves the available folder kind icon uncolored', () => {
    const availableFolder = project('file:///work/available', 'folder');
    const provider = new ProjectTreeProvider(
      { list: (): ProjectEntry[] => [availableFolder] },
      { currentProjectUri: (): undefined => undefined },
    );

    expect(provider.getChildren()[0]?.iconPath).toEqual(new ThemeIcon('folder-opened'));
  });

  it('shows project type, path, status, and provenance in the tooltip', () => {
    const item = createProvider().getChildren()[0];

    expect(item?.tooltip).toBeInstanceOf(MarkdownString);
    const tooltip = (item?.tooltip as MarkdownString).value;
    expect(tooltip).toContain('**personal**');
    expect(tooltip).toContain('Type: Folder');
    expect(tooltip).toContain(Uri.parse(current.uri).fsPath);
    expect(tooltip).toContain('Status: Current');
    expect(tooltip).toContain('Manually registered');
  });

  it('identifies an available discovered workspace and its source in the tooltip', () => {
    const item = createProvider().getChildren()[2];

    expect(item?.tooltip).toBeInstanceOf(MarkdownString);
    const tooltip = (item?.tooltip as MarkdownString).value;
    expect(tooltip).toContain('**Current Workspace.code-workspace**');
    expect(tooltip).toContain('Type: Workspace');
    expect(tooltip).toContain(Uri.parse(discovered.uri).fsPath);
    expect(tooltip).toContain('Current workspace area');
    expect(tooltip).toContain('Status: Available');
  });

  it('identifies a manually registered workspace in its tooltip', () => {
    const item = createProvider().getChildren()[1];

    expect(item?.tooltip).toBeInstanceOf(MarkdownString);
    const tooltip = (item?.tooltip as MarkdownString).value;
    expect(tooltip).toContain('**alpha.code-workspace**');
    expect(tooltip).toContain('Type: Workspace');
    expect(tooltip).toContain(Uri.parse(manual.uri).fsPath);
    expect(tooltip).toContain('Manually registered');
    expect(tooltip).toContain('Status: Available');
  });

  it('returns the native item and fires one tree-change event on refresh', () => {
    const provider = createProvider();
    const listener = vi.fn();
    provider.onDidChangeTreeData(listener);
    const item = provider.getChildren()[0] as ProjectTreeItem;

    expect(provider.getTreeItem(item)).toBe(item);
    provider.refresh();

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(undefined);
  });

  it('returns no children for project items', () => {
    const provider = createProvider();
    const item = provider.getChildren()[0] as ProjectTreeItem;

    expect(provider.getChildren(item)).toEqual([]);
  });

  it('disposes its tree-change event emitter', () => {
    const provider = createProvider();
    const listener = vi.fn();
    provider.onDidChangeTreeData(listener);

    provider.dispose();
    provider.refresh();

    expect(listener).not.toHaveBeenCalled();
  });
});
