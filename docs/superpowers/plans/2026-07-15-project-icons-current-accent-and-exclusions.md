# Project Icons, Current Accent, and Exclusions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish project icons and current-project styling, add inline removal, and persist reversible per-workspace exclusions that discovery respects.

**Architecture:** Extend the existing queued registry snapshot so active entries and excluded workspaces persist atomically under the existing global-state key. Keep discovery responsible for finding files, make reconciliation consult exclusions before adding them, and keep VS Code-specific excluded-workspace behavior in a focused Quick Pick module.

**Tech Stack:** TypeScript, VS Code Extension API, Vitest, Mocha integration tests, esbuild, `@vscode/vsce`

## Global Constraints

- Workspace files use the native `file-code` Codicon.
- Folders use the native `folder-opened` Codicon.
- The current project's icon uses a VS Code theme color and retains the **Current** description.
- Removal never deletes or modifies a workspace file or directory.
- Only discovered workspace files become exclusions; manual-only workspaces and folders are unregistered normally.
- Exclusions are exact canonical local file URIs and persist until explicitly restored or manually added.
- Restoring validates an existing `.code-workspace` file and registers it manually.
- Existing `workspaceAtlas.registry.v1` array data migrates without losing project metadata.
- Existing public command IDs remain stable.
- All production behavior changes follow red-green-refactor test cycles.

---

## File Structure

- Modify `src/domain/projectEntry.ts`: define excluded-workspace records and share label generation.
- Modify `src/domain/projectRegistry.ts`: own active/excluded state, migration, atomic removal, and restoration.
- Modify `src/domain/reconciler.ts`: prevent excluded URIs from being rediscovered.
- Create `src/ui/excludedWorkspaceQuickPick.ts`: build and run the multi-restore Quick Pick.
- Modify `src/ui/projectTreeProvider.ts` and `src/ui/projectQuickPick.ts`: update native icons and current accent.
- Modify `src/commands/registerCommands.ts`: coordinate removal, exclusion browsing, validation, and restoration.
- Modify `src/platform/vscodeRegistryStorage.ts` and `src/extension.ts`: persist and wire the new units.
- Modify `src/test/adapters/vscode.ts`: model `ThemeColor` and Quick Pick buttons for unit tests.
- Modify focused unit/integration tests, `package.json`, `README.md`, and `CHANGELOG.md`.

---

### Task 1: Atomic Registry State and Persistent Exclusions

**Files:**
- Modify: `src/domain/projectEntry.ts`
- Modify: `src/domain/projectRegistry.ts`
- Modify: `src/platform/vscodeRegistryStorage.ts`
- Test: `src/test/unit/projectEntry.test.ts`
- Test: `src/test/unit/projectRegistry.test.ts`
- Test: `src/test/unit/vscodeFileSystem.test.ts`

**Interfaces:**
- Produces: `ExcludedWorkspace`
- Produces: `ProjectRegistryState`
- Produces: `listExcluded(): ExcludedWorkspace[]`
- Produces: `isExcluded(id: string): boolean`
- Produces: `removeProject(id: string): Promise<'removed' | 'excluded'>`
- Produces: `restoreExcluded(id: string): Promise<ProjectEntry>`
- Changes: `RegistryStorage.write(state: ProjectRegistryState): Promise<void>`

- [ ] **Step 1: Write failing label and legacy-migration tests**

Add to `projectEntry.test.ts`:

```ts
const excluded: ExcludedWorkspace = {
  id: 'file:///work/alpha.code-workspace',
  uri: 'file:///work/alpha.code-workspace',
  kind: 'workspace',
  alias: 'Atlas Alpha',
};
expect(projectLabel(excluded)).toBe('Atlas Alpha');
expect(projectLabel({ ...excluded, alias: undefined })).toBe('alpha');
```

Update `MemoryStorage` in `projectRegistry.test.ts` to receive a complete state.
Load a legacy array and require one object-shaped rewrite:

```ts
storage.value = [discoveredEntry()];
registry = new ProjectRegistry(storage);
await registry.load();
expect(registry.list()).toEqual([discoveredEntry()]);
expect(registry.listExcluded()).toEqual([]);
expect(storage.writes.at(-1)).toEqual({
  entries: [discoveredEntry()],
  exclusions: [],
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx vitest run src/test/unit/projectEntry.test.ts src/test/unit/projectRegistry.test.ts src/test/unit/vscodeFileSystem.test.ts
```

Expected: FAIL because the exclusion types, state object, and APIs do not exist.

- [ ] **Step 3: Define the persisted types and validation**

In `projectEntry.ts`:

```ts
export interface ExcludedWorkspace {
  id: string;
  uri: string;
  kind: 'workspace';
  alias?: string;
  lastOpenedAt?: number;
}

type ProjectLabelSource = Pick<ProjectEntry, 'uri' | 'kind' | 'alias'>;
export function projectLabel(entry: ProjectLabelSource): string {
  if (entry.alias?.trim()) return entry.alias.trim();
  const name = posix.basename(Uri.parse(entry.uri).path);
  return entry.kind === 'workspace' ? name.replace(/\.code-workspace$/i, '') : name;
}
```

In `projectRegistry.ts`:

```ts
export interface ProjectRegistryState {
  entries: ProjectEntry[];
  exclusions: ExcludedWorkspace[];
}

export interface RegistryStorage {
  read(): Promise<unknown>;
  write(state: ProjectRegistryState): Promise<void>;
}
```

Recognize the legacy array as `{ entries: stored, exclusions: [] }`. Validate
exclusions as local `.code-workspace` URIs with `kind === 'workspace'`, an
optional string alias, and optional numeric timestamp. Rewrite legacy arrays or
legacy entry kinds while preserving the existing load report behavior.

- [ ] **Step 4: Write failing exclusion lifecycle tests**

Add independent tests for manual-only removal, discovered removal, and restore:

```ts
it('unregisters a manual-only project without excluding it', async () => {
  const entry = await registry.upsertManualFolder('file:///work/folder');
  await expect(registry.removeProject(entry.id)).resolves.toBe('removed');
  expect(registry.list()).toEqual([]);
  expect(registry.listExcluded()).toEqual([]);
});

it('moves a discovered workspace into exclusions with metadata', async () => {
  const entry = { ...discoveredEntry(), alias: 'Alpha', lastOpenedAt: 42 };
  await registry.replace([entry]);
  await expect(registry.removeProject(entry.id)).resolves.toBe('excluded');
  expect(registry.get(entry.id)).toBeUndefined();
  expect(registry.listExcluded()).toEqual([{
    id: entry.id, uri: entry.uri, kind: 'workspace', alias: 'Alpha', lastOpenedAt: 42,
  }]);
});

it('restores an exclusion as a manual workspace', async () => {
  const entry = discoveredEntry();
  await registry.replace([entry]);
  await registry.removeProject(entry.id);
  await expect(registry.restoreExcluded(entry.id)).resolves.toMatchObject({
    id: entry.id, manuallyRegistered: true, discoveredFrom: [],
  });
  expect(registry.listExcluded()).toEqual([]);
});
```

Also test manual-plus-discovered removal, `isExcluded`, regular manual workspace
registration clearing an exclusion, unknown restore, defensive copies,
serialized mutations, invalid exclusions, and rollback after a failed write.

- [ ] **Step 5: Run lifecycle tests and verify RED**

Run `npx vitest run src/test/unit/projectRegistry.test.ts`.

Expected: FAIL because lifecycle methods are absent.

- [ ] **Step 6: Implement one queued mutation over both maps**

Use this internal shape:

```ts
interface MutableRegistryState {
  entries: Map<string, ProjectEntry>;
  exclusions: Map<string, ExcludedWorkspace>;
}
```

Implement the four public exclusion methods. `upsertManualWorkspace` deletes a
matching exclusion in the same mutation. Keep `remove(ids)` and `updateEntries`
limited to active records. Persist the complete copied state before replacing
both in-memory maps so failed writes roll back both collections.

- [ ] **Step 7: Update VS Code storage and verify GREEN**

Change `VscodeRegistryStorage.write` to accept `ProjectRegistryState`; update its
test to expect `['workspaceAtlas.registry.v1', { entries, exclusions: [] }]`.

Run the Task 1 focused test command again. Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/domain/projectEntry.ts src/domain/projectRegistry.ts src/platform/vscodeRegistryStorage.ts src/test/unit/projectEntry.test.ts src/test/unit/projectRegistry.test.ts src/test/unit/vscodeFileSystem.test.ts
git commit -m "feat: persist excluded workspaces"
```

---

### Task 2: Exclusion-Aware Reconciliation

**Files:**
- Modify: `src/domain/reconciler.ts`
- Test: `src/test/unit/reconciler.test.ts`
- Test: `src/test/unit/projectSmoke.test.ts`

**Interfaces:**
- Consumes: `ProjectRegistry.isExcluded(id: string): boolean`
- Preserves: active cleanup and source retirement without mutating exclusions

- [ ] **Step 1: Write failing reconciliation tests**

Add configured-source and `current:` source cases based on:

```ts
const uri = 'file:///root/excluded.code-workspace';
await registry.replace([{
  id: uri,
  uri,
  kind: 'workspace',
  manuallyRegistered: false,
  discoveredFrom: ['configured:file:///root'],
}]);
await registry.removeProject(uri);
await reconciler.reconcileSource('configured:file:///root', okResult(uri));
expect(registry.get(uri)).toBeUndefined();
expect(registry.isExcluded(uri)).toBe(true);
```

Add a test confirming `removeMissing()` deletes a missing active entry without
creating an exclusion.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx vitest run src/test/unit/reconciler.test.ts src/test/unit/projectSmoke.test.ts
```

Expected: FAIL because reconciliation re-adds the excluded URI.

- [ ] **Step 3: Skip exclusions during discovered-entry creation**

Change the new-entry loop to:

```ts
for (const uri of discovered) {
  if (entries.has(uri) || this.registry.isExcluded(uri)) continue;
  entries.set(uri, {
    id: uri,
    uri,
    kind: 'workspace',
    manuallyRegistered: false,
    discoveredFrom: [source],
  });
}
```

Do not modify exclusion state from `retireSource` or `removeMissing`.

- [ ] **Step 4: Verify GREEN and commit Task 2**

Run the Task 2 focused test command. Expected: PASS.

```bash
git add src/domain/reconciler.ts src/test/unit/reconciler.test.ts src/test/unit/projectSmoke.test.ts
git commit -m "feat: keep excluded workspaces out of discovery"
```

---

### Task 3: Native Kind Icons, Current Accent, and Inline Trash

**Files:**
- Modify: `src/test/adapters/vscode.ts`
- Modify: `src/ui/projectTreeProvider.ts`
- Modify: `src/ui/projectQuickPick.ts`
- Modify: `package.json`
- Test: `src/test/unit/projectTreeProvider.test.ts`
- Test: `src/test/unit/projectQuickPick.test.ts`
- Test: `src/test/integration/extension.test.ts`

**Interfaces:**
- Produces: `ThemeIcon('file-code')` for workspaces
- Produces: `ThemeIcon('folder-opened')` for folders
- Produces: `ThemeColor('charts.blue')` only for the current TreeItem icon
- Exposes: inline `workspaceAtlas.removeWorkspace` with `$(trash)`

- [ ] **Step 1: Teach the unit-test adapter about theme colors**

Update `src/test/adapters/vscode.ts`:

```ts
export class ThemeColor {
  constructor(readonly id: string) {}
}

export class ThemeIcon {
  constructor(readonly id: string, readonly color?: ThemeColor) {}
}
```

- [ ] **Step 2: Write failing tree and switching Quick Pick tests**

Change the current folder expectation to:

```ts
expect(item?.iconPath).toEqual(
  new ThemeIcon('folder-opened', new ThemeColor('charts.blue')),
);
```

Require a non-current workspace to use `new ThemeIcon('file-code')` and a
non-current folder to have no color. Update `projectQuickPick.test.ts` so its
labels start with `$(file-code)` or `$(folder-opened)`.

- [ ] **Step 3: Run UI tests and verify RED**

Run:

```bash
npx vitest run src/test/unit/projectTreeProvider.test.ts src/test/unit/projectQuickPick.test.ts
```

Expected: FAIL with the old `window` and `folder` icon IDs and no theme color.

- [ ] **Step 4: Implement the native icon changes**

In `projectTreeProvider.ts`:

```ts
const iconId = entry.kind === 'folder' ? 'folder-opened' : 'file-code';
this.iconPath = new ThemeIcon(
  iconId,
  current ? new ThemeColor('charts.blue') : undefined,
);
```

Import `ThemeColor`. Update `projectQuickPick.ts` to use the same IDs in Codicon
label markup, without a color argument.

- [ ] **Step 5: Write failing manifest assertions for inline trash**

In the integration test, require the command contribution:

```json
{
  "command": "workspaceAtlas.removeWorkspace",
  "title": "Workspace Atlas: Remove from Workspace Atlas",
  "icon": "$(trash)"
}
```

Require both an `inline@2` entry and the existing `manage@3` entry with the
condition `view == workspaceAtlas.workspaces`. Removing the old
`viewItem == project.manual` restriction makes discovered rows removable.

- [ ] **Step 6: Run integration tests and verify RED**

Run:

```bash
npm run compile
npm run compile:integration
npx vscode-test
```

Expected: FAIL because the manifest does not yet provide trash UI for every
project.

- [ ] **Step 7: Update the manifest and verify GREEN**

Add the command icon and both item-menu contributions. Run the Task 3 unit and
integration commands again. Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add src/test/adapters/vscode.ts src/ui/projectTreeProvider.ts src/ui/projectQuickPick.ts package.json src/test/unit/projectTreeProvider.test.ts src/test/unit/projectQuickPick.test.ts src/test/integration/extension.test.ts
git commit -m "feat: polish project icons and removal actions"
```

---

### Task 4: Excluded Workspace Quick Pick and Restore Commands

**Files:**
- Create: `src/ui/excludedWorkspaceQuickPick.ts`
- Create: `src/test/unit/excludedWorkspaceQuickPick.test.ts`
- Modify: `src/test/adapters/vscode.ts`
- Modify: `src/commands/registerCommands.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`
- Test: `src/test/unit/commandHandlers.test.ts`
- Test: `src/test/integration/extension.test.ts`

**Interfaces:**
- Produces: `buildExcludedWorkspaceQuickPickItems(entries, restoreButton)`
- Produces: `VscodeExcludedWorkspacePicker.show(options): Promise<void>`
- Produces: `workspaceAtlas.showExcludedWorkspaces`
- Consumes: registry exclusion lifecycle from Task 1
- Consumes: `FileSystemPort.statKind(uri)` for restore validation

- [ ] **Step 1: Write failing item-builder tests**

Define the expected item shape:

```ts
const restoreButton = {
  iconPath: new ThemeIcon('add'),
  tooltip: 'Restore Workspace',
};
const [item] = buildExcludedWorkspaceQuickPickItems([excluded], restoreButton);
expect(item).toMatchObject({
  label: '$(file-code) Atlas Alpha',
  detail: Uri.parse(excluded.uri).fsPath,
  exclusion: excluded,
  buttons: [restoreButton],
});
```

Also require default labels and case-insensitive, numeric alphabetical sorting.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
npx vitest run src/test/unit/excludedWorkspaceQuickPick.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the builder and picker interface**

Create these interfaces:

```ts
export interface ExcludedWorkspacePickerOptions {
  list(): readonly ExcludedWorkspace[];
  restore(id: string): Promise<void>;
  reportError(error: unknown): Promise<void>;
}

export interface ExcludedWorkspacePicker {
  show(options: ExcludedWorkspacePickerOptions): Promise<void>;
}
```

Implement `VscodeExcludedWorkspacePicker` with `window.createQuickPick`. Use one
`ThemeIcon('add')` item button; restore on `onDidTriggerItemButton` or accepted
selection; rebuild `quickPick.items` after success; keep it open while entries
remain; and hide/dispose when it becomes empty or the user dismisses it. Event
handler errors call `reportError` and keep the failed exclusion visible.

- [ ] **Step 4: Extend the adapter and drive picker behavior in tests**

Add minimal `QuickPick`, `QuickPickItemButton`, `createQuickPick`, accept,
item-button, hide, and disposal support to the VS Code adapter. Test both
keyboard acceptance and inline restoration, multiple sequential restores, and a
failed restore that remains listed.

Run the Task 4 picker test again. Expected: PASS.

- [ ] **Step 5: Write failing command-handler tests**

Extend `RegistryCommandPort` and its fake with `listExcluded`, `removeProject`,
and `restoreExcluded`. Inject a fake `ExcludedWorkspacePicker`. Add:

```ts
it('removes any project with project-oriented semantics', async () => {
  await run(commandIds.remove, discovered.id);
  expect(registry.removeProject).toHaveBeenCalledWith(discovered.id);
  expect(tree.refresh).toHaveBeenCalledOnce();
});

it('reports an empty exclusion list without opening the picker', async () => {
  await run(commandIds.showExcluded);
  expect(ui.infos).toEqual(['No excluded workspaces.']);
  expect(excludedPicker.show).not.toHaveBeenCalled();
});
```

Drive the picker's restore callback and assert that `statKind` is `file`, the URI
still ends in `.code-workspace`, `restoreExcluded(id)` runs only after
validation, and the tree refreshes. Missing, directory, other-file, and
inaccessible targets leave the exclusion intact and report an error.

- [ ] **Step 6: Run command tests and verify RED**

Run `npx vitest run src/test/unit/commandHandlers.test.ts`.

Expected: FAIL because show, restore, and project-oriented removal are unwired.

- [ ] **Step 7: Implement command flows**

Add this ID:

```ts
showExcluded: 'workspaceAtlas.showExcludedWorkspaces',
```

Change removal to `registry.removeProject(entry.id)`. The show handler reports
`No excluded workspaces.` or opens the picker with live list, restore, and error
callbacks. Before `restoreExcluded`, require an existing file and a
`.code-workspace` URI. Use:

- Missing: `Workspace file no longer exists.`
- Wrong kind/extension: `Excluded project is no longer a .code-workspace file.`

Refresh the Projects tree only after successful removal or restoration.

- [ ] **Step 8: Add failing and passing activation/manifest assertions**

Contribute and register:

```json
{
  "command": "workspaceAtlas.showExcludedWorkspaces",
  "title": "Workspace Atlas: Show Excluded Workspaces",
  "icon": "$(eye-closed)"
}
```

Add it to `view/title` as `navigation@3`. Instantiate the picker in
`extension.ts`, inject it into command registration, and update the integration
test's public command and manifest expectations. Run Task 4 unit tests and the
integration suite, observing RED before wiring and GREEN afterward.

- [ ] **Step 9: Commit Task 4**

```bash
git add src/ui/excludedWorkspaceQuickPick.ts src/test/unit/excludedWorkspaceQuickPick.test.ts src/test/adapters/vscode.ts src/commands/registerCommands.ts src/extension.ts package.json src/test/unit/commandHandlers.test.ts src/test/integration/extension.test.ts
git commit -m "feat: restore excluded workspaces from the sidebar"
```

---

### Task 5: Documentation, Full Verification, and VSIX

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify after verification only: files already named by Tasks 1-4

**Interfaces:**
- Documents: removal versus exclusion semantics and restoration
- Produces: verified `workspace-atlas-0.1.0.vsix`

- [ ] **Step 1: Update user-facing documentation**

Document the new Codicons, current accent, inline actions, durable exact-path
exclusions, Show Excluded Workspaces flow, regular Add Workspace restoration,
and the guarantee that removal never deletes disk content. Add the same behavior
and registry-state migration under an Unreleased `CHANGELOG.md` section.

- [ ] **Step 2: Run static verification**

Run:

```bash
git diff --check
npm run check-types
npm run lint
```

Expected: all exit 0 with no warnings.

- [ ] **Step 3: Run complete automated tests**

Run:

```bash
npm run test:unit
npm run test:integration
```

Expected: every unit and integration test passes.

- [ ] **Step 4: Build and inspect the installable extension**

Run:

```bash
npm run vsix
npx vsce ls
shasum -a 256 workspace-atlas-0.1.0.vsix
git status --short
```

Expected: packaging succeeds, required resources/docs are included, test-only
source is absent, the SHA-256 is printed, and no unrelated working-tree changes
exist.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: explain project exclusions and restoration"
```

- [ ] **Step 6: Review the final range**

Run:

```bash
git log --oneline --decorate -8
git diff HEAD~5..HEAD --stat
```

Expected: five focused task commits cover the approved specification without
unrelated files.
