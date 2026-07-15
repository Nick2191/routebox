import { Uri } from 'vscode';
import type { FileKind, FileSystemPort } from '../domain/discovery.js';
import type { ProjectRegistry } from '../domain/projectRegistry.js';

export interface CommandExecutor {
  execute(command: string, ...args: unknown[]): Promise<unknown>;
}

export interface Clock { now(): number }

export type OpenMode = 'reuse' | 'new';
export type OpenResult =
  | { status: 'opened' }
  | { status: 'missing' }
  | { status: 'kind-mismatch'; expected: 'file' | 'directory'; actual: FileKind };

export class ProjectOpener {
  constructor(
    private readonly registry: ProjectRegistry,
    private readonly fs: FileSystemPort,
    private readonly commands: CommandExecutor,
    private readonly clock: Clock,
  ) {}

  async open(id: string, mode: OpenMode): Promise<OpenResult> {
    const entry = this.registry.get(id);
    if (!entry) throw new Error('Project is no longer registered.');

    const actual = await this.fs.statKind(entry.uri);
    if (actual === 'missing') {
      await this.registry.remove([id]);
      return { status: 'missing' };
    }
    const expected = entry.kind === 'workspace' ? 'file' : 'directory';
    if (actual !== expected) return { status: 'kind-mismatch', expected, actual };

    const options = mode === 'reuse'
      ? { forceReuseWindow: true }
      : { forceNewWindow: true };
    await this.commands.execute('vscode.openFolder', Uri.parse(entry.uri), options);
    await this.registry.markOpened(id, this.clock.now());
    return { status: 'opened' };
  }
}
