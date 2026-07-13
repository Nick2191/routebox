import { posix } from 'node:path';
import { Uri } from 'vscode';

export type WorkspaceSourceId = `configured:${string}` | `current:${string}`;

export interface WorkspaceEntry {
  id: string;
  uri: string;
  alias?: string;
  manuallyRegistered: boolean;
  discoveredFrom: WorkspaceSourceId[];
  lastOpenedAt?: number;
}

export function isWorkspaceFileUri(uri: string): boolean {
  return posix.extname(Uri.parse(uri).path).toLowerCase() === '.code-workspace';
}

export function workspaceLabel(entry: WorkspaceEntry): string {
  if (entry.alias?.trim()) return entry.alias.trim();
  const filename = posix.basename(Uri.parse(entry.uri).path);
  return filename.replace(/\.code-workspace$/i, '');
}

export function sortWorkspaceEntries(
  entries: readonly WorkspaceEntry[],
  currentUri?: string,
): WorkspaceEntry[] {
  return [...entries].sort((left, right) => {
    if (left.uri === currentUri) return right.uri === currentUri ? 0 : -1;
    if (right.uri === currentUri) return 1;
    return workspaceLabel(left).localeCompare(workspaceLabel(right), undefined, {
      sensitivity: 'base',
      numeric: true,
    });
  });
}
