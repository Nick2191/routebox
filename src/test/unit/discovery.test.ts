import { describe, expect, it } from 'vitest';
import {
  WorkspaceDiscoveryService,
  type FileKind,
  type FileSystemPort,
} from '../../domain/discovery.js';

class FakeFileSystem implements FileSystemPort {
  private readonly directories = new Map<string, readonly [name: string, kind: FileKind][]>();
  private readonly failures = new Map<string, Error>();
  readonly reads: string[] = [];

  directory(uri: string, entries: readonly [name: string, kind: FileKind][]): void {
    this.directories.set(uri, entries);
  }

  fail(uri: string, error = new Error(`Cannot read ${uri}`)): void {
    this.failures.set(uri, error);
  }

  readDirectory(uri: string): Promise<readonly [name: string, kind: FileKind][]> {
    this.reads.push(uri);
    const failure = this.failures.get(uri);
    if (failure) return Promise.reject(failure);

    const entries = this.directories.get(uri);
    if (!entries) return Promise.reject(new Error(`Cannot read ${uri}`));
    return Promise.resolve(entries);
  }

  joinPath(baseUri: string, ...segments: string[]): string {
    return [baseUri.replace(/\/$/, ''), ...segments].join('/');
  }

  canonicalize(uri: string): string {
    return uri;
  }

  statKind(): Promise<'file'> { return Promise.resolve('file'); }

  parent(uri: string): string {
    return uri.slice(0, uri.lastIndexOf('/'));
  }
}

describe('WorkspaceDiscoveryService', () => {
  it('finds nested workspace files and skips excluded directories', async () => {
    const fs = new FakeFileSystem();
    fs.directory('file:///root', [
      ['one', 'directory'],
      ['node_modules', 'directory'],
      ['.git', 'directory'],
      ['root.code-workspace', 'file'],
      ['README.md', 'file'],
    ]);
    fs.directory('file:///root/one', [
      ['nested', 'directory'],
      ['one.code-workspace', 'file'],
    ]);
    fs.directory('file:///root/one/nested', [['two.code-workspace', 'file']]);
    fs.directory('file:///root/node_modules', [['hidden.code-workspace', 'file']]);
    fs.directory('file:///root/.git', [['also-hidden.code-workspace', 'file']]);
    const service = new WorkspaceDiscoveryService(fs);

    await expect(service.scan('file:///root')).resolves.toEqual({
      rootUri: 'file:///root',
      workspaceUris: [
        'file:///root/one/nested/two.code-workspace',
        'file:///root/one/one.code-workspace',
        'file:///root/root.code-workspace',
      ],
      status: 'ok',
    });
  });

  it('skips excluded directories regardless of name casing', async () => {
    const fs = new FakeFileSystem();
    fs.directory('file:///root', [
      ['.GIT', 'directory'],
      ['Node_Modules', 'directory'],
      ['visible.code-workspace', 'file'],
    ]);
    fs.directory('file:///root/.GIT', [['hidden.code-workspace', 'file']]);
    fs.directory('file:///root/Node_Modules', [['also-hidden.code-workspace', 'file']]);

    await expect(new WorkspaceDiscoveryService(fs).scan('file:///root')).resolves.toEqual({
      rootUri: 'file:///root',
      workspaceUris: ['file:///root/visible.code-workspace'],
      status: 'ok',
    });
  });

  it('deduplicates workspace files returned more than once', async () => {
    const fs = new FakeFileSystem();
    fs.directory('file:///root', [
      ['one.code-workspace', 'file'],
      ['one.code-workspace', 'file'],
    ]);
    const service = new WorkspaceDiscoveryService(fs);

    await expect(service.scan('file:///root')).resolves.toEqual({
      rootUri: 'file:///root',
      workspaceUris: ['file:///root/one.code-workspace'],
      status: 'ok',
    });
  });

  it('reports an inaccessible root without claiming an empty successful scan', async () => {
    const fs = new FakeFileSystem();
    fs.fail('file:///root');
    const service = new WorkspaceDiscoveryService(fs);

    await expect(service.scan('file:///root')).resolves.toEqual({
      rootUri: 'file:///root',
      workspaceUris: [],
      status: 'error',
      error: 'Cannot read file:///root',
    });
  });

  it('treats symbolic-link-like other entries as leaves', async () => {
    const fs = new FakeFileSystem();
    fs.directory('file:///root', [
      ['linked-directory', 'other'],
      ['visible.code-workspace', 'file'],
    ]);

    await expect(new WorkspaceDiscoveryService(fs).scan('file:///root')).resolves.toMatchObject({
      workspaceUris: ['file:///root/visible.code-workspace'],
      status: 'ok',
    });
    expect(fs.reads).toEqual(['file:///root']);
  });

  it('terminates a deep finite directory scan', async () => {
    const fs = new FakeFileSystem();
    let parent = 'file:///root';
    for (let depth = 0; depth < 200; depth += 1) {
      fs.directory(parent, [['next', 'directory']]);
      parent = `${parent}/next`;
    }
    fs.directory(parent, [['deep.code-workspace', 'file']]);

    const result = await new WorkspaceDiscoveryService(fs).scan('file:///root');

    expect(result.status).toBe('ok');
    expect(result.workspaceUris).toEqual([`${parent}/deep.code-workspace`]);
    expect(fs.reads).toHaveLength(201);
  });
});
