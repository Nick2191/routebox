# Workspace Atlas Folder Support and UI Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manually registered folders to Workspace Atlas and present folders and saved workspaces together through a polished native Projects sidebar and Quick Pick.

**Architecture:** Replace the workspace-only registry model with a persisted `ProjectEntry` discriminated by `kind: 'workspace' | 'folder'`, while keeping discovery explicitly workspace-only. A shared filesystem kind check drives registration, cleanup, and opening; presentation and commands consume the unified model, and existing command IDs and the registry storage key remain stable.

**Tech Stack:** TypeScript 5, VS Code Extension API `^1.114.0`, Vitest, Mocha/@vscode/test-electron, esbuild, ESLint, VSCE.

## Global Constraints

- Desktop VS Code and local `file:` targets only.
- Folders are manually registered only; discovery continues to yield `.code-workspace` files only.
- Existing command IDs, including `workspaceAtlas.switchWorkspace`, remain unchanged so custom keybindings survive the upgrade.
- The registry continues using the unsynchronized global-state key `workspaceAtlas.registry.v1`.
- Removing a project never deletes its workspace file or folder from disk.
- Only a confirmed missing target may be removed automatically; permission and transient I/O failures retain the entry.
- Use URI APIs instead of platform-specific string concatenation on macOS, Windows, and Linux.
- Use native VS Code tree, Quick Pick, menu, and command surfaces; do not add a webview.
- Keep `preview: true` and do not change the package version as part of this feature branch.
- Do not add automatic folder discovery, dedicated folder watchers, pins, groups, recents, numbered shortcut slots, or default keybindings.

---

## File structure

### New or renamed production files

- `src/domain/projectEntry.ts` — unified project type, kind-aware labels, workspace-extension validation, and sorting.
- `src/domain/projectRegistry.ts` — persistence, legacy migration, manual registration, aliases, provenance, timestamps, and serialized mutations.
- `src/platform/currentProject.ts` — pure resolution of the active local saved-workspace or single-folder URI.
- `src/platform/projectOpener.ts` — target-kind validation and current/new-window opening.
- `src/ui/projectQuickPick.ts` — combined project Quick Pick item construction.
- `src/ui/projectTreeProvider.ts` — native Projects tree items, icons, descriptions, context values, and tooltips.

### Existing production files to modify

- `src/domain/discovery.ts` — add the shared `statKind` filesystem contract while retaining workspace-only scanning.
- `src/domain/reconciler.ts` — reconcile only workspace discoveries and clean missing projects of either kind.
- `src/platform/vscodeFileSystem.ts` — map VS Code filesystem stat results to domain kinds and confirmed missing state.
- `src/platform/vscodeRegistryStorage.ts` — persist `ProjectEntry[]` under the unchanged key.
- `src/platform/discoveryCoordinator.ts` — consume `ProjectEntry`/`ProjectRegistry` types without changing discovery behavior.
- `src/commands/registerCommands.ts` — combined selection, Add Project routing, Add Folder behavior, kind validation, and project-oriented copy.
- `src/extension.ts` — instantiate generalized components, resolve the current project, retain workspace discovery context, and report load/cleanup results.
- `package.json` — Projects view, command/menu contributions, folder keywords, and user-facing copy.
- `README.md` and `CHANGELOG.md` — folder workflow, migration, cleanup, and release notes.

### Tests to add or rename

- `src/test/unit/projectEntry.test.ts`
- `src/test/unit/projectRegistry.test.ts`
- `src/test/unit/currentProject.test.ts`
- `src/test/unit/projectOpener.test.ts`
- `src/test/unit/projectQuickPick.test.ts`
- `src/test/unit/projectTreeProvider.test.ts`
- Existing discovery, reconciliation, coordinator, command, filesystem, smoke, activation, and integration tests are updated in place.

---

### Task 1: Unified project model and backward-compatible registry

**Files:**
- Create: `src/domain/projectEntry.ts`
- Create: `src/domain/projectRegistry.ts`
- Delete: `src/domain/workspaceEntry.ts`
- Delete: `src/domain/workspaceRegistry.ts`
- Create: `src/test/unit/projectEntry.test.ts`
- Create: `src/test/unit/projectRegistry.test.ts`
- Delete: `src/test/unit/workspaceEntry.test.ts`
- Delete: `src/test/unit/workspaceRegistry.test.ts`
- Modify imports and workspace fixtures in: `src/domain/discovery.ts`, `src/domain/reconciler.ts`, `src/platform/discoveryCoordinator.ts`, `src/platform/vscodeRegistryStorage.ts`, `src/platform/workspaceOpener.ts`, `src/ui/workspaceQuickPick.ts`, `src/ui/workspaceTreeProvider.ts`, `src/commands/registerCommands.ts`, `src/extension.ts`, `src/test/unit/commandHandlers.test.ts`, `src/test/unit/discovery.test.ts`, `src/test/unit/discoveryCoordinator.test.ts`, `src/test/unit/reconciler.test.ts`, `src/test/unit/stage1Smoke.test.ts`, `src/test/unit/workspaceOpener.test.ts`, `src/test/unit/workspaceQuickPick.test.ts`, `src/test/unit/workspaceTreeProvider.test.ts`, and `src/test/unit/vscodeFileSystem.test.ts`

**Interfaces:**
- Produces: `type ProjectKind = 'workspace' | 'folder'`.
- Produces: `interface ProjectEntry { id; uri; kind; alias?; manuallyRegistered; discoveredFrom; lastOpenedAt? }`.
- Produces: `projectLabel(entry: ProjectEntry): string` and `sortProjectEntries(entries, currentUri?): ProjectEntry[]`.
- Produces: `ProjectRegistry.load(): Promise<{ discarded: number; reset: boolean; migrated: number }>`.
- Produces: `upsertManualWorkspace(uri)` and `upsertManualFolder(uri)`; all existing alias, removal, replacement, queued mutation, and timestamp methods retain their semantics.
- Consumes: the existing `WorkspaceSourceId` union, moved into `projectEntry.ts` without changing its values.

- [ ] **Step 1: Write failing model and migration tests**

Move the existing workspace entry and registry tests to their project-oriented filenames, add `kind: 'workspace'` to current fixtures, and add these focused cases:

```ts
const project = (uri: string, kind: ProjectKind, alias?: string): ProjectEntry => ({
  id: uri,
  uri,
  kind,
  alias,
  manuallyRegistered: true,
  discoveredFrom: [],
});

it('derives workspace and folder labels while preferring aliases', () => {
  expect(projectLabel(project('file:///work/atlas.code-workspace', 'workspace')))
    .toBe('atlas');
  expect(projectLabel(project('file:///work/My%20Folder', 'folder')))
    .toBe('My Folder');
  expect(projectLabel(project('file:///work/My%20Folder', 'folder', 'Personal')))
    .toBe('Personal');
});

it('migrates and rewrites legacy workspace records without losing metadata', async () => {
  storage.value = [{
    id: 'file:///work/atlas.code-workspace',
    uri: 'file:///work/atlas.code-workspace',
    alias: 'Atlas',
    manuallyRegistered: true,
    discoveredFrom: ['configured:file:///work'],
    lastOpenedAt: 42,
  }];
  registry = new ProjectRegistry(storage);

  await expect(registry.load()).resolves.toEqual({
    discarded: 0,
    reset: false,
    migrated: 1,
  });
  expect(registry.list()).toEqual([{
    ...(storage.value as ProjectEntry[])[0],
    kind: 'workspace',
  }]);
  expect(storage.writes.at(-1)?.[0]).toMatchObject({
    kind: 'workspace',
    alias: 'Atlas',
    lastOpenedAt: 42,
  });
});

it('registers folders idempotently without clearing aliases', async () => {
  const first = await registry.upsertManualFolder('file:///work/atlas');
  await registry.setAlias(first.id, 'Atlas folder');
  await registry.upsertManualFolder(first.uri);

  expect(registry.list()).toEqual([{
    ...first,
    kind: 'folder',
    alias: 'Atlas folder',
  }]);
});

it('rejects explicit unknown kinds and impossible discovered folders', async () => {
  storage.value = [
    { id: 'file:///bad', uri: 'file:///bad', kind: 'repository', manuallyRegistered: true, discoveredFrom: [] },
    { id: 'file:///folder', uri: 'file:///folder', kind: 'folder', manuallyRegistered: false, discoveredFrom: ['configured:file:///work'] },
  ];
  registry = new ProjectRegistry(storage);

  await expect(registry.load()).resolves.toEqual({ discarded: 2, reset: false, migrated: 0 });
  expect(registry.list()).toEqual([]);
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
npx vitest run src/test/unit/projectEntry.test.ts src/test/unit/projectRegistry.test.ts
```

Expected: FAIL because `projectEntry.ts`, `projectRegistry.ts`, `ProjectKind`, folder labels, and legacy migration do not exist.

- [ ] **Step 3: Implement `ProjectEntry` and registry normalization**

Create the model with this public surface:

```ts
import { posix } from 'node:path';
import { Uri } from 'vscode';

export type WorkspaceSourceId = `configured:${string}` | `current:${string}`;
export type ProjectKind = 'workspace' | 'folder';

export interface ProjectEntry {
  id: string;
  uri: string;
  kind: ProjectKind;
  alias?: string;
  manuallyRegistered: boolean;
  discoveredFrom: WorkspaceSourceId[];
  lastOpenedAt?: number;
}

export function isWorkspaceFileUri(uri: string): boolean {
  return posix.extname(Uri.parse(uri).path).toLowerCase() === '.code-workspace';
}

export function projectLabel(entry: ProjectEntry): string {
  if (entry.alias?.trim()) return entry.alias.trim();
  const name = posix.basename(Uri.parse(entry.uri).path);
  return entry.kind === 'workspace' ? name.replace(/\.code-workspace$/i, '') : name;
}

export function sortProjectEntries(
  entries: readonly ProjectEntry[],
  currentUri?: string,
): ProjectEntry[] {
  return [...entries].sort((left, right) => {
    if (left.uri === currentUri) return right.uri === currentUri ? 0 : -1;
    if (right.uri === currentUri) return 1;
    return projectLabel(left).localeCompare(projectLabel(right), undefined, {
      sensitivity: 'base',
      numeric: true,
    });
  });
}
```

In `projectRegistry.ts`, normalize records before they reach the existing mutation queue:

```ts
type LoadResult = { discarded: number; reset: boolean; migrated: number };

function copyEntry(entry: ProjectEntry): ProjectEntry {
  return { ...entry, discoveredFrom: [...entry.discoveredFrom] };
}

function normalizeEntry(value: unknown): { entry?: ProjectEntry; migrated: boolean } {
  if (!value || typeof value !== 'object') return { migrated: false };
  const item = value as Partial<ProjectEntry>;
  const kind = item.kind === undefined ? 'workspace' : item.kind;
  const sourcesValid = Array.isArray(item.discoveredFrom)
    && item.discoveredFrom.every(source => typeof source === 'string');
  const commonValid = typeof item.id === 'string'
    && typeof item.uri === 'string'
    && (item.alias === undefined || typeof item.alias === 'string')
    && typeof item.manuallyRegistered === 'boolean'
    && sourcesValid
    && (item.lastOpenedAt === undefined || typeof item.lastOpenedAt === 'number');
  const kindValid = kind === 'workspace' || kind === 'folder';
  const workspaceValid = kind !== 'workspace' || isWorkspaceFileUri(item.uri ?? '');
  const folderValid = kind !== 'folder'
    || (item.manuallyRegistered === true && item.discoveredFrom?.length === 0);
  if (!commonValid || !kindValid || !workspaceValid || !folderValid) {
    return { migrated: false };
  }
  return {
    entry: { ...(item as ProjectEntry), kind },
    migrated: item.kind === undefined,
  };
}

async load(): Promise<LoadResult> {
  const stored = await this.storage.read();
  if (stored !== undefined && !Array.isArray(stored)) {
    this.entries = new Map();
    return { discarded: 0, reset: true, migrated: 0 };
  }
  const normalized = (stored ?? []).map(normalizeEntry);
  const valid = normalized.flatMap(result => result.entry ? [result.entry] : []);
  const migrated = normalized.filter(result => result.migrated).length;
  if (migrated > 0) await this.storage.write(valid.map(copyEntry));
  this.entries = new Map(valid.map(entry => [entry.id, copyEntry(entry)]));
  return { discarded: normalized.length - valid.length, reset: false, migrated };
}

upsertManualWorkspace(uri: string): Promise<ProjectEntry> {
  if (!isWorkspaceFileUri(uri)) return Promise.reject(new Error('Select a .code-workspace file.'));
  return this.upsertManual(uri, 'workspace');
}

upsertManualFolder(uri: string): Promise<ProjectEntry> {
  return this.upsertManual(uri, 'folder');
}

private upsertManual(uri: string, kind: ProjectKind): Promise<ProjectEntry> {
  return this.mutate(candidate => {
    const existing = candidate.get(uri);
    if (existing && existing.kind !== kind) {
      throw new Error('The path is already registered as a different project type.');
    }
    const entry: ProjectEntry = existing
      ? { ...existing, manuallyRegistered: true }
      : { id: uri, uri, kind, manuallyRegistered: true, discoveredFrom: [] };
    candidate.set(entry.id, entry);
    return copyEntry(entry);
  });
}
```

Preserve the current copy-on-read/write behavior, rollback-on-storage-failure behavior, and serialized mutation queue. Rename imports and fixtures throughout `src` and add `kind: 'workspace'` to every non-legacy `ProjectEntry` literal. Update `VscodeRegistryStorage.write` to accept `readonly ProjectEntry[]` while retaining `workspaceAtlas.registry.v1`.

- [ ] **Step 4: Run domain tests and type checking**

Run:

```bash
npx vitest run src/test/unit/projectEntry.test.ts src/test/unit/projectRegistry.test.ts
npm run check-types
```

Expected: both commands PASS; the original registry concurrency and rollback cases remain green under their renamed test file.

- [ ] **Step 5: Commit the unified model**

```bash
git add src/domain src/platform/vscodeRegistryStorage.ts src/test src/commands src/ui src/extension.ts
git commit -m "feat: generalize the project registry"
```

---

### Task 2: Filesystem kind inspection and current-project resolution

**Files:**
- Create: `src/platform/currentProject.ts`
- Create: `src/test/unit/currentProject.test.ts`
- Modify: `src/platform/vscodeFileSystem.ts`
- Modify: `src/test/unit/vscodeFileSystem.test.ts`

**Interfaces:**
- Produces: `type TargetKind = FileKind | 'missing'`.
- Produces: `VscodeFileSystem.statKind(uri: string): Promise<TargetKind>`.
- Produces: `resolveCurrentProjectUri(snapshot: CurrentProjectSnapshot): string | undefined`.
- Consumes: VS Code URI strings; only `file:` targets are eligible for current-project matching.

- [ ] **Step 1: Write failing filesystem-kind and current-target tests**

Add these cases:

```ts
it.each([
  [FileType.File, 'file'],
  [FileType.Directory, 'directory'],
  [FileType.SymbolicLink, 'other'],
] as const)('maps stat type %s to %s', async (type, expected) => {
  setWorkspaceFileSystem({
    stat: () => Promise.resolve({ type, ctime: 0, mtime: 0, size: 0 }),
    readDirectory: () => Promise.resolve([]),
  });
  await expect(new VscodeFileSystem().statKind('file:///target')).resolves.toBe(expected);
});

it('maps only FileNotFound to missing and rethrows inaccessible errors', async () => {
  setWorkspaceFileSystem({
    stat: () => Promise.reject(FileSystemError.FileNotFound()),
    readDirectory: () => Promise.resolve([]),
  });
  await expect(new VscodeFileSystem().statKind('file:///missing')).resolves.toBe('missing');

  const inaccessible = FileSystemError.NoPermissions();
  setWorkspaceFileSystem({
    stat: () => Promise.reject(inaccessible),
    readDirectory: () => Promise.resolve([]),
  });
  await expect(new VscodeFileSystem().statKind('file:///private')).rejects.toBe(inaccessible);
});

it.each([
  [{ workspaceFileUri: 'file:///work/atlas.code-workspace', workspaceFolderUris: ['file:///work/a'] }, 'file:///work/atlas.code-workspace'],
  [{ workspaceFolderUris: ['file:///work/atlas'] }, 'file:///work/atlas'],
  [{ workspaceFileUri: 'untitled:Untitled-1', workspaceFolderUris: ['file:///work/atlas'] }, undefined],
  [{ workspaceFolderUris: ['file:///work/a', 'file:///work/b'] }, undefined],
  [{ workspaceFolderUris: ['vscode-remote://ssh-remote%2Bhost/work'] }, undefined],
] as const)('resolves current project from %o', (snapshot, expected) => {
  expect(resolveCurrentProjectUri(snapshot)).toBe(expected);
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

```bash
npx vitest run src/test/unit/vscodeFileSystem.test.ts src/test/unit/currentProject.test.ts
```

Expected: FAIL because `statKind`, `TargetKind`, and `resolveCurrentProjectUri` do not exist.

- [ ] **Step 3: Implement target-kind mapping and current-project resolution**

Add the domain result type beside `FileKind`:

```ts
export type FileKind = 'file' | 'directory' | 'other';
export type TargetKind = FileKind | 'missing';
```

Add the VS Code adapter method, reusing the existing `fileKind` mapper:

```ts
async statKind(value: string): Promise<TargetKind> {
  try {
    return this.fileKind((await workspace.fs.stat(Uri.parse(value))).type);
  } catch (error) {
    if (error instanceof FileSystemError && error.code === 'FileNotFound') return 'missing';
    throw error;
  }
}
```

Create the pure current-project resolver:

```ts
import { Uri } from 'vscode';

export interface CurrentProjectSnapshot {
  workspaceFileUri?: string;
  workspaceFolderUris: readonly string[];
}

export function resolveCurrentProjectUri(
  snapshot: CurrentProjectSnapshot,
): string | undefined {
  if (snapshot.workspaceFileUri) {
    return Uri.parse(snapshot.workspaceFileUri).scheme === 'file'
      ? snapshot.workspaceFileUri
      : undefined;
  }
  if (snapshot.workspaceFolderUris.length !== 1) return undefined;
  const folder = snapshot.workspaceFolderUris[0];
  return folder && Uri.parse(folder).scheme === 'file' ? folder : undefined;
}
```

Keep the old `exists` method temporarily so Task 3 can replace every consumer and fake atomically.

- [ ] **Step 4: Run the targeted tests and type checking**

```bash
npx vitest run src/test/unit/vscodeFileSystem.test.ts src/test/unit/currentProject.test.ts
npm run check-types
```

Expected: PASS.

- [ ] **Step 5: Commit target inspection**

```bash
git add src/domain/discovery.ts src/platform/currentProject.ts src/platform/vscodeFileSystem.ts src/test/unit/currentProject.test.ts src/test/unit/vscodeFileSystem.test.ts
git commit -m "feat: resolve project and filesystem kinds"
```

---

### Task 3: Kind-aware reconciliation and project opening

**Files:**
- Create: `src/platform/projectOpener.ts`
- Delete: `src/platform/workspaceOpener.ts`
- Create: `src/test/unit/projectOpener.test.ts`
- Delete: `src/test/unit/workspaceOpener.test.ts`
- Modify: `src/domain/discovery.ts`
- Modify: `src/domain/reconciler.ts`
- Modify: `src/platform/vscodeFileSystem.ts`
- Modify: `src/test/unit/reconciler.test.ts`
- Modify fake `FileSystemPort` implementations in: `src/test/unit/discovery.test.ts`, `src/test/unit/discoveryCoordinator.test.ts`, `src/test/unit/stage1Smoke.test.ts`, `src/test/unit/projectOpener.test.ts`, and `src/test/unit/reconciler.test.ts`

**Interfaces:**
- Consumes: `ProjectEntry.kind`, `ProjectRegistry`, and `FileSystemPort.statKind(uri)`.
- Produces: `ProjectReconciler` with the existing `reconcileSource`, `retireSource`, and `removeMissing` methods.
- Produces: `ProjectOpener.open(id, mode): Promise<OpenResult>`.
- Produces: `OpenResult = opened | missing | kind-mismatch` with expected and actual filesystem kinds.

- [ ] **Step 1: Write failing reconciliation and opener tests**

Add `kind: 'workspace'` to existing discoveries and add these cases:

```ts
it('creates discovered entries as workspaces and never adds provenance to folders', async () => {
  const folder = await registry.upsertManualFolder('file:///work/folder.code-workspace');
  await reconciler.reconcileSource('configured:file:///work', {
    rootUri: 'file:///work',
    workspaceUris: [folder.uri, 'file:///work/real.code-workspace'],
    status: 'ok',
  });

  expect(registry.get(folder.id)).toEqual(folder);
  expect(registry.get('file:///work/real.code-workspace')).toMatchObject({
    kind: 'workspace',
    manuallyRegistered: false,
    discoveredFrom: ['configured:file:///work'],
  });
});

it('removes missing folders but retains entries whose kind changed', async () => {
  const missing = await registry.upsertManualFolder('file:///work/missing');
  const changed = await registry.upsertManualFolder('file:///work/changed');
  fs.setKind(missing.uri, 'missing');
  fs.setKind(changed.uri, 'file');

  await expect(reconciler.removeMissing()).resolves.toEqual({ removed: 1 });
  expect(registry.get(missing.id)).toBeUndefined();
  expect(registry.get(changed.id)).toEqual(changed);
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
```

- [ ] **Step 2: Run targeted tests to verify they fail**

```bash
npx vitest run src/test/unit/reconciler.test.ts src/test/unit/projectOpener.test.ts
```

Expected: FAIL because discovery is not kind-aware and opening only checks boolean existence.

- [ ] **Step 3: Replace boolean existence with filesystem-kind inspection**

Update the port:

```ts
export interface FileSystemPort {
  readDirectory(uri: string): Promise<readonly [name: string, kind: FileKind][]>;
  joinPath(baseUri: string, ...segments: string[]): string;
  canonicalize(uri: string): string;
  statKind(uri: string): Promise<TargetKind>;
  parent(uri: string): string;
}
```

Remove `VscodeFileSystem.exists`. Update every fake filesystem to implement `statKind`; discovery-only fakes can return `'file'`, while Node smoke tests map `stat()` to `'file'`, `'directory'`, `'other'`, or `'missing'`.

Make reconciliation discriminate on `entry.kind` and create workspace entries explicitly:

```ts
for (const entry of entries.values()) {
  if (entry.kind !== 'workspace') continue;
  const sources = entry.discoveredFrom.filter(value => value !== source);
  if (discovered.has(entry.uri)) sources.push(source);
  entry.discoveredFrom = [...new Set(sources)];
  if (!entry.manuallyRegistered && entry.discoveredFrom.length === 0) entries.delete(entry.id);
}

for (const uri of discovered) {
  if (entries.has(uri)) continue;
  entries.set(uri, {
    id: uri,
    uri,
    kind: 'workspace',
    manuallyRegistered: false,
    discoveredFrom: [source],
  });
}
```

Change missing cleanup to delete only confirmed missing targets:

```ts
const checks = await Promise.all(current.map(async entry => [
  entry,
  await this.fs.statKind(entry.uri),
] as const));
const missingIds = checks
  .filter(([, kind]) => kind === 'missing')
  .map(([entry]) => entry.id);
return { removed: await this.registry.remove(missingIds) };
```

Rename the reconciler class export from `WorkspaceReconciler` to
`ProjectReconciler` and update its production and test imports. Keep
`src/domain/reconciler.ts` because reconciliation remains its single
responsibility.

- [ ] **Step 4: Implement kind-aware project opening**

Use this result union and validation order:

```ts
export type OpenResult =
  | { status: 'opened' }
  | { status: 'missing' }
  | { status: 'kind-mismatch'; expected: 'file' | 'directory'; actual: FileKind };

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
```

Rename the class and tests to `ProjectOpener` while preserving `OpenMode = 'reuse' | 'new'`.

- [ ] **Step 5: Run reconciliation, opener, discovery, and coordinator tests**

```bash
npx vitest run src/test/unit/reconciler.test.ts src/test/unit/projectOpener.test.ts src/test/unit/discovery.test.ts src/test/unit/discoveryCoordinator.test.ts
npm run check-types
```

Expected: PASS, including concurrency tests proving cleanup uses fresh queued registry state.

- [ ] **Step 6: Commit kind-aware opening and cleanup**

```bash
git add src/domain src/platform src/test/unit
git commit -m "feat: open and reconcile project kinds"
```

---

### Task 4: Combined native sidebar and Quick Pick presentation

**Files:**
- Create: `src/ui/projectQuickPick.ts`
- Create: `src/ui/projectTreeProvider.ts`
- Delete: `src/ui/workspaceQuickPick.ts`
- Delete: `src/ui/workspaceTreeProvider.ts`
- Create: `src/test/unit/projectQuickPick.test.ts`
- Create: `src/test/unit/projectTreeProvider.test.ts`
- Delete: `src/test/unit/workspaceQuickPick.test.ts`
- Delete: `src/test/unit/workspaceTreeProvider.test.ts`

**Interfaces:**
- Consumes: `ProjectEntry`, `projectLabel`, `sortProjectEntries`, and a `CurrentProjectPort.currentProjectUri()`.
- Produces: `buildProjectQuickPickItems(entries, currentUri?)`.
- Produces: `ProjectTreeProvider` and `ProjectTreeItem`.
- Produces: context values `project.manual` and `project.discovered` for menu conditions.

- [ ] **Step 1: Write failing combined-presentation tests**

Move existing tests to project-oriented filenames and assert both kinds:

```ts
const project = (uri: string, kind: ProjectKind, alias?: string): ProjectEntry => ({
  id: uri,
  uri,
  kind,
  alias,
  manuallyRegistered: true,
  discoveredFrom: [],
});

it('builds searchable workspace and folder items with stable kind icons', () => {
  const workspace = project('file:///work/atlas.code-workspace', 'workspace', 'Atlas');
  const folder = project('file:///work/personal', 'folder');

  expect(buildProjectQuickPickItems([folder, workspace], folder.uri)).toEqual([
    expect.objectContaining({
      label: '$(folder) personal',
      description: 'Folder · Current',
      detail: Uri.parse(folder.uri).fsPath,
      entry: folder,
    }),
    expect.objectContaining({
      label: '$(window) Atlas',
      description: 'Workspace',
      detail: Uri.parse(workspace.uri).fsPath,
      entry: workspace,
    }),
  ]);
});

it('keeps the project kind icon while marking the current folder', () => {
  const provider = new ProjectTreeProvider(
    { list: () => [folder] },
    { currentProjectUri: () => folder.uri },
  );
  const item = provider.getChildren()[0];

  expect(item?.iconPath).toEqual(new ThemeIcon('folder'));
  expect(item?.description).toBe('Current');
  expect(item?.contextValue).toBe('project.manual');
  expect(item?.command).toEqual({
    command: 'workspaceAtlas.openEntryInCurrentWindow',
    title: 'Open Project',
    arguments: [folder.id],
  });
});

it('shows project type, path, status, and provenance in the tooltip', () => {
  const folder = project('file:///work/personal', 'folder');
  const provider = new ProjectTreeProvider(
    { list: () => [folder] },
    { currentProjectUri: () => folder.uri },
  );
  const item = provider.getChildren()[0];
  const tooltip = (item?.tooltip as MarkdownString).value;
  expect(tooltip).toContain('**personal**');
  expect(tooltip).toContain('Type: Folder');
  expect(tooltip).toContain(Uri.parse(folder.uri).fsPath);
  expect(tooltip).toContain('Status: Current');
  expect(tooltip).toContain('Manually registered');
});
```

- [ ] **Step 2: Run presentation tests to verify they fail**

```bash
npx vitest run src/test/unit/projectQuickPick.test.ts src/test/unit/projectTreeProvider.test.ts
```

Expected: FAIL because the project presentation modules and kind icons do not exist.

- [ ] **Step 3: Implement the combined Quick Pick builder**

```ts
export interface ProjectQuickPickItem extends QuickPickItem {
  entry: ProjectEntry;
}

export function buildProjectQuickPickItems(
  entries: readonly ProjectEntry[],
  currentUri?: string,
): ProjectQuickPickItem[] {
  return sortProjectEntries(entries, currentUri).map(entry => {
    const current = entry.uri === currentUri;
    const type = entry.kind === 'folder' ? 'Folder' : 'Workspace';
    const icon = entry.kind === 'folder' ? 'folder' : 'window';
    return {
      label: `$(${icon}) ${projectLabel(entry)}`,
      description: `${type}${current ? ' · Current' : ''}`,
      detail: Uri.parse(entry.uri).fsPath,
      entry,
    };
  });
}
```

- [ ] **Step 4: Implement the native Projects tree**

Use `ThemeIcon('folder')` for folders and `ThemeIcon('window')` for saved workspaces. Keep **Current** in `description`, not in `iconPath`:

```ts
export class ProjectTreeItem extends TreeItem {
  constructor(readonly entry: ProjectEntry, currentUri?: string) {
    super(projectLabel(entry), TreeItemCollapsibleState.None);
    const uri = Uri.parse(entry.uri);
    const current = entry.uri === currentUri;
    const type = entry.kind === 'folder' ? 'Folder' : 'Workspace';
    const originalName = posix.basename(uri.path);

    this.description = current ? 'Current' : undefined;
    this.iconPath = new ThemeIcon(entry.kind === 'folder' ? 'folder' : 'window');
    this.contextValue = entry.manuallyRegistered ? 'project.manual' : 'project.discovered';
    this.command = {
      command: 'workspaceAtlas.openEntryInCurrentWindow',
      title: 'Open Project',
      arguments: [entry.id],
    };
    this.tooltip = new MarkdownString([
      `**${originalName}**`,
      `Type: ${type}`,
      uri.fsPath,
      `Status: ${current ? 'Current' : 'Available'}`,
      projectProvenance(entry),
    ].join('\n\n'));
  }
}

function projectProvenance(entry: ProjectEntry): string {
  const values = entry.discoveredFrom.map(sourceProvenance);
  if (entry.manuallyRegistered) values.unshift('Manually registered');
  return values.length > 0 ? values.join(' · ') : 'Registered project';
}

function sourceProvenance(source: WorkspaceSourceId): string {
  if (source.startsWith('current:')) return 'Current workspace area';
  return `Discovery root: ${Uri.parse(source.slice('configured:'.length)).fsPath}`;
}
```

Rename the provider and its current-target dependency to `ProjectTreeProvider` and `currentProjectUri`. Preserve event refresh and disposal behavior.

```ts
interface CurrentProjectPort {
  currentProjectUri(): string | undefined;
}
```

- [ ] **Step 5: Run presentation tests**

```bash
npx vitest run src/test/unit/projectQuickPick.test.ts src/test/unit/projectTreeProvider.test.ts
npm run check-types
```

Expected: PASS.

- [ ] **Step 6: Commit the presentation cleanup**

```bash
git add src/ui src/test/unit/projectQuickPick.test.ts src/test/unit/projectTreeProvider.test.ts
git commit -m "feat: present workspaces and folders as projects"
```

---

### Task 5: Add Project and Add Folder command flows

**Files:**
- Modify: `src/commands/registerCommands.ts`
- Modify: `src/test/unit/commandHandlers.test.ts`
- Modify: `src/test/unit/projectQuickPick.test.ts`
- Create: `src/test/unit/projectSmoke.test.ts`
- Delete: `src/test/unit/stage1Smoke.test.ts`

**Interfaces:**
- Consumes: `ProjectRegistry`, `ProjectOpener`, `FileSystemPort.statKind`, `buildProjectQuickPickItems`, and `CurrentProjectPort.currentProjectUri()`.
- Produces: new command IDs `workspaceAtlas.addProject` and `workspaceAtlas.addFolder`.
- Preserves: every existing string command ID, including IDs whose displayed title changes in Task 6.
- Produces: `ProjectUi` picker methods for add kind, folders, combined project selection, aliases, messages, and reveal.

- [ ] **Step 1: Write failing command tests**

Extend `FakeUi` with `projectKind`, `folders`, `pickProjectKind`, `pickFolders`, and `pickedProject`. Extend the fake filesystem with a `Map<string, TargetKind>`. Add these cases:

```ts
it.each(['workspace', 'folder'] as const)('routes Add Project choice %s', async kind => {
  const harness = createHarness();
  harness.ui.projectKind = kind;
  harness.ui.workspaceFiles = kind === 'workspace' ? ['file:///work/a.code-workspace'] : [];
  harness.ui.folders = kind === 'folder' ? ['file:///work/a'] : [];
  harness.fs.kinds.set(kind === 'workspace' ? 'file:///work/a.code-workspace' : 'file:///work/a',
    kind === 'workspace' ? 'file' : 'directory');

  await harness.run(commandIds.addProject);

  expect(kind === 'workspace'
    ? harness.registry.upsertManualWorkspace.mock.calls
    : harness.registry.upsertManualFolder.mock.calls).toHaveLength(1);
  expect(harness.tree.refresh).toHaveBeenCalledOnce();
});

it('canonicalizes, validates, and adds multiple folders atomically', async () => {
  const { run, ui, registry, fs, tree } = createHarness();
  ui.folders = ['raw:file:///work/one', 'raw:file:///work/two'];
  fs.kinds.set('file:///work/one', 'directory');
  fs.kinds.set('file:///work/two', 'directory');

  await run(commandIds.addFolder);

  expect(registry.upsertManualFolder.mock.calls).toEqual([
    ['file:///work/one'],
    ['file:///work/two'],
  ]);
  expect(tree.refresh).toHaveBeenCalledOnce();
});

it('rejects the complete folder selection before mutating when one target is not a directory', async () => {
  const { run, ui, registry, fs, tree } = createHarness();
  ui.folders = ['file:///work/folder', 'file:///work/file.txt'];
  fs.kinds.set('file:///work/folder', 'directory');
  fs.kinds.set('file:///work/file.txt', 'file');

  await run(commandIds.addFolder);

  expect(registry.upsertManualFolder).not.toHaveBeenCalled();
  expect(tree.refresh).not.toHaveBeenCalled();
  expect(ui.errors).toEqual(['Select folders only.']);
});

it('reports kind mismatch without dispatching another open', async () => {
  const harness = createHarness();
  const folder: ProjectEntry = {
    id: 'file:///work/folder',
    uri: 'file:///work/folder',
    kind: 'folder',
    manuallyRegistered: true,
    discoveredFrom: [],
  };
  harness.registry.entries = [folder];
  harness.opener.open.mockResolvedValue({
    status: 'kind-mismatch',
    expected: 'directory',
    actual: 'file',
  });

  await harness.run(commandIds.switchProject, folder.id);

  expect(harness.ui.warnings).toEqual([
    'Project is no longer a folder. Remove it from Workspace Atlas and add it again.',
  ]);
  expect(harness.tree.refresh).toHaveBeenCalledOnce();
});
```

Update the filesystem smoke test to create a real folder, add it through `addFolder`, open it in both modes, delete it, run `removeMissing`, and assert its registry entry is removed.

- [ ] **Step 2: Run command and smoke tests to verify they fail**

```bash
npx vitest run src/test/unit/commandHandlers.test.ts src/test/unit/projectSmoke.test.ts
```

Expected: FAIL because folder/add-project commands and project-oriented handlers do not exist.

- [ ] **Step 3: Define command IDs and the combined UI port**

Use stable external strings while generalizing internal property names:

```ts
export const commandIds = {
  switchProject: 'workspaceAtlas.switchWorkspace',
  openNewWindow: 'workspaceAtlas.openWorkspaceInNewWindow',
  addProject: 'workspaceAtlas.addProject',
  addWorkspace: 'workspaceAtlas.addWorkspace',
  addFolder: 'workspaceAtlas.addFolder',
  addDiscoveryRoot: 'workspaceAtlas.addDiscoveryRoot',
  removeDiscoveryRoot: 'workspaceAtlas.removeDiscoveryRoot',
  refresh: 'workspaceAtlas.refreshWorkspaces',
  rename: 'workspaceAtlas.renameWorkspace',
  resetName: 'workspaceAtlas.resetWorkspaceName',
  remove: 'workspaceAtlas.removeWorkspace',
  reveal: 'workspaceAtlas.revealWorkspaceFile',
} as const;

export interface ProjectUi {
  pickProjectKind(): Promise<ProjectKind | undefined>;
  pickWorkspaceFiles(): Promise<readonly string[]>;
  pickFolders(): Promise<readonly string[]>;
  pickDiscoveryRoot(): Promise<string | undefined>;
  pickDiscoveryRootToRemove(roots: readonly string[]): Promise<string | undefined>;
  pickProject(entries: readonly ProjectEntry[], currentUri?: string): Promise<ProjectEntry | undefined>;
  inputAlias(entry: ProjectEntry): Promise<string | undefined>;
  showInfo(message: string): Promise<void>;
  showWarning(message: string): Promise<void>;
  showError(message: string): Promise<void>;
  revealFile(uri: string): Promise<void>;
}
```

Rename the exported registration function and dependency type to
`registerProjectCommands` and `RegisterProjectCommandsDependencies`; keep the
source filename `registerCommands.ts` because it remains the single command
registration module.

Implement `pickProjectKind` with `Workspace File` and `Folder` Quick Pick items carrying a `kind` property. Implement folders with `{ canSelectFiles: false, canSelectFolders: true, canSelectMany: true }`. The combined picker uses `buildProjectQuickPickItems`, placeholder `Select a workspace or folder`, and both match flags.

- [ ] **Step 4: Implement atomic validation and add routing**

Validate every canonical selection before performing any registry write:

```ts
const addWorkspace = async (): Promise<void> => {
  const selected = (await ui.pickWorkspaceFiles()).map(dependencies.fs.canonicalize);
  const kinds = await Promise.all(selected.map(uri => dependencies.fs.statKind(uri)));
  if (selected.some((uri, index) => !isWorkspaceFileUri(uri) || kinds[index] !== 'file')) {
    throw new Error('Select .code-workspace files only.');
  }
  for (const uri of selected) await dependencies.registry.upsertManualWorkspace(uri);
  if (selected.length > 0) dependencies.tree.refresh();
};

const addFolder = async (): Promise<void> => {
  const selected = (await ui.pickFolders()).map(dependencies.fs.canonicalize);
  const kinds = await Promise.all(selected.map(uri => dependencies.fs.statKind(uri)));
  if (kinds.some(kind => kind !== 'directory')) throw new Error('Select folders only.');
  for (const uri of selected) await dependencies.registry.upsertManualFolder(uri);
  if (selected.length > 0) dependencies.tree.refresh();
};

const addProject = async (): Promise<void> => {
  const kind = await ui.pickProjectKind();
  if (kind === 'workspace') await addWorkspace();
  if (kind === 'folder') await addFolder();
};
```

Register all three add commands. For opening results, refresh once after the opener returns; warn `Project no longer exists.` for missing targets and use the entry kind to produce the exact kind-mismatch message. Rename selection, alias prompt, refresh summaries, and registry-not-found errors from workspace to project wording.

- [ ] **Step 5: Run command, picker, and smoke tests**

```bash
npx vitest run src/test/unit/commandHandlers.test.ts src/test/unit/projectQuickPick.test.ts src/test/unit/projectSmoke.test.ts
npm run check-types
```

Expected: PASS, including original discovery-root canonicalization and command-boundary error tests.

- [ ] **Step 6: Commit folder commands**

```bash
git add src/commands/registerCommands.ts src/test/unit/commandHandlers.test.ts src/test/unit/projectQuickPick.test.ts src/test/unit/projectSmoke.test.ts src/test/unit/stage1Smoke.test.ts
git commit -m "feat: add folders to project switching"
```

---

### Task 6: Extension wiring and polished workbench contributions

**Files:**
- Modify: `src/extension.ts`
- Modify: `src/test/unit/activationCleanup.test.ts`
- Modify: `src/test/integration/extension.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `ProjectRegistry`, `ProjectReconciler`, `ProjectOpener`, `ProjectTreeProvider`, `resolveCurrentProjectUri`, and `registerProjectCommands` (renamed export from Task 5).
- Preserves: internal view ID `workspaceAtlas.workspaces`, registry key, discovery configuration key, and old command ID strings.
- Produces: Projects view/menu/welcome contributions and activation warnings for unusable or partially invalid registry data.

- [ ] **Step 1: Write failing activation and contribution tests**

Update the integration command list to include `workspaceAtlas.addProject` and
`workspaceAtlas.addFolder` while retaining every old ID. Read `contributes` from
`extension.packageJSON`, then require the exact view and command arrays:

```ts
assert.deepEqual(contributes.views, {
  workspaceAtlas: [{ id: 'workspaceAtlas.workspaces', name: 'Projects' }],
});
assert.deepEqual(contributes.commands, [
  { command: 'workspaceAtlas.switchWorkspace', title: 'Workspace Atlas: Switch Project' },
  { command: 'workspaceAtlas.openWorkspaceInNewWindow', title: 'Workspace Atlas: Open Project in New Window', icon: '$(empty-window)' },
  { command: 'workspaceAtlas.addProject', title: 'Workspace Atlas: Add Project...', icon: '$(add)' },
  { command: 'workspaceAtlas.addWorkspace', title: 'Workspace Atlas: Add Workspace...' },
  { command: 'workspaceAtlas.addFolder', title: 'Workspace Atlas: Add Folder...' },
  { command: 'workspaceAtlas.addDiscoveryRoot', title: 'Workspace Atlas: Add Discovery Root...' },
  { command: 'workspaceAtlas.removeDiscoveryRoot', title: 'Workspace Atlas: Remove Discovery Root...' },
  { command: 'workspaceAtlas.refreshWorkspaces', title: 'Workspace Atlas: Refresh Projects', icon: '$(refresh)' },
  { command: 'workspaceAtlas.renameWorkspace', title: 'Workspace Atlas: Rename Project' },
  { command: 'workspaceAtlas.resetWorkspaceName', title: 'Workspace Atlas: Reset Project Name' },
  { command: 'workspaceAtlas.removeWorkspace', title: 'Workspace Atlas: Remove from Workspace Atlas' },
  { command: 'workspaceAtlas.revealWorkspaceFile', title: 'Workspace Atlas: Reveal in File Manager' },
  { command: 'workspaceAtlas.openEntryInCurrentWindow', title: 'Open Project' },
]);
```

Assert the Activity Bar icon remains `resources/workspace-routes-thin.svg`. Assert view-title navigation uses `addProject` and `refreshWorkspaces`, item removal uses `viewItem == project.manual`, welcome content says `No projects registered`, and `contributes.keybindings` remains absent.

Update activation message tests:

```ts
it.each([
  [1, 'Removed 1 missing project.'],
  [2, 'Removed 2 missing projects.'],
])('formats project cleanup for %i removals', (removed, expected) => {
  expect(activationCleanupMessage('activation', removed)).toBe(expected);
});

it('formats discarded registry records without mentioning migration', () => {
  expect(registryLoadWarning({ discarded: 2, reset: false, migrated: 1 }))
    .toBe('Workspace Atlas ignored 2 invalid saved projects.');
});
```

- [ ] **Step 2: Run activation and integration compilation tests to verify they fail**

```bash
npx vitest run src/test/unit/activationCleanup.test.ts
npm run compile:integration
```

Expected: FAIL because current activation copy and contributed workbench JSON are workspace-only.

- [ ] **Step 3: Wire current project separately from workspace discovery context**

Instantiate `VscodeFileSystem` before the current ports. Keep a workspace-only port for sibling discovery and add a project port for presentation:

```ts
const fs = new VscodeFileSystem();
const currentWorkspace = {
  workspaceFileUri: (): string | undefined => workspace.workspaceFile?.toString(),
};
const currentProject = {
  currentProjectUri: (): string | undefined => {
    const resolved = resolveCurrentProjectUri({
      workspaceFileUri: workspace.workspaceFile?.toString(),
      workspaceFolderUris: workspace.workspaceFolders?.map(folder => folder.uri.toString()) ?? [],
    });
    return resolved ? fs.canonicalize(resolved) : undefined;
  },
};
```

Pass `currentWorkspace` only to `DiscoveryCoordinator`. Pass `currentProject` to the tree and commands. Instantiate generalized registry, reconciler, opener, and tree classes. Rename background warnings to `could not refresh projects`.

Add a pure load warning formatter:

```ts
export function registryLoadWarning(result: {
  discarded: number;
  reset: boolean;
  migrated: number;
}): string | undefined {
  if (result.reset) {
    return 'Workspace Atlas could not read its local registry and started with an empty list.';
  }
  if (result.discarded <= 0) return undefined;
  const suffix = result.discarded === 1 ? 'project' : 'projects';
  return `Workspace Atlas ignored ${result.discarded} invalid saved ${suffix}.`;
}
```

Migration alone is silent. Display the formatter result once during activation when defined.

- [ ] **Step 4: Update native contributions without breaking IDs**

Apply these manifest rules:

- Change the view display name to `Projects` but retain `workspaceAtlas.workspaces`.
- Add `workspaceAtlas.addProject` and `workspaceAtlas.addFolder`.
- Remove the Add Workspace icon so only Add Project occupies the view title.
- Rename displayed command titles to Project wording while retaining old strings in each `command` field.
- Use `workspaceAtlas.addProject` in `view/title` `navigation@1` and keep refresh at `navigation@2`.
- Keep discovery-root commands in `management` groups.
- Keep open-new-window at `inline@1`.
- Show Remove from Workspace Atlas only when `viewItem == project.manual`.
- Update welcome content to `No projects registered.\n[Add Project](command:workspaceAtlas.addProject)\n[Add Discovery Root](command:workspaceAtlas.addDiscoveryRoot)`.
- Update description to `Discover, organize, and switch between VS Code workspace files and folders.`
- Add `folder` and `project switcher` keywords while retaining existing workspace keywords.

- [ ] **Step 5: Run unit, integration, and manifest verification**

```bash
npm test
npm run compile:integration
npm run test:integration
```

Expected: PASS. The extension-host suite sees the complete command surface and exact native contribution JSON, including the thin routes icon and no default keybindings.

- [ ] **Step 6: Commit workbench wiring**

```bash
git add src/extension.ts src/test/unit/activationCleanup.test.ts src/test/integration/extension.test.ts package.json
git commit -m "feat: polish the Workspace Atlas project UI"
```

---

### Task 7: Documentation, release notes, and full verification

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify if generated metadata changes: `package-lock.json`

**Interfaces:**
- Documents: Add Project, Add Folder, combined switching, aliases, cleanup timing, discovery boundaries, preserved shortcut IDs, and local-only limitations.
- Verifies: every success criterion from the approved design and an installable VSIX.

- [ ] **Step 1: Update README with the exact user workflow**

Replace the workspace-only opening copy with these documented behaviors:

```md
## Add projects

Use **Add Project** in the Workspace Atlas sidebar and choose either **Workspace
File** or **Folder**. Workspace files may also be discovered beneath configured
roots; folders are added manually so the Projects list stays intentional.

## Open a project

Click a project to open it in the current window, or use its inline **Open Project
in New Window** action. **Workspace Atlas: Switch Project** and **Workspace Atlas:
Open Project in New Window** provide the same combined list through Quick Pick.

Workspace Atlas keeps the existing `workspaceAtlas.switchWorkspace` command ID,
so shortcuts assigned before folder support continue working.
```

Update setup, organization, stale cleanup, keyboard shortcut, and limitation sections to use Projects where referring to both kinds. State explicitly that manually registered folders disappear on activation, refresh, or pre-open validation after deletion, while discovered workspace files retain watcher-driven cleanup.

- [ ] **Step 2: Add an Unreleased changelog section**

```md
## Unreleased

- Add local folders alongside saved `.code-workspace` files.
- Combine both project kinds in the sidebar and Quick Pick with native type icons.
- Add a unified Add Project flow plus direct Add Folder and Add Workspace commands.
- Mark a normal single-folder window as the current project.
- Migrate existing workspace registry entries without losing aliases or provenance.
- Preserve existing command IDs and user-defined keyboard shortcuts.
- Rename the native view and management copy from Workspaces to Projects.
```

- [ ] **Step 3: Run the complete automated suite**

```bash
npm run test:all
```

Expected: PASS for type checking, lint, all Vitest unit tests, production compilation, integration compilation, and Extension Development Host tests.

- [ ] **Step 4: Build and inspect the installable package**

```bash
npm run vsix
npx vsce ls
```

Expected: `workspace-atlas-0.1.0.vsix` is created; the file list includes `dist/extension.js`, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, and `resources/workspace-routes-thin.svg`, and excludes source tests.

- [ ] **Step 5: Perform the completion audit**

Run:

```bash
git diff --check
git diff --check main...HEAD
git status --short
rg -n "workspaceAtlas\.(switchWorkspace|openWorkspaceInNewWindow|addProject|addWorkspace|addFolder)" package.json src
rg -n "kind: 'folder'|kind: 'workspace'" src/domain src/test
```

Expected:

- `git diff --check` produces no output.
- `git status --short` lists only the intended README and changelog changes before the final documentation commit.
- Command search proves old switch/open IDs remain and new add IDs are contributed and registered.
- Kind search proves both project kinds are covered in production and tests.

Then manually smoke-test the VSIX in a clean Extension Development Host:

1. Add a saved workspace and a folder through **Add Project**.
2. Confirm distinct `window` and `folder` icons and the **Current** description.
3. Open each in the current window and a new window.
4. Assign an alias and reset it for each kind.
5. Delete a temporary registered folder, run Refresh Projects, and confirm removal.
6. Confirm discovery roots still add only `.code-workspace` files.
7. Confirm the existing custom shortcut bound to `workspaceAtlas.switchWorkspace` still opens the combined Quick Pick.

- [ ] **Step 6: Commit documentation and release verification changes**

```bash
git add README.md CHANGELOG.md package-lock.json
git commit -m "docs: document folder project support"
```

If `package-lock.json` has no intentional diff, omit it from `git add`.

- [ ] **Step 7: Verify the final branch is clean and reviewable**

```bash
git status -sb
git log --oneline --decorate main..HEAD
```

Expected: branch `feat/folder-support-ui-cleanup` is clean and contains the design, plan, and focused implementation commits in task order.
