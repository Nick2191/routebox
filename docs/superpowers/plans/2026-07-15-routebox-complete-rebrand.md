# Routebox Complete Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the active Workspace Atlas identity with Routebox across the VS Code extension, package, documentation, assets, CI, VSIX, GitHub repository, and local checkout.

**Architecture:** Treat the rebrand as a clean pre-Marketplace identity reset. First drive command, view, configuration, storage, and product-copy changes through integration and unit tests; then rename brand assets and packaging surfaces, verify a clean Routebox VSIX, and only after the code is committed and verified rename the GitHub repository and local checkout.

**Tech Stack:** TypeScript, VS Code Extension API, Vitest, Mocha extension-host tests, esbuild, `@vscode/vsce`, GitHub CLI

## Global Constraints

- Product and display name: **Routebox**.
- Package/Marketplace slug: `routebox`; extension ID: `nick.routebox`.
- Tagline: **Your local workspace switcher for VS Code.**
- Description: **Organize and quickly switch between VS Code workspace files and folders.**
- Activity Bar container: `routebox`, titled **Routebox**.
- Projects view: `routebox.projects`, titled **Projects**.
- Every active command ID uses `routebox.*`; no `workspaceAtlas.*` aliases remain.
- Configuration is `routebox.discoveryRoots`; registry storage is `routebox.registry.v1`.
- No registry, setting, shortcut, or installed-extension migration is implemented.
- Keep version `0.1.0`; produce `routebox-0.1.0.vsix`.
- Preserve all discovery, opening, validation, removal, exclusion, restoration, and persistence behavior.
- Preserve domain terms and types whose use of “workspace” describes VS Code data rather than the old brand.
- Keep historical files under `docs/superpowers/` and Git history unchanged.
- Do not add the Marketplace PNG icon, publisher registration, or publishing automation in this plan.
- Rename the GitHub repository and local checkout only after the tracked rebrand is committed and all verification passes.

---

## File Structure

- Modify `package.json` and `package-lock.json`: Routebox package and complete workbench identity.
- Modify `src/commands/registerCommands.ts`: Routebox command IDs, configuration namespace, and validation copy.
- Modify `src/extension.ts`: Routebox settings/view IDs and product messages.
- Modify `src/platform/vscodeRegistryStorage.ts`: Routebox registry key.
- Modify `src/ui/projectTreeProvider.ts`: Routebox current-window command ID.
- Modify integration and focused unit tests before production identifiers.
- Modify `README.md`, `CHANGELOG.md`, `.github/workflows/ci.yml`, and `.vscodeignore`.
- Rename `workspace-atlas.code-workspace` to `routebox.code-workspace`.
- Rename `resources/workspace-routes-thin.svg` to `resources/routebox.svg`.
- Delete unused `resources/workspace-atlas.svg`.
- Rename the GitHub repository and local checkout after verification.

---

### Task 1: Runtime and Workbench Identity

**Files:**
- Modify: `src/test/integration/extension.test.ts`
- Modify: `src/test/unit/activationCleanup.test.ts`
- Modify: `src/test/unit/commandHandlers.test.ts`
- Modify: `src/test/unit/projectTreeProvider.test.ts`
- Modify: `src/test/unit/vscodeFileSystem.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/commands/registerCommands.ts`
- Modify: `src/extension.ts`
- Modify: `src/platform/vscodeRegistryStorage.ts`
- Modify: `src/ui/projectTreeProvider.ts`
- Rename: `resources/workspace-routes-thin.svg` to `resources/routebox.svg`

**Interfaces:**
- Produces: extension ID `nick.routebox`
- Produces: view container `routebox`, view `routebox.projects`, configuration `routebox.discoveryRoots`, and registry key `routebox.registry.v1`
- Produces: the exact Routebox command contract below
- Preserves: handlers, arguments, context values, menu grouping, icons, and failure behavior

- [ ] **Step 1: Replace integration expectations with the Routebox contract**

Change the suite and extension lookups to:

```ts
suite('Routebox extension', () => {
  test('activates and registers its public commands', async () => {
    const extension = vscode.extensions.getExtension('nick.routebox');
```

Expect this exact registered-command list:

```ts
for (const id of [
  'routebox.switchProject',
  'routebox.openProjectInNewWindow',
  'routebox.addProject',
  'routebox.addWorkspace',
  'routebox.addFolder',
  'routebox.addDiscoveryRoot',
  'routebox.removeDiscoveryRoot',
  'routebox.refreshProjects',
  'routebox.showExcludedWorkspaces',
  'routebox.renameProject',
  'routebox.resetProjectName',
  'routebox.removeProject',
  'routebox.revealProject',
  'routebox.openProjectInCurrentWindow',
]) assert.ok(commands.includes(id), `${id} was not registered`);
```

Expect the views and container to be:

```ts
assert.deepEqual(contributes.views, {
  routebox: [{ id: 'routebox.projects', name: 'Projects' }],
});
assert.deepEqual(contributes.viewsContainers, {
  activitybar: [{
    id: 'routebox',
    title: 'Routebox',
    icon: 'resources/routebox.svg',
  }],
});
```

Replace the command contribution expectation with:

```ts
[
  { command: 'routebox.switchProject', title: 'Routebox: Switch Project' },
  { command: 'routebox.openProjectInNewWindow', title: 'Routebox: Open Project in New Window', icon: '$(empty-window)' },
  { command: 'routebox.addProject', title: 'Routebox: Add Project...', icon: '$(add)' },
  { command: 'routebox.addWorkspace', title: 'Routebox: Add Workspace...' },
  { command: 'routebox.addFolder', title: 'Routebox: Add Folder...' },
  { command: 'routebox.addDiscoveryRoot', title: 'Routebox: Add Discovery Root...' },
  { command: 'routebox.removeDiscoveryRoot', title: 'Routebox: Remove Discovery Root...' },
  { command: 'routebox.refreshProjects', title: 'Routebox: Refresh Projects', icon: '$(refresh)' },
  { command: 'routebox.showExcludedWorkspaces', title: 'Routebox: Show Excluded Workspaces', icon: '$(eye-closed)' },
  { command: 'routebox.renameProject', title: 'Routebox: Rename Project' },
  { command: 'routebox.resetProjectName', title: 'Routebox: Reset Project Name' },
  { command: 'routebox.removeProject', title: 'Routebox: Remove from Routebox', icon: '$(trash)' },
  { command: 'routebox.revealProject', title: 'Routebox: Reveal in File Manager' },
  { command: 'routebox.openProjectInCurrentWindow', title: 'Open Project' },
]
```

Use `view == routebox.projects` in every menu expectation and expect:

```ts
{
  view: 'routebox.projects',
  contents: 'No projects registered.\n[Add Project](command:routebox.addProject)\n[Add Discovery Root](command:routebox.addDiscoveryRoot)',
}
```

Add configuration assertions:

```ts
const configuration = contributes.configuration as {
  title: string;
  properties: Record<string, unknown>;
};
assert.equal(configuration.title, 'Routebox');
assert.deepEqual(Object.keys(configuration.properties), ['routebox.discoveryRoots']);
```

- [ ] **Step 2: Update focused unit expectations before production code**

Make these exact expectation changes:

```ts
// src/test/unit/activationCleanup.test.ts
'Routebox ignored 2 invalid saved projects.'
'Routebox could not read its local registry and started with an empty list.'

// src/test/unit/commandHandlers.test.ts
'Project is no longer a folder. Remove it from Routebox and add it again.'

// src/test/unit/projectTreeProvider.test.ts
command: 'routebox.openProjectInCurrentWindow'

// src/test/unit/vscodeFileSystem.test.ts
['routebox.registry.v1', registryState]
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
npx vitest run \
  src/test/unit/activationCleanup.test.ts \
  src/test/unit/commandHandlers.test.ts \
  src/test/unit/projectTreeProvider.test.ts \
  src/test/unit/vscodeFileSystem.test.ts
npm run test:integration
```

Expected: units fail on old messages, command ID, and registry key. Integration
fails to find `nick.routebox` because the manifest still declares
`workspace-atlas`.

- [ ] **Step 4: Change the package and workbench identity**

First rename the active sidebar resource without changing its bytes:

```bash
git mv resources/workspace-routes-thin.svg resources/routebox.svg
```

Set the manifest identity to:

```json
{
  "name": "routebox",
  "displayName": "Routebox",
  "description": "Organize and quickly switch between VS Code workspace files and folders.",
  "version": "0.1.0",
  "publisher": "nick"
}
```

Set the view contributions to:

```json
"viewsContainers": {
  "activitybar": [{
    "id": "routebox",
    "title": "Routebox",
    "icon": "resources/routebox.svg"
  }]
},
"views": {
  "routebox": [{ "id": "routebox.projects", "name": "Projects" }]
}
```

Apply Step 1's exact command IDs/titles to `contributes.commands`. Replace all
menu commands with their Routebox mappings, all view conditions with
`view == routebox.projects`, and the welcome contribution with Step 1's value.
Set configuration to:

```json
"configuration": {
  "title": "Routebox",
  "properties": {
    "routebox.discoveryRoots": {
      "type": "array",
      "scope": "machine-overridable",
      "default": [],
      "items": { "type": "string" },
      "description": "Folder URIs recursively searched for .code-workspace files."
    }
  }
}
```

Update both root package-name occurrences in `package-lock.json` from
`workspace-atlas` to `routebox`; do not alter dependency resolutions.

- [ ] **Step 5: Change production identifiers and product copy**

Replace `commandIds` and the internal current-window ID with:

```ts
export const commandIds = {
  switchProject: 'routebox.switchProject',
  openNewWindow: 'routebox.openProjectInNewWindow',
  addProject: 'routebox.addProject',
  addWorkspace: 'routebox.addWorkspace',
  addFolder: 'routebox.addFolder',
  addDiscoveryRoot: 'routebox.addDiscoveryRoot',
  removeDiscoveryRoot: 'routebox.removeDiscoveryRoot',
  refresh: 'routebox.refreshProjects',
  rename: 'routebox.renameProject',
  resetName: 'routebox.resetProjectName',
  remove: 'routebox.removeProject',
  showExcluded: 'routebox.showExcludedWorkspaces',
  reveal: 'routebox.revealProject',
} as const;

export const openCurrentCommandId = 'routebox.openProjectInCurrentWindow';
```

In `VscodeDiscoveryRootSettings`, read and update through:

```ts
workspace.getConfiguration('routebox')
```

Change the kind-mismatch warning to:

```ts
`Project is no longer a ${expected}. Remove it from Routebox and add it again.`
```

In `src/extension.ts`, use:

```ts
workspace.getConfiguration('routebox')
window.createTreeView('routebox.projects', { treeDataProvider: tree })
event.affectsConfiguration('routebox.discoveryRoots')
```

Use these product messages:

```ts
`Routebox could not refresh projects: ${detail}`
'Routebox could not read its local registry and started with an empty list.'
`Routebox ignored ${result.discarded} invalid saved ${suffix}.`
```

Set `registryKey` to `routebox.registry.v1` and the Tree Item command to
`routebox.openProjectInCurrentWindow`.

- [ ] **Step 6: Run focused and complete verification and verify GREEN**

Run:

```bash
npx vitest run \
  src/test/unit/activationCleanup.test.ts \
  src/test/unit/commandHandlers.test.ts \
  src/test/unit/projectTreeProvider.test.ts \
  src/test/unit/vscodeFileSystem.test.ts
npm run check-types
npm run lint
npm run test:unit
npm run test:integration
git diff --check
```

Expected: all unit tests and both Routebox extension-host tests pass. If
sandboxed Electron aborts, rerun only the identical integration command with
GUI permission and record both outcomes.

- [ ] **Step 7: Commit the runtime identity**

```bash
git add package.json package-lock.json \
  src/commands/registerCommands.ts src/extension.ts \
  src/platform/vscodeRegistryStorage.ts src/ui/projectTreeProvider.ts \
  src/test/integration/extension.test.ts \
  src/test/unit/activationCleanup.test.ts \
  src/test/unit/commandHandlers.test.ts \
  src/test/unit/projectTreeProvider.test.ts \
  src/test/unit/vscodeFileSystem.test.ts resources/routebox.svg
git commit -m "feat: rebrand the extension as Routebox"
```

---

### Task 2: Active Files, Documentation, Assets, and CI

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `.vscodeignore`
- Modify: `src/test/unit/projectSmoke.test.ts`
- Rename: `workspace-atlas.code-workspace` to `routebox.code-workspace`
- Delete: `resources/workspace-atlas.svg`

**Interfaces:**
- Produces: active repository copy and filenames branded Routebox
- Produces: CI artifact `routebox-vsix` containing `routebox-*.vsix`
- Produces: one active sidebar asset, `resources/routebox.svg`
- Preserves: approved SVG contents and every feature's semantics

- [ ] **Step 1: Rename tracked workspace and resource files**

Run:

```bash
git mv workspace-atlas.code-workspace routebox.code-workspace
git rm resources/workspace-atlas.svg
```

Expected: Git records one workspace-file rename and one unused-resource
deletion. `resources/routebox.svg` remains the approved thin routes artwork
committed by Task 1.

- [ ] **Step 2: Update the project workspace and package exclusions**

Set `routebox.code-workspace` to:

```json
{
  "folders": [
    {
      "name": "Routebox",
      "path": "."
    }
  ]
}
```

Add this line to `.vscodeignore`:

```text
*.code-workspace
```

Retain all existing exclusions for source, tests, development configuration,
historical docs, source maps, and VSIX files.

- [ ] **Step 3: Rebrand README without changing feature semantics**

Use this heading and introduction:

```md
# Routebox

Your local workspace switcher for VS Code.

Routebox keeps saved `.code-workspace` files and folders together in a dedicated
Activity Bar view. Add the projects you use, discover workspace files beneath
configured roots, give either kind a shorter name, and open them without hunting
through the filesystem.
```

Apply these active-copy mappings throughout the README:

```text
Workspace Atlas                         -> Routebox
Workspace Atlas: Switch Project         -> Routebox: Switch Project
Workspace Atlas: Open Project in New Window -> Routebox: Open Project in New Window
workspaceAtlas.discoveryRoots           -> routebox.discoveryRoots
workspaceAtlas.switchWorkspace          -> routebox.switchProject
Remove from Workspace Atlas             -> Remove from Routebox
```

Delete statements about preserving old Workspace Atlas command IDs. Replace the
Keyboard Shortcuts section with:

```md
## Keyboard shortcuts

Routebox does not install default keybindings. Open VS Code's **Keyboard
Shortcuts** editor, search for `Routebox`, and assign shortcuts to either project
Quick Pick command or any other Routebox command.
```

Add this note immediately before Development:

```md
## Upgrading from the development preview

Routebox has a new extension identity. Uninstall the previous local development
VSIX, install Routebox, add your projects and discovery roots again, and
reassign any custom shortcuts. Routebox does not read or delete the previous
extension's local registry or settings.
```

Keep limitations, safety guarantees, local-only behavior, and feature
descriptions otherwise unchanged.

- [ ] **Step 4: Rebrand the changelog and active fixture prefix**

Change the changelog introduction to:

```md
All notable changes to Routebox are documented in this file.
```

Add the first Unreleased bullet:

```md
- Establish Routebox as the pre-release product identity with new package,
  command, view, configuration, and storage identifiers.
```

Change the smoke-test temporary directory to:

```ts
const root = await mkdtemp(join(tmpdir(), 'routebox-smoke-'));
```

- [ ] **Step 5: Rebrand the CI package artifact**

Change the upload step in `.github/workflows/ci.yml` to:

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: routebox-vsix
    path: routebox-*.vsix
```

Do not change the OS matrix, Node version, verification commands, or job
dependency.

- [ ] **Step 6: Run the active-brand and file audit**

Run:

```bash
rg -n -i 'Workspace Atlas|workspace-atlas|workspaceAtlas' \
  package.json package-lock.json README.md CHANGELOG.md .github .vscodeignore \
  src routebox.code-workspace resources || true
git diff --check
git status --short
```

Expected: the brand search prints no matches. Historical files under
`docs/superpowers/` are deliberately outside this audit.

- [ ] **Step 7: Run complete static and unit verification**

Run:

```bash
npm run check-types
npm run lint
npm run test:unit
```

Expected: all commands exit 0 and all unit tests pass.

- [ ] **Step 8: Commit active files and packaging identity**

```bash
git add README.md CHANGELOG.md .github/workflows/ci.yml .vscodeignore \
  src/test/unit/projectSmoke.test.ts routebox.code-workspace \
  resources/routebox.svg
git commit -m "chore: complete the Routebox product rebrand"
```

---

### Task 3: Final Verification and Routebox VSIX

**Files:**
- Verify: all tracked Routebox files from Tasks 1-2
- Produce ignored artifact: `routebox-0.1.0.vsix`
- Optionally remove after explicit approval: ignored `workspace-atlas-0.1.0.vsix`

**Interfaces:**
- Consumes: Routebox extension ID, runtime IDs, docs, CI, and resources
- Produces: inspected and clean-installable `routebox-0.1.0.vsix`
- Preserves: tracked worktree cleanliness

- [ ] **Step 1: Run fresh complete verification**

Run:

```bash
git diff --check
npm run check-types
npm run lint
npm run test:unit
npm run test:integration
```

Expected: static checks pass, all unit tests pass, and both Routebox
extension-host integration tests pass. If sandboxed Electron aborts before test
execution, rerun the identical integration command with GUI permission.

- [ ] **Step 2: Build the Routebox VSIX**

Run:

```bash
npm run vsix
```

Expected: `routebox-0.1.0.vsix` is produced. The existing prepublish hook reruns
type checking, linting, unit tests, and the production bundle.

- [ ] **Step 3: Inspect package contents and identity**

Run:

```bash
npx vsce ls
unzip -p routebox-0.1.0.vsix extension/package.json | \
  rg '"name": "routebox"|"displayName": "Routebox"|"publisher": "nick"'
unzip -l routebox-0.1.0.vsix | \
  rg 'extension/(dist/extension.js|readme.md|changelog.md|LICENSE.txt|resources/routebox.svg)'
unzip -l routebox-0.1.0.vsix | \
  rg 'code-workspace|workspace-atlas|workspace-routes-thin|docs/superpowers|src/test' || true
```

Expected: the first searches confirm Routebox identity and required runtime
files. The final negative search prints no matches.

- [ ] **Step 4: Perform an isolated clean install**

Run with permission to invoke the VS Code CLI:

```bash
CLEAN_EXTENSIONS_DIR=$(mktemp -d)
code --extensions-dir "$CLEAN_EXTENSIONS_DIR" \
  --install-extension routebox-0.1.0.vsix --force
code --extensions-dir "$CLEAN_EXTENSIONS_DIR" \
  --list-extensions --show-versions
```

Expected: installation succeeds and the list contains `nick.routebox@0.1.0`.
Leave the temporary directory for the operating system to clean up rather than
running a destructive cleanup command.

- [ ] **Step 5: Record artifact identity and final tracked state**

Run:

```bash
shasum -a 256 routebox-0.1.0.vsix
stat -f '%z bytes' routebox-0.1.0.vsix
git status --short --branch
git log --oneline --decorate -8
```

Expected: SHA-256 and size are printed, the tracked worktree is clean, and the
Routebox VSIX is available as an ignored artifact.

- [ ] **Step 6: Remove the obsolete ignored VSIX only with explicit approval**

If `workspace-atlas-0.1.0.vsix` still exists, request approval to delete that
obsolete ignored artifact. After approval, run:

```bash
rm workspace-atlas-0.1.0.vsix
```

Expected: only `routebox-0.1.0.vsix` remains. If approval is declined, retain the
old ignored artifact and report it without treating the tracked rebrand as
incomplete.

---

### Task 4: GitHub Repository and Local Checkout Rename

**Files/State:**
- Rename GitHub repository: `Nick2191/workspace-atlas` to `Nick2191/routebox`
- Update Git remote: `https://github.com/Nick2191/routebox.git`
- Rename local checkout: `/Users/nick/projects/workspace-atlas` to `/Users/nick/projects/routebox`
- Preserve branch: `feat/folder-support-ui-cleanup`

**Interfaces:**
- Consumes: clean verified Routebox commits and artifact from Task 3
- Produces: coherent Routebox repository URL, origin, and local path
- Preserves: Git history, branch name, remote branches, visibility, and default branch

- [ ] **Step 1: Verify clean state, authentication, and source repository**

Run:

```bash
git status --short --branch
gh auth status
gh repo view Nick2191/workspace-atlas \
  --json nameWithOwner,url,visibility,defaultBranchRef
```

Expected: the tracked worktree is clean, GitHub authentication is valid, and
the source is the existing private Workspace Atlas repository.

- [ ] **Step 2: Verify the destination name is unused**

Run:

```bash
gh repo view Nick2191/routebox --json nameWithOwner,url
```

Expected: GitHub reports that `Nick2191/routebox` does not exist. If it exists,
stop and ask for a different repository slug; do not overwrite anything.

- [ ] **Step 3: Rename the GitHub repository**

With explicit network approval, run:

```bash
gh repo rename routebox --repo Nick2191/workspace-atlas --yes
```

Expected: GitHub reports `Nick2191/routebox`, retaining private visibility and
Git history.

- [ ] **Step 4: Update the remote and publish the rebrand commits**

Run:

```bash
git remote set-url origin https://github.com/Nick2191/routebox.git
git remote -v
git push -u origin feat/folder-support-ui-cleanup
```

Expected: fetch/push URLs use Routebox and the feature branch is synchronized
with the renamed remote.

- [ ] **Step 5: Rename the local checkout from the projects directory**

Run from `/Users/nick/projects`:

```bash
mv /Users/nick/projects/workspace-atlas /Users/nick/projects/routebox
```

Expected: the tracked repository now exists at `/Users/nick/projects/routebox`.
All subsequent commands use that path.

- [ ] **Step 6: Verify the renamed repository and final scope**

Run from `/Users/nick/projects/routebox`:

```bash
git status --short --branch
git remote -v
git log --oneline --decorate -8
test -f routebox.code-workspace
test -f routebox-0.1.0.vsix
test ! -e workspace-atlas.code-workspace
```

Expected: the branch is clean and synchronized, origin uses
`Nick2191/routebox`, the Routebox workspace and VSIX exist, and the old tracked
workspace filename is absent.

---

## Final User Handoff

Report:

- Routebox extension ID and command/settings namespace
- renamed GitHub repository URL and local path
- test counts and extension-host results
- final VSIX path, size, and SHA-256
- that old Workspace Atlas registry/settings were intentionally not migrated
- uninstall/install/re-registration steps from the design
- whether the obsolete ignored Workspace Atlas VSIX was removed or retained
