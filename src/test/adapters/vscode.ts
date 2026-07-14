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

export interface Disposable { dispose(): void }

export class EventEmitter<T> implements Disposable {
  private readonly listeners = new Set<(value: T) => unknown>();
  readonly event = (listener: (value: T) => unknown): Disposable => {
    this.listeners.add(listener);
    return { dispose: (): void => { this.listeners.delete(listener); } };
  };

  fire(value: T): void {
    for (const listener of this.listeners) listener(value);
  }

  dispose(): void { this.listeners.clear(); }
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class ThemeIcon {
  constructor(readonly id: string) {}
}

export class MarkdownString {
  constructor(public value = '') {}
}

export class TreeItem {
  description?: string;
  tooltip?: string | MarkdownString;
  contextValue?: string;
  iconPath?: ThemeIcon;
  command?: { command: string; title: string; arguments?: unknown[] };

  constructor(
    public label?: string,
    public collapsibleState = TreeItemCollapsibleState.None,
  ) {}
}

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
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

interface TestWorkspaceConfiguration {
  get<T>(section: string, defaultValue: T): T;
  update(section: string, value: unknown, target: ConfigurationTarget): Promise<void>;
}

let configurationFactory = (section: string): TestWorkspaceConfiguration => {
  void section;
  return {
    get: <T>(_key: string, defaultValue: T): T => defaultValue,
    update: () => Promise.resolve(),
  };
};

export function setConfigurationFactory(
  value: (section: string) => TestWorkspaceConfiguration,
): void {
  configurationFactory = value;
}

export const workspace = {
  get fs(): TestFileSystem { return fileSystem; },
  getConfiguration(section: string): TestWorkspaceConfiguration {
    return configurationFactory(section);
  },
  createFileSystemWatcher(pattern: RelativePattern): TestFileSystemWatcher {
    return watcherFactory(pattern);
  },
};

type CommandCallback = (...args: unknown[]) => unknown;
let commandRegistration = (id: string, callback: CommandCallback): Disposable => {
  void id;
  void callback;
  return { dispose(): void {} };
};
let commandExecution = (id: string, ...args: unknown[]): Promise<unknown> => {
  void id;
  void args;
  return Promise.resolve();
};

export function setCommandRegistration(
  value: (id: string, callback: CommandCallback) => Disposable,
): void {
  commandRegistration = value;
}

export function setCommandExecution(
  value: (id: string, ...args: unknown[]) => Promise<unknown>,
): void {
  commandExecution = value;
}

export const commands = {
  registerCommand(id: string, callback: CommandCallback): Disposable {
    return commandRegistration(id, callback);
  },
  executeCommand(id: string, ...args: unknown[]): Promise<unknown> {
    return commandExecution(id, ...args);
  },
};

interface OpenDialogOptions {
  canSelectFiles?: boolean;
  canSelectFolders?: boolean;
  canSelectMany?: boolean;
  filters?: Record<string, string[]>;
}

interface QuickPickOptions {
  placeHolder?: string;
  matchOnDescription?: boolean;
  matchOnDetail?: boolean;
}
interface InputBoxOptions { prompt?: string; value?: string }

let openDialog = (options: OpenDialogOptions): Promise<URI[] | undefined> => {
  void options;
  return Promise.resolve(undefined);
};
let quickPick = <T>(items: readonly T[], options?: QuickPickOptions): Promise<T | undefined> => {
  void items;
  void options;
  return Promise.resolve(undefined);
};

export function setOpenDialog(
  value: (options: OpenDialogOptions) => Promise<URI[] | undefined>,
): void {
  openDialog = value;
}

export function setQuickPick(
  value: <T>(items: readonly T[], options?: QuickPickOptions) => Promise<T | undefined>,
): void {
  quickPick = value;
}

export const window = {
  showOpenDialog(options: OpenDialogOptions): Promise<URI[] | undefined> {
    return openDialog(options);
  },
  showQuickPick<T>(items: readonly T[], options?: QuickPickOptions): Promise<T | undefined> {
    return quickPick(items, options);
  },
  showInputBox(options?: InputBoxOptions): Promise<string | undefined> {
    void options;
    return Promise.resolve(undefined);
  },
  showInformationMessage(message: string): Promise<string | undefined> {
    void message;
    return Promise.resolve(undefined);
  },
  showWarningMessage(message: string): Promise<string | undefined> {
    void message;
    return Promise.resolve(undefined);
  },
  showErrorMessage(message: string): Promise<string | undefined> {
    void message;
    return Promise.resolve(undefined);
  },
};
