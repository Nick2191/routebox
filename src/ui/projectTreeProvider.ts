import { posix } from 'node:path';
import {
  EventEmitter,
  MarkdownString,
  ThemeColor,
  ThemeIcon,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
} from 'vscode';
import {
  projectLabel,
  sortProjectEntries,
  type ProjectEntry,
  type WorkspaceSourceId,
} from '../domain/projectEntry.js';

interface RegistryTreePort { list(): ProjectEntry[] }
interface CurrentProjectPort { currentProjectUri(): string | undefined }

export class ProjectTreeItem extends TreeItem {
  constructor(readonly entry: ProjectEntry, currentUri?: string) {
    super(projectLabel(entry), TreeItemCollapsibleState.None);
    const uri = Uri.parse(entry.uri);
    const current = entry.uri === currentUri;
    const type = entry.kind === 'folder' ? 'Folder' : 'Workspace';
    const originalName = posix.basename(uri.path);

    this.description = current ? 'Current' : undefined;
    const iconId = current
      ? 'pass-filled'
      : entry.kind === 'folder' ? 'folder-opened' : 'file-code';
    this.iconPath = new ThemeIcon(
      iconId,
      current ? new ThemeColor('charts.blue') : undefined,
    );
    this.contextValue = entry.manuallyRegistered
      ? 'project.manual'
      : 'project.discovered';
    this.command = {
      command: 'routebox.openProjectInCurrentWindow',
      title: 'Open Project',
      arguments: [entry.id],
    };
    this.tooltip = new MarkdownString([
      `**${originalName}**`,
      `Type: ${type}`,
      uri.fsPath,
      `Status: ${current ? 'Current' : 'Available'}`,
      projectProvenance(entry),
    ].join('\n\n'));
  }
}

export class ProjectTreeProvider {
  private readonly changeEmitter = new EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly registry: RegistryTreePort,
    private readonly current: CurrentProjectPort,
  ) {}

  refresh(): void { this.changeEmitter.fire(); }

  dispose(): void { this.changeEmitter.dispose(); }

  getTreeItem(element: ProjectTreeItem): ProjectTreeItem { return element; }

  getChildren(element?: ProjectTreeItem): ProjectTreeItem[] {
    if (element) return [];
    const currentUri = this.current.currentProjectUri();
    return sortProjectEntries(this.registry.list(), currentUri)
      .map(entry => new ProjectTreeItem(entry, currentUri));
  }
}

function projectProvenance(entry: ProjectEntry): string {
  const values = entry.discoveredFrom.map(sourceProvenance);
  if (entry.manuallyRegistered) values.unshift('Manually registered');
  return values.length > 0 ? values.join(' · ') : 'Registered project';
}

function sourceProvenance(source: WorkspaceSourceId): string {
  if (source.startsWith('current:')) return 'Current workspace area';
  return `Discovery root: ${Uri.parse(source.slice('configured:'.length)).fsPath}`;
}
