import { URI, Utils } from 'vscode-uri';

Object.assign(URI, {
  joinPath: (base: URI, ...pathSegments: string[]) => Utils.joinPath(base, ...pathSegments),
});

export { URI as Uri };

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export class FileSystemError extends Error {
  private constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'FileSystemError';
  }

  static FileExists(): FileSystemError { return new FileSystemError('File exists', 'FileExists'); }
  static FileNotFound(): FileSystemError { return new FileSystemError('File not found', 'FileNotFound'); }
  static FileNotADirectory(): FileSystemError {
    return new FileSystemError('File is not a directory', 'FileNotADirectory');
  }
  static FileIsADirectory(): FileSystemError {
    return new FileSystemError('File is a directory', 'FileIsADirectory');
  }
  static NoPermissions(): FileSystemError {
    return new FileSystemError('No permissions', 'NoPermissions');
  }
  static Unavailable(): FileSystemError { return new FileSystemError('Unavailable', 'Unavailable'); }
}

interface TestFileSystem {
  stat(uri: URI): Promise<{ type: FileType; ctime: number; mtime: number; size: number }>;
  readDirectory(uri: URI): Promise<[string, FileType][]>;
}

let fileSystem: TestFileSystem = {
  stat: () => Promise.reject(new Error('Test workspace.fs.stat is not configured')),
  readDirectory: () => Promise.reject(new Error('Test workspace.fs.readDirectory is not configured')),
};

export function setWorkspaceFileSystem(value: TestFileSystem): void { fileSystem = value; }

interface TestDisposable { dispose(): void }
interface TestFileSystemWatcher extends TestDisposable {
  onDidCreate(listener: (uri: URI) => unknown): TestDisposable;
  onDidChange(listener: (uri: URI) => unknown): TestDisposable;
  onDidDelete(listener: (uri: URI) => unknown): TestDisposable;
}

export class RelativePattern {
  readonly baseUri: URI;
  readonly base: string;

  constructor(base: URI | string, readonly pattern: string) {
    this.baseUri = typeof base === 'string' ? URI.file(base) : base;
    this.base = this.baseUri.fsPath;
  }
}

let watcherFactory = (pattern: RelativePattern): TestFileSystemWatcher => {
  void pattern;
  throw new Error('Test workspace.createFileSystemWatcher is not configured');
};

export function setFileSystemWatcherFactory(
  value: (pattern: RelativePattern) => TestFileSystemWatcher,
): void {
  watcherFactory = value;
}

export const workspace = {
  get fs(): TestFileSystem { return fileSystem; },
  createFileSystemWatcher(pattern: RelativePattern): TestFileSystemWatcher {
    return watcherFactory(pattern);
  },
};
