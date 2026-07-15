# Current Icon and Restore Layout Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use a theme-colored `pass-filled` icon for the current sidebar project and render excluded-workspace restore items as searchable single-line Quick Pick rows.

**Architecture:** Keep the correction inside the existing native presentation units. `ProjectTreeItem` chooses a current-state icon before applying the kind fallback, while the excluded-item builder moves paths from `detail` to `description` and the picker switches its matching field. No registry, discovery, command, storage, or activation behavior changes.

**Tech Stack:** TypeScript, VS Code Extension API, Vitest, Mocha extension-host integration tests, esbuild, `@vscode/vsce`

## Global Constraints

- Current sidebar project: `ThemeIcon('pass-filled', new ThemeColor('charts.blue'))`.
- Available workspace: uncolored `ThemeIcon('file-code')`.
- Available folder: uncolored `ThemeIcon('folder-opened')`.
- Keep the current project's **Current** description and existing tooltip type/status content.
- Do not programmatically select, reveal, or focus a Tree View row.
- Do not change icons in either project-switching Quick Pick.
- Excluded restore items use `description` for the full path and do not set `detail`.
- The excluded picker matches paths with `matchOnDescription`, not `matchOnDetail`.
- Do not change discovery, exclusion, refresh, validation, restoration, or persistence behavior.
- Do not change Command Center/title-bar settings, extension version, or public command IDs.
- The final installable artifact remains `workspace-atlas-0.1.0.vsix`.

---

## File Structure

- Modify `src/ui/projectTreeProvider.ts`: choose `pass-filled` for current items and kind icons for available items.
- Modify `src/test/unit/projectTreeProvider.test.ts`: verify current folder/workspace and available folder/workspace icon rules.
- Modify `src/ui/excludedWorkspaceQuickPick.ts`: build one-line items and match their descriptions.
- Modify `src/test/adapters/vscode.ts`: model `QuickPick.matchOnDescription` for tests.
- Modify `src/test/unit/excludedWorkspaceQuickPick.test.ts`: verify the new item shape and picker matching without weakening restore lifecycle coverage.
- Modify `README.md` and `CHANGELOG.md`: describe the current-state icon and single-line restore presentation.

---

### Task 1: Current Sidebar Pass Icon

**Files:**
- Modify: `src/ui/projectTreeProvider.ts`
- Test: `src/test/unit/projectTreeProvider.test.ts`

**Interfaces:**
- Consumes: existing `ProjectTreeItem(entry: ProjectEntry, currentUri?: string)` current-URI comparison
- Produces: current `ThemeIcon('pass-filled', ThemeColor('charts.blue'))`
- Preserves: `file-code`, `folder-opened`, **Current**, tooltip, command, context value, and sorting

- [ ] **Step 1: Update the current-folder expectation and add a current-workspace test**

Replace the current-folder icon assertion with:

```ts
expect(item?.iconPath).toEqual(
  new ThemeIcon('pass-filled', new ThemeColor('charts.blue')),
);
```

Rename that test to `uses the current-project icon while marking the current folder`.
Add a separate current workspace test:

```ts
it('uses the current-project icon for a current workspace', () => {
  const currentWorkspace = project('file:///work/current.code-workspace', 'workspace');
  const provider = new ProjectTreeProvider(
    { list: (): ProjectEntry[] => [currentWorkspace] },
    { currentProjectUri: (): string => currentWorkspace.uri },
  );

  const item = provider.getChildren()[0];

  expect(item?.description).toBe('Current');
  expect(item?.iconPath).toEqual(
    new ThemeIcon('pass-filled', new ThemeColor('charts.blue')),
  );
});
```

Retain the existing explicit assertions for available `file-code` and
`folder-opened` icons without colors.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run src/test/unit/projectTreeProvider.test.ts
```

Expected: FAIL because current folder/workspace entries still use their kind
icons rather than `pass-filled`.

- [ ] **Step 3: Implement current-first icon selection**

Replace the icon selection in `ProjectTreeItem` with:

```ts
const iconId = current
  ? 'pass-filled'
  : entry.kind === 'folder' ? 'folder-opened' : 'file-code';
this.iconPath = new ThemeIcon(
  iconId,
  current ? new ThemeColor('charts.blue') : undefined,
);
```

Do not introduce a TreeItem ID, selection API, reveal callback, or activation
change.

- [ ] **Step 4: Run focused and presentation tests and verify GREEN**

Run:

```bash
npx vitest run src/test/unit/projectTreeProvider.test.ts src/test/unit/projectQuickPick.test.ts
```

Expected: PASS. The tree tests verify current/available icon rules, and the
switching Quick Pick test proves its kind icons did not change.

- [ ] **Step 5: Run static checks and commit Task 1**

Run:

```bash
npm run check-types
npm run lint
git diff --check
```

Expected: all exit 0.

```bash
git add src/ui/projectTreeProvider.ts src/test/unit/projectTreeProvider.test.ts
git commit -m "feat: mark the current project with a pass icon"
```

---

### Task 2: Single-Line Excluded Restore Items

**Files:**
- Modify: `src/ui/excludedWorkspaceQuickPick.ts`
- Modify: `src/test/adapters/vscode.ts`
- Test: `src/test/unit/excludedWorkspaceQuickPick.test.ts`

**Interfaces:**
- Consumes: `buildExcludedWorkspaceQuickPickItems(entries, restoreButton)`
- Produces: `description: Uri.parse(exclusion.uri).fsPath`
- Produces: `QuickPick.matchOnDescription = true`
- Removes from item presentation: `detail`
- Preserves: ordering, label, Add button, keyboard/inline restore, live refresh, deduplication, and disposal safety

- [ ] **Step 1: Write failing item-shape and picker-matching assertions**

Change the builder expectation to:

```ts
expect(item).toMatchObject({
  label: '$(file-code) Atlas Alpha',
  description: Uri.parse(entry.uri).fsPath,
  exclusion: entry,
  buttons: [restoreButton],
});
expect(item?.detail).toBeUndefined();
```

In the first picker behavior test, after calling `show`, assert:

```ts
expect(picker.matchOnDescription).toBe(true);
expect(picker.matchOnDetail).toBe(false);
```

- [ ] **Step 2: Extend the test adapter contract**

Add the property to `QuickPick`:

```ts
matchOnDescription: boolean;
matchOnDetail: boolean;
```

Initialize it in `TestQuickPick`:

```ts
matchOnDescription = false;
matchOnDetail = false;
```

This is test infrastructure only; it does not change production behavior.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
npx vitest run src/test/unit/excludedWorkspaceQuickPick.test.ts
```

Expected: FAIL because items still use `detail` and the picker still enables
`matchOnDetail`.

- [ ] **Step 4: Implement single-line item presentation**

Change the item builder field:

```ts
description: Uri.parse(exclusion.uri).fsPath,
```

Change picker configuration:

```ts
quickPick.matchOnDescription = true;
```

Remove the `quickPick.matchOnDetail = true` assignment. Do not change any event,
restore, error, list-refresh, or disposal code.

- [ ] **Step 5: Run focused and command-flow tests and verify GREEN**

Run:

```bash
npx vitest run src/test/unit/excludedWorkspaceQuickPick.test.ts src/test/unit/commandHandlers.test.ts
```

Expected: PASS, including all concurrency and stale-list regressions.

- [ ] **Step 6: Run static checks and commit Task 2**

Run:

```bash
npm run check-types
npm run lint
git diff --check
```

Expected: all exit 0.

```bash
git add src/ui/excludedWorkspaceQuickPick.ts src/test/adapters/vscode.ts src/test/unit/excludedWorkspaceQuickPick.test.ts
git commit -m "feat: align excluded workspace restore items"
```

---

### Task 3: Documentation, Verification, and Final VSIX

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify after verification only: files already named by Tasks 1-2

**Interfaces:**
- Documents: `pass-filled` current sidebar icon and single-line restore results
- Produces: final-head `/Users/nick/projects/workspace-atlas/workspace-atlas-0.1.0.vsix`

- [ ] **Step 1: Update user-facing documentation**

Replace the README sentence describing a generic blue icon accent with:

```md
The current project sorts first, keeps its **Current** label, and uses a
theme-colored `pass-filled` icon in the sidebar; available projects keep their
workspace or folder kind icon.
```

In the restore section, state that excluded workspaces appear as single-line
results with their paths beside the labels and can still be restored by
selection or inline Add.

Update the matching Unreleased changelog bullets to mention the `pass-filled`
current icon and single-line restore layout. Do not describe row highlighting,
Command Center changes, or refresh fixes.

- [ ] **Step 2: Run complete static and automated verification**

Run:

```bash
git diff --check
npm run check-types
npm run lint
npm run test:unit
```

Expected: all commands exit 0 and all unit tests pass.

- [ ] **Step 3: Run extension-host integration tests**

Run:

```bash
npm run test:integration
```

Expected: compilation succeeds and both Workspace Atlas integration tests pass.
If sandboxed Electron aborts before tests, rerun the identical command with the
required GUI permission and record both outcomes.

- [ ] **Step 4: Build and inspect the final VSIX**

Run:

```bash
npm run vsix
npx vsce ls
shasum -a 256 workspace-atlas-0.1.0.vsix
stat -f '%z bytes' workspace-atlas-0.1.0.vsix
git status --short
```

Expected: packaging succeeds, source tests remain absent from the package,
required docs/resources/bundle are included, a final SHA-256 and size are
printed, and only intended documentation changes remain before commit.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: explain current and restore icon polish"
```

- [ ] **Step 6: Verify final branch scope**

Run:

```bash
git status --short --branch
git log --oneline --decorate -8
git diff 017b277..HEAD --stat
```

Expected: the tracked worktree is clean, the three implementation commits are
focused, and the final VSIX remains available as an ignored artifact.
