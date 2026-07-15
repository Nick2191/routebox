import { posix } from 'node:path';
import { Uri } from 'vscode';

export type WorkspaceSourceId = `configured:${string}` | `current:${string}`;
export type ProjectKind = 'workspace' | 'folder';

export interface ProjectEntry {
  id: string;
  uri: string;
  kind: ProjectKind;
  alias?: string;
  manuallyRegistered: boolean;
  discoveredFrom: WorkspaceSourceId[];
  lastOpenedAt?: number;
}

export function isWorkspaceFileUri(uri: string): boolean {
  return posix.extname(Uri.parse(uri).path).toLowerCase() === '.code-workspace';
}

export function projectLabel(entry: ProjectEntry): string {
  if (entry.alias?.trim()) return entry.alias.trim();
  const name = posix.basename(Uri.parse(entry.uri).path);
  return entry.kind === 'workspace' ? name.replace(/\.code-workspace$/i, '') : name;
}

export function sortProjectEntries(
  entries: readonly ProjectEntry[],
  currentUri?: string,
): ProjectEntry[] {
  return [...entries].sort((left, right) => {
    if (left.uri === currentUri) return right.uri === currentUri ? 0 : -1;
    if (right.uri === currentUri) return 1;
    return projectLabel(left).localeCompare(projectLabel(right), undefined, {
      sensitivity: 'base',
      numeric: true,
    });
  });
}
