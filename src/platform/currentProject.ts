import { Uri } from 'vscode';

export interface CurrentProjectSnapshot {
  workspaceFileUri?: string;
  workspaceFolderUris: readonly string[];
}

export function resolveCurrentProjectUri(
  snapshot: CurrentProjectSnapshot,
): string | undefined {
  if (snapshot.workspaceFileUri) {
    return Uri.parse(snapshot.workspaceFileUri).scheme === 'file'
      ? snapshot.workspaceFileUri
      : undefined;
  }
  if (snapshot.workspaceFolderUris.length !== 1) return undefined;
  const folder = snapshot.workspaceFolderUris[0];
  return folder && Uri.parse(folder).scheme === 'file' ? folder : undefined;
}
