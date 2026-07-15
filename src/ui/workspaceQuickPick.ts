import { posix } from 'node:path';
import { Uri, type QuickPickItem } from 'vscode';
import {
  sortProjectEntries,
  projectLabel,
  type ProjectEntry,
} from '../domain/projectEntry.js';

export interface WorkspaceQuickPickItem extends QuickPickItem {
  entry: ProjectEntry;
}

export function buildWorkspaceQuickPickItems(
  entries: readonly ProjectEntry[],
  currentUri?: string,
): WorkspaceQuickPickItem[] {
  return sortProjectEntries(entries, currentUri).map(entry => {
    const uri = Uri.parse(entry.uri);
    const filename = posix.basename(uri.path);
    const current = entry.uri === currentUri;
    return {
      label: `${current ? '$(circle-filled) ' : ''}${projectLabel(entry)}`,
      description: `${filename}${current ? ' · Current' : ''}`,
      detail: uri.fsPath,
      entry,
    };
  });
}
