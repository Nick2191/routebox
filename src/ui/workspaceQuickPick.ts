import { posix } from 'node:path';
import { Uri, type QuickPickItem } from 'vscode';
import {
  sortWorkspaceEntries,
  workspaceLabel,
  type WorkspaceEntry,
} from '../domain/workspaceEntry.js';

export interface WorkspaceQuickPickItem extends QuickPickItem {
  entry: WorkspaceEntry;
}

export function buildWorkspaceQuickPickItems(
  entries: readonly WorkspaceEntry[],
  currentUri?: string,
): WorkspaceQuickPickItem[] {
  return sortWorkspaceEntries(entries, currentUri).map(entry => {
    const uri = Uri.parse(entry.uri);
    const filename = posix.basename(uri.path);
    const current = entry.uri === currentUri;
    return {
      label: `${current ? '$(circle-filled) ' : ''}${workspaceLabel(entry)}`,
      description: `${filename}${current ? ' · Current' : ''}`,
      detail: uri.fsPath,
      entry,
    };
  });
}
