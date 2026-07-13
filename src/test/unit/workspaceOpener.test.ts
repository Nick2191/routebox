import { beforeEach, describe, expect, it } from 'vitest';
import type { FileKind, FileSystemPort } from '../../domain/discovery.js';
import type { WorkspaceEntry } from '../../domain/workspaceEntry.js';
import {
  WorkspaceRegistry,
  type RegistryStorage,
} from '../../domain/workspaceRegistry.js';
import {
  WorkspaceOpener,
  type Clock,
  type CommandExecutor,
} from '../../platform/workspaceOpener.js';

class MemoryStorage implements RegistryStorage {
  value: unknown;

  read(): Promise<unknown> { return Promise.resolve(this.value); }
  write(entries: readonly WorkspaceEntry[]): Promise<void> {
    this.value = entries;
    return Promise.resolve();
  }
}

class FakeFileSystem implements FileSystemPort {
  private readonly existing = new Map<string, boolean>();

  setExists(uri: string, exists: boolean): void { this.existing.set(uri, exists); }
  readDirectory(): Promise<readonly [name: string, kind: FileKind][]> {
    return Promise.resolve([]);
  }
  joinPath(baseUri: string, ...segments: string[]): string {
    return [baseUri.replace(/\/$/, ''), ...segments].join('/');
  }
  canonicalize(uri: string): string { return uri; }
  exists(uri: string): Promise<boolean> { return Promise.resolve(this.existing.get(uri) ?? true); }
  parent(uri: string): string { return uri.slice(0, uri.lastIndexOf('/')); }
}

class FakeCommands implements CommandExecutor {
  readonly calls: unknown[][] = [];
  error?: Error;

  execute(command: string, ...args: unknown[]): Promise<unknown> {
    this.calls.push([command, ...args]);
    return this.error ? Promise.reject(this.error) : Promise.resolve(undefined);
  }
}

class FakeClock implements Clock {
  constructor(private readonly value: number) {}
  now(): number { return this.value; }
}

describe('WorkspaceOpener', () => {
  let fs: FakeFileSystem;
  let commands: FakeCommands;
  let registry: WorkspaceRegistry;
  let opener: WorkspaceOpener;
  let entry: WorkspaceEntry;

  beforeEach(async () => {
    fs = new FakeFileSystem();
    commands = new FakeCommands();
    registry = new WorkspaceRegistry(new MemoryStorage());
    await registry.load();
    entry = await registry.upsertManual('file:///work/a.code-workspace');
    opener = new WorkspaceOpener(registry, fs, commands, new FakeClock(123));
  });

  it('uses forceReuseWindow for the primary action', async () => {
    await expect(opener.open(entry.id, 'reuse')).resolves.toEqual({ status: 'opened' });

    expect(commands.calls).toEqual([
      ['vscode.openFolder', entry.uri, { forceReuseWindow: true }],
    ]);
    expect(registry.get(entry.id)?.lastOpenedAt).toBe(123);
  });

  it('uses forceNewWindow for the alternate action', async () => {
    await opener.open(entry.id, 'new');

    expect(commands.calls).toEqual([
      ['vscode.openFolder', entry.uri, { forceNewWindow: true }],
    ]);
  });

  it('removes the entire missing entry before returning a missing result', async () => {
    const retained = await registry.upsertManual('file:///work/retained.code-workspace');
    await registry.setAlias(entry.id, 'Alpha');
    await registry.markOpened(entry.id, 99);
    fs.setExists(entry.uri, false);

    await expect(opener.open(entry.id, 'reuse')).resolves.toEqual({ status: 'missing' });

    expect(registry.get(entry.id)).toBeUndefined();
    expect(registry.list()).toEqual([retained]);
    expect(commands.calls).toEqual([]);
  });

  it('propagates command failures without changing the entry', async () => {
    await registry.setAlias(entry.id, 'Alpha');
    await registry.markOpened(entry.id, 99);
    const before = registry.get(entry.id);
    const failure = new Error('Open command failed');
    commands.error = failure;

    await expect(opener.open(entry.id, 'reuse')).rejects.toBe(failure);

    expect(registry.get(entry.id)).toEqual(before);
  });
});
