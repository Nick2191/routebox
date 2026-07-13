import { posix } from 'node:path';
import {
  EventEmitter,
  MarkdownString,
  ThemeIcon,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
} from 'vscode';
import {
  sortWorkspaceEntries,
  workspaceLabel,
  type WorkspaceEntry,
  type WorkspaceSourceId,
} from '../domain/workspaceEntry.js';

interface RegistryTreePort { list(): WorkspaceEntry[] }
interface CurrentWorkspacePort { workspaceFileUri(): string | undefined }

export class WorkspaceTreeItem extends TreeItem {
  constructor(readonly entry: WorkspaceEntry, currentUri?: string) {
    super(workspaceLabel(entry), TreeItemCollapsibleState.None);
    const uri = Uri.parse(entry.uri);
    const current = entry.uri === currentUri;
    const filename = posix.basename(uri.path);

    this.description = current ? 'Current' : undefined;
    this.tooltip = new MarkdownString(
      `**${filename}**\n\n${uri.fsPath}\n\nStatus: ${current ? 'Current' : 'Available'}\n\n${workspaceProvenance(entry)}`,
    );
    this.contextValue = entry.manuallyRegistered
      ? 'workspace.manual'
      : 'workspace.discovered';
    this.command = {
      command: 'workspaceAtlas.openEntryInCurrentWindow',
      title: 'Open Workspace',
      arguments: [entry.id],
    };
    this.iconPath = new ThemeIcon(current ? 'circle-filled' : 'workspace-untrusted');
  }
}

export class WorkspaceTreeProvider {
  private readonly changeEmitter = new EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly registry: RegistryTreePort,
    private readonly current: CurrentWorkspacePort,
  ) {}

  refresh(): void { this.changeEmitter.fire(); }

  dispose(): void { this.changeEmitter.dispose(); }

  getTreeItem(element: WorkspaceTreeItem): WorkspaceTreeItem { return element; }

  getChildren(element?: WorkspaceTreeItem): WorkspaceTreeItem[] {
    if (element) return [];
    const currentUri = this.current.workspaceFileUri();
    return sortWorkspaceEntries(this.registry.list(), currentUri)
      .map(entry => new WorkspaceTreeItem(entry, currentUri));
  }
}

function workspaceProvenance(entry: WorkspaceEntry): string {
  const values = entry.discoveredFrom.map(sourceProvenance);
  if (entry.manuallyRegistered) values.unshift('Manually registered');
  return values.length > 0 ? values.join(' · ') : 'Discovered workspace';
}

function sourceProvenance(source: WorkspaceSourceId): string {
  if (source.startsWith('current:')) return 'Current workspace area';
  return `Discovery root: ${Uri.parse(source.slice('configured:'.length)).fsPath}`;
}
