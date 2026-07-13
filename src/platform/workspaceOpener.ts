import type { FileSystemPort } from '../domain/discovery.js';
import type { WorkspaceRegistry } from '../domain/workspaceRegistry.js';

export interface CommandExecutor {
  execute(command: string, ...args: unknown[]): Promise<unknown>;
}

export interface Clock { now(): number }

export type OpenMode = 'reuse' | 'new';
export type OpenResult = { status: 'opened' } | { status: 'missing' };

export class WorkspaceOpener {
  constructor(
    private readonly registry: WorkspaceRegistry,
    private readonly fs: FileSystemPort,
    private readonly commands: CommandExecutor,
    private readonly clock: Clock,
  ) {}

  async open(id: string, mode: OpenMode): Promise<OpenResult> {
    const entry = this.registry.get(id);
    if (!entry) throw new Error('Workspace is no longer registered.');

    if (!await this.fs.exists(entry.uri)) {
      await this.registry.replace(this.registry.list().filter(candidate => candidate.id !== id));
      return { status: 'missing' };
    }

    const options = mode === 'reuse'
      ? { forceReuseWindow: true }
      : { forceNewWindow: true };
    await this.commands.execute('vscode.openFolder', entry.uri, options);
    await this.registry.markOpened(id, this.clock.now());
    return { status: 'opened' };
  }
}
