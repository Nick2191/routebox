import { isWorkspaceFileUri } from './projectEntry.js';

export type FileKind = 'file' | 'directory' | 'other';
export type TargetKind = FileKind | 'missing';

export interface FileSystemPort {
  readDirectory(uri: string): Promise<readonly [name: string, kind: FileKind][]>;
  joinPath(baseUri: string, ...segments: string[]): string;
  canonicalize(uri: string): string;
  statKind(uri: string): Promise<TargetKind>;
  parent(uri: string): string;
}

export interface DiscoveryResult {
  rootUri: string;
  workspaceUris: string[];
  status: 'ok' | 'error';
  error?: string;
}

export class WorkspaceDiscoveryService {
  private readonly excluded = new Set(['.git', 'node_modules']);

  constructor(private readonly fs: FileSystemPort) {}

  async scan(rootUri: string): Promise<DiscoveryResult> {
    const found = new Set<string>();
    try {
      await this.walk(rootUri, found);
      return { rootUri, workspaceUris: [...found].sort(), status: 'ok' };
    } catch (error) {
      return {
        rootUri,
        workspaceUris: [],
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async walk(uri: string, found: Set<string>): Promise<void> {
    for (const [name, kind] of await this.fs.readDirectory(uri)) {
      const child = this.fs.joinPath(uri, name);
      if (kind === 'directory' && !this.excluded.has(name.toLowerCase())) {
        await this.walk(child, found);
      }
      if (kind === 'file' && isWorkspaceFileUri(child)) found.add(child);
    }
  }
}
