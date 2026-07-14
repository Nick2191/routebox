import { afterEach, describe, expect, it } from 'vitest';
import { FileSystemError, FileType, Uri } from 'vscode';
import { VscodeFileSystem } from '../../platform/vscodeFileSystem.js';
import { VscodeRegistryStorage } from '../../platform/vscodeRegistryStorage.js';
import { setWorkspaceFileSystem } from '../adapters/vscode.js';

const fileStat = { type: FileType.File, ctime: 0, mtime: 0, size: 0 };

class FakeGlobalState {
  private readonly values = new Map<string, unknown>();
  readonly updates: Array<[string, unknown]> = [];
  readonly syncCalls: string[][] = [];

  keys(): readonly string[] { return [...this.values.keys()]; }
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.values.has(key) ? this.values.get(key) : defaultValue) as T | undefined;
  }
  update(key: string, value: unknown): Promise<void> {
    this.updates.push([key, value]);
    this.values.set(key, value);
    return Promise.resolve();
  }
  setKeysForSync(keys: readonly string[]): void { this.syncCalls.push([...keys]); }
}

afterEach(() => {
  setWorkspaceFileSystem({
    stat: () => Promise.reject(new Error('Test workspace.fs.stat is not configured')),
    readDirectory: () => Promise.reject(new Error('Test workspace.fs.readDirectory is not configured')),
  });
});

describe('VscodeFileSystem', () => {
  it('canonicalizes spaces, dot segments, and Windows drive-letter casing', () => {
    const fs = new VscodeFileSystem();

    expect(fs.canonicalize('file:///C:/My%20Work/one/../project.code-workspace'))
      .toBe('file:///c%3A/My%20Work/project.code-workspace');
  });

  it.each([
    ['file:///work/My%20Workspace.code-workspace', 'file:///work/My%20Workspace.code-workspace'],
    ['file:///work/literal%2520.code-workspace', 'file:///work/literal%2520.code-workspace'],
    ['file:///work/literal%252F.code-workspace', 'file:///work/literal%252F.code-workspace'],
  ])('round-trips encoded URI identity for %s', (value, expected) => {
    const fs = new VscodeFileSystem();

    const canonical = fs.canonicalize(value);

    expect(canonical).toBe(expected);
    expect(Uri.parse(canonical).path).toBe(Uri.parse(value).path);
  });

  it('canonicalizes Windows UNC paths without losing the authority or share', () => {
    const fs = new VscodeFileSystem();

    expect(fs.canonicalize(
      'file://fileserver/Team%20Share/projects/../workspace.code-workspace',
    )).toBe('file://fileserver/Team%20Share/workspace.code-workspace');
  });

  it('computes a URI parent while preserving scheme and authority', () => {
    const fs = new VscodeFileSystem();

    expect(fs.parent('vscode-remote://ssh-remote+dev/home/nick/project/work.code-workspace'))
      .toBe('vscode-remote://ssh-remote%2Bdev/home/nick/project');
  });

  it('joins URI paths with encoded durable spaces', () => {
    const fs = new VscodeFileSystem();

    expect(fs.joinPath('file:///Users/nick/My Work', 'nested', 'a.code-workspace'))
      .toBe('file:///Users/nick/My%20Work/nested/a.code-workspace');
  });

  it('computes encoded parents without turning a literal %2F filename into a slash', () => {
    const fs = new VscodeFileSystem();

    expect(fs.parent('file:///work/literal%252F/a.code-workspace'))
      .toBe('file:///work/literal%252F');
  });

  it('maps VS Code directory entries to domain file kinds', async () => {
    setWorkspaceFileSystem({
      stat: () => Promise.resolve(fileStat),
      readDirectory: () => Promise.resolve([
        ['workspace.code-workspace', FileType.File],
        ['nested', FileType.Directory],
        ['link', FileType.SymbolicLink],
      ]),
    });

    await expect(new VscodeFileSystem().readDirectory('file:///root')).resolves.toEqual([
      ['workspace.code-workspace', 'file'],
      ['nested', 'directory'],
      ['link', 'other'],
    ]);
  });

  it('returns false only for FileNotFound and rethrows inaccessible storage errors', async () => {
    const fs = new VscodeFileSystem();
    setWorkspaceFileSystem({
      stat: () => Promise.reject(FileSystemError.FileNotFound()),
      readDirectory: () => Promise.resolve([]),
    });
    await expect(fs.exists('file:///missing.code-workspace')).resolves.toBe(false);

    const inaccessible = FileSystemError.NoPermissions();
    setWorkspaceFileSystem({
      stat: () => Promise.reject(inaccessible),
      readDirectory: () => Promise.resolve([]),
    });
    await expect(fs.exists('file:///inaccessible.code-workspace')).rejects.toBe(inaccessible);

    setWorkspaceFileSystem({
      stat: () => Promise.resolve(fileStat),
      readDirectory: () => Promise.resolve([]),
    });
    await expect(fs.exists('file:///present.code-workspace')).resolves.toBe(true);
  });
});

describe('VscodeRegistryStorage', () => {
  it('reads and writes one unsynchronized global-state key', async () => {
    const state = new FakeGlobalState();
    const storage = new VscodeRegistryStorage(state);
    const entries = [{
      id: 'file:///one.code-workspace',
      uri: 'file:///one.code-workspace',
      manuallyRegistered: true,
      discoveredFrom: [],
    }];

    await expect(storage.read()).resolves.toBeUndefined();
    await storage.write(entries);

    expect(state.updates).toEqual([['workspaceAtlas.registry.v1', entries]]);
    await expect(storage.read()).resolves.toEqual(entries);
    expect(state.syncCalls).toEqual([]);
  });
});
