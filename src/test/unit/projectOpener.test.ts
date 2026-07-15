import { Uri } from 'vscode';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FileKind, FileSystemPort, TargetKind } from '../../domain/discovery.js';
import type { ProjectEntry } from '../../domain/projectEntry.js';
import {
  ProjectRegistry,
  type RegistryStorage,
} from '../../domain/projectRegistry.js';
import {
  ProjectOpener,
  type Clock,
  type CommandExecutor,
} from '../../platform/projectOpener.js';

class MemoryStorage implements RegistryStorage {
  value: unknown;
  private blocker: { started(): void; released: Promise<void> } | undefined;

  read(): Promise<unknown> { return Promise.resolve(this.value); }
  async write(entries: readonly ProjectEntry[]): Promise<void> {
    if (this.blocker) {
      const blocker = this.blocker;
      this.blocker = undefined;
      blocker.started();
      await blocker.released;
    }
    this.value = entries;
  }
  blockNextWrite(): { started: Promise<void>; release(): void } {
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    this.blocker = { started: markStarted, released };
    return { started, release };
  }
}

class FakeFileSystem implements FileSystemPort {
  private readonly kinds = new Map<string, TargetKind>();

  setKind(uri: string, kind: TargetKind): void { this.kinds.set(uri, kind); }
  readDirectory(): Promise<readonly [name: string, kind: FileKind][]> {
    return Promise.resolve([]);
  }
  joinPath(baseUri: string, ...segments: string[]): string {
    return [baseUri.replace(/\/$/, ''), ...segments].join('/');
  }
  canonicalize(uri: string): string { return uri; }
  statKind(uri: string): Promise<TargetKind> {
    return Promise.resolve(this.kinds.get(uri) ?? 'file');
  }
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

describe('ProjectOpener', () => {
  let fs: FakeFileSystem;
  let commands: FakeCommands;
  let storage: MemoryStorage;
  let registry: ProjectRegistry;
  let opener: ProjectOpener;
  let entry: ProjectEntry;

  beforeEach(async () => {
    fs = new FakeFileSystem();
    commands = new FakeCommands();
    storage = new MemoryStorage();
    registry = new ProjectRegistry(storage);
    await registry.load();
    entry = await registry.upsertManualWorkspace('file:///work/a.code-workspace');
    fs.setKind(entry.uri, 'file');
    opener = new ProjectOpener(registry, fs, commands, new FakeClock(123));
  });

  it('uses forceReuseWindow for the primary action', async () => {
    await expect(opener.open(entry.id, 'reuse')).resolves.toEqual({ status: 'opened' });

    expect(commands.calls).toEqual([
      ['vscode.openFolder', Uri.parse(entry.uri), { forceReuseWindow: true }],
    ]);
    expect(registry.get(entry.id)?.lastOpenedAt).toBe(123);
  });

  it('uses forceNewWindow for the alternate action', async () => {
    await opener.open(entry.id, 'new');

    expect(commands.calls).toEqual([
      ['vscode.openFolder', Uri.parse(entry.uri), { forceNewWindow: true }],
    ]);
  });

  it('opens a folder in a new window and records its timestamp', async () => {
    const folder = await registry.upsertManualFolder('file:///work/atlas');
    fs.setKind(folder.uri, 'directory');

    await expect(opener.open(folder.id, 'new')).resolves.toEqual({ status: 'opened' });
    expect(commands.calls).toEqual([
      ['vscode.openFolder', Uri.parse(folder.uri), { forceNewWindow: true }],
    ]);
    expect(registry.get(folder.id)?.lastOpenedAt).toBe(123);
  });

  it('removes the entire missing entry before returning a missing result', async () => {
    const retained = await registry.upsertManualWorkspace('file:///work/retained.code-workspace');
    await registry.setAlias(entry.id, 'Alpha');
    await registry.markOpened(entry.id, 99);
    fs.setKind(entry.uri, 'missing');

    await expect(opener.open(entry.id, 'reuse')).resolves.toEqual({ status: 'missing' });

    expect(registry.get(entry.id)).toBeUndefined();
    expect(registry.list()).toEqual([retained]);
    expect(commands.calls).toEqual([]);
  });

  it('retains and rejects a project whose filesystem kind changed', async () => {
    fs.setKind(entry.uri, 'directory');

    await expect(opener.open(entry.id, 'reuse')).resolves.toEqual({
      status: 'kind-mismatch',
      expected: 'file',
      actual: 'directory',
    });
    expect(registry.get(entry.id)).toEqual(entry);
    expect(commands.calls).toEqual([]);
  });

  it('targeted missing cleanup preserves unrelated metadata committed first', async () => {
    const retained = await registry.upsertManualWorkspace('file:///work/retained.code-workspace');
    fs.setKind(entry.uri, 'missing');
    const blocked = storage.blockNextWrite();
    const alias = registry.setAlias(retained.id, 'Fresh Alias');
    await blocked.started;

    const opening = opener.open(entry.id, 'reuse');
    blocked.release();
    await Promise.all([alias, opening]);

    expect(registry.get(entry.id)).toBeUndefined();
    expect(registry.get(retained.id)).toEqual({
      ...retained,
      alias: 'Fresh Alias',
    });
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
