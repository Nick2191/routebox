import { Uri, type QuickPickItem } from 'vscode';
import {
  projectLabel,
  sortProjectEntries,
  type ProjectEntry,
} from '../domain/projectEntry.js';

export interface ProjectQuickPickItem extends QuickPickItem {
  entry: ProjectEntry;
}

export function buildProjectQuickPickItems(
  entries: readonly ProjectEntry[],
  currentUri?: string,
): ProjectQuickPickItem[] {
  return sortProjectEntries(entries, currentUri).map(entry => {
    const current = entry.uri === currentUri;
    const type = entry.kind === 'folder' ? 'Folder' : 'Workspace';
    const icon = entry.kind === 'folder' ? 'folder-opened' : 'file-code';
    return {
      label: `$(${icon}) ${projectLabel(entry)}`,
      description: `${type}${current ? ' · Current' : ''}`,
      detail: Uri.parse(entry.uri).fsPath,
      entry,
    };
  });
}
