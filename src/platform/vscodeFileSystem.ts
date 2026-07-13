import { posix } from 'node:path';
import { FileSystemError, FileType, Uri, workspace } from 'vscode';
import type { FileKind, FileSystemPort } from '../domain/discovery.js';

export class VscodeFileSystem implements FileSystemPort {
  canonicalize(value: string): string {
    const uri = Uri.parse(value);
    const normalized = posix.normalize(uri.path).replace(/^\/[A-Z]:/, drive => drive.toLowerCase());
    return uri.with({ path: normalized }).toString(true);
  }

  async readDirectory(value: string): Promise<readonly [name: string, kind: FileKind][]> {
    const entries = await workspace.fs.readDirectory(Uri.parse(value));
    return entries.map(([name, type]) => [name, this.fileKind(type)]);
  }

  joinPath(baseUri: string, ...segments: string[]): string {
    return Uri.joinPath(Uri.parse(baseUri), ...segments).toString(true);
  }
  async exists(value: string): Promise<boolean> {
    try {
      await workspace.fs.stat(Uri.parse(value));
      return true;
    } catch (error) {
      if (error instanceof FileSystemError && error.code === 'FileNotFound') return false;
      throw error;
    }
  }
  parent(value: string): string {
    const uri = Uri.parse(value);
    return uri.with({ path: posix.dirname(uri.path) }).toString(true);
  }

  private fileKind(type: FileType): FileKind {
    if (type === FileType.File) return 'file';
    if (type === FileType.Directory) return 'directory';
    return 'other';
  }
}
