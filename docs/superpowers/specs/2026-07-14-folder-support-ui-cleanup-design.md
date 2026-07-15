# Workspace Atlas Folder Support and UI Cleanup Design

## Summary

Workspace Atlas will manage two kinds of local VS Code launch targets: saved
`.code-workspace` files and folders. Users can register either kind, see them in
one Projects sidebar and one searchable Quick Pick, and open them in the current
window or a new window.

This release also applies a modest native-UI cleanup. It adopts **project** as
the user-facing umbrella term, makes entry types visually distinct, consolidates
the primary add flow, and improves labels, empty states, descriptions, and
tooltips. It does not introduce a webview or broader organization features.

## Goals

- Let users manually register one or more local folders.
- Present saved workspaces and folders in a single registry, sidebar, and Quick
  Pick.
- Support the existing open-in-current-window and open-in-new-window behavior
  for both entry kinds.
- Preserve aliases, last-opened timestamps, removal, and missing-path cleanup
  for both entry kinds.
- Continue discovering `.code-workspace` files without automatically registering
  every directory beneath a discovery root.
- Preserve existing command identifiers so user-created keyboard shortcuts keep
  working.
- Improve the extension's native VS Code presentation without expanding into a
  custom interface.
- Migrate existing persisted workspace records without user intervention or data
  loss.

## Non-goals

This release does not include:

- Automatic folder discovery.
- Folder watchers dedicated to every manually registered folder.
- Pinned projects, groups, tags, recents sections, custom colors, or drag and
  drop.
- Numbered shortcut slots or extension-provided default keyboard shortcuts.
- A first-run walkthrough or custom webview.
- Remote SSH, WSL, dev-container, or browser-hosted VS Code support.
- Git repository, branch, or worktree awareness.
- Native project tabs or multiple live workbenches.

## Terminology

- **Project** is the user-facing umbrella term for an item Workspace Atlas can
  open.
- **Workspace** is a saved local `.code-workspace` file.
- **Folder** is a local directory opened directly as a VS Code folder window.
- **Discovery** continues to refer only to finding `.code-workspace` files below
  configured or automatic roots.

Internal extension and view identifiers retain their existing names where
changing them would break user configuration or saved VS Code state.

## Product behavior

### Adding projects

The sidebar exposes one primary **Add Project...** action. It opens a small Quick
Pick with two choices:

- **Workspace File** runs the existing multi-select `.code-workspace` picker.
- **Folder** opens a multi-select folder picker that accepts one or more folders.

The Command Palette also exposes direct **Add Workspace...** and **Add Folder...**
commands. The existing Add Workspace command identifier remains unchanged.

A selected workspace must be a `.code-workspace` file. A selected folder must
exist and be a directory. Paths are canonicalized before registration. Selecting
an already registered project is idempotent and does not create a duplicate or
clear its alias.

Folders are manually registered only. Configured discovery roots and automatic
current-area discovery continue finding `.code-workspace` files and do not add
directories as projects.

### Opening projects

- Selecting a sidebar item opens it in the current window.
- The existing inline item action opens it in a new window.
- The Quick Pick switching command opens the selected project in the current
  window.
- The alternate Quick Pick command opens the selected project in a new window.

Both kinds use VS Code's supported `vscode.openFolder` command with the project
URI and either `forceReuseWindow` or `forceNewWindow`. VS Code accepts both saved
workspace-file URIs and folder URIs through this command.

The existing command IDs `workspaceAtlas.switchWorkspace` and
`workspaceAtlas.openWorkspaceInNewWindow` remain stable so custom keybindings do
not break. Their displayed titles change to **Workspace Atlas: Switch Project**
and **Workspace Atlas: Open Project in New Window**.

Before opening, Workspace Atlas confirms that the target still exists and has
the expected kind. A missing target is removed and reported. A path whose kind
has changed is retained but rejected with an actionable error so the user can
remove and re-add it intentionally.

### Display names and sorting

Workspace default labels continue using the filename without the
`.code-workspace` suffix. Folder default labels use the final directory name.
Both kinds support local custom aliases and resetting to their default labels.

The current project sorts first. All other projects sort alphabetically by
effective display label, case-insensitively with numeric ordering. A workspace
file and folder with the same label remain separate because their canonical URIs
are different.

### Current-project detection

- A local saved workspace window matches the canonical URI from
  `workspace.workspaceFile`.
- A normal single-folder window matches its sole workspace-folder URI when no
  saved or untitled workspace file is active.
- An untitled workspace and a multi-root window are not treated as a folder
  project merely because they expose workspace folders.

This generalized current-project service is used by both the sidebar and Quick
Pick.

### Removal and missing-path cleanup

**Remove from Workspace Atlas** clears manual registration but never deletes the
target from disk. A discovered workspace remains visible after manual removal if
it still has active discovery provenance. Folders have no discovery provenance,
so removing one removes its registry entry.

Confirmed missing workspaces and folders are removed during activation, manual
refresh, other reconciliation refreshes, and immediately before opening.
Discovered workspace files retain their existing watcher-driven cleanup.
Manually registered folders do not receive one watcher per folder in this
release; their stale entries disappear at the next cleanup point.

An inaccessible target is not equivalent to a confirmed deletion. If VS Code
cannot determine whether it exists, the entry is retained and the user sees an
error only for a user-initiated operation.

## User interface cleanup

### Sidebar

The existing Activity Bar container remains **Workspace Atlas**. Its sole view is
renamed from **Workspaces** to **Projects** while retaining the internal view ID
`workspaceAtlas.workspaces`.

Each tree item shows:

- The alias or kind-derived default label.
- A native `window` icon for a saved workspace or `folder` icon for a folder.
- A **Current** description when it matches the active VS Code target.
- The existing inline open-in-new-window action.

The current indicator no longer replaces the kind icon. The tooltip presents:

- Original workspace filename or folder name.
- Project type.
- Full local path.
- Current or available status.
- Manual and discovery provenance.

The view-title navigation group contains **Add Project...** and **Refresh
Projects**. Discovery-root management remains in the overflow menu. Item context
actions use project-oriented labels:

- **Rename Project**
- **Reset Project Name**
- **Remove from Workspace Atlas**
- **Reveal in File Manager**

The empty view offers **Add Project** and **Add Discovery Root**.

### Quick Picks

Both switching commands display the same combined list. Each item contains:

- A native workspace or folder icon in the label.
- The effective project label.
- A description containing the project type and **Current** when applicable.
- The full path as detail text.

The placeholder reads **Select a workspace or folder**. Search continues matching
the alias, original name, and full path.

### Command surface

The extension contributes these new or updated user-facing commands:

- **Workspace Atlas: Switch Project**
- **Workspace Atlas: Open Project in New Window**
- **Workspace Atlas: Add Project...**
- **Workspace Atlas: Add Workspace...**
- **Workspace Atlas: Add Folder...**
- **Workspace Atlas: Refresh Projects**
- **Workspace Atlas: Rename Project**
- **Workspace Atlas: Reset Project Name**
- **Workspace Atlas: Remove from Workspace Atlas**
- **Workspace Atlas: Reveal in File Manager**

Existing identifiers are retained for renamed commands. New commands use the
existing `workspaceAtlas.*` namespace.

## Architecture

### Unified entry model

The persisted registry generalizes its record while retaining the current data
shape:

```ts
type ProjectKind = 'workspace' | 'folder';

interface ProjectEntry {
  id: string;
  uri: string;
  kind: ProjectKind;
  alias?: string;
  manuallyRegistered: boolean;
  discoveredFrom: WorkspaceSourceId[];
  lastOpenedAt?: number;
}
```

The canonical URI remains the stable ID. A saved workspace points to a file and
a folder points to a directory, so one URI cannot represent both kinds at once.
Folder entries must be manually registered and have an empty `discoveredFrom`
array. Every discovered entry is created with `kind: 'workspace'`.

The implementation renames the general `WorkspaceEntry` and `WorkspaceRegistry`
types to `ProjectEntry` and `ProjectRegistry`. Their source files follow the same
project-oriented naming. Discovery types remain workspace-specific so their
narrower responsibility stays clear. The existing persisted storage key remains
unchanged so the rename does not create a second empty registry.

### Registry migration

Persisted Stage 1 entries have no `kind`. During load, otherwise valid legacy
entries are normalized to `kind: 'workspace'`. The normalized collection is
written back once when migration occurs. Existing aliases, provenance, manual
registration, IDs, URIs, and timestamps are preserved.

Malformed records continue being discarded entry by entry. A record with an
unknown explicit kind is malformed and is not silently coerced. Migration and
malformed-data recovery report through the same concise activation warning
strategy used by the current extension.

### Registry and filesystem responsibilities

The registry owns persistence, canonical identity, aliases, provenance, and
timestamps. It exposes separate registration operations for workspace files and
folders, both implemented through shared mutation and deduplication logic.

The filesystem port gains a way to identify the kind of a URI, rather than only
checking existence. Registration and opening can therefore distinguish a file,
directory, missing target, and unexpected filesystem kind without platform path
heuristics.

### Discovery and reconciliation

The discovery service remains unchanged in purpose: it yields only
`.code-workspace` file URIs. The reconciler marks every discovered item as a
workspace and never alters a manually registered folder.

Generic missing-target cleanup checks all registry entries. Source reconciliation
continues operating only on discovered workspaces and must preserve folder
records while adding or retiring workspace provenance.

### Commands and presentation

Command handlers coordinate the add-project chooser, direct file and folder
pickers, registry mutations, opening, and presentation refreshes. Shared
selection and management handlers accept either entry kind.

The tree provider and Quick Pick builder depend only on the unified entry model
and current-project service. They select labels, icons, descriptions, and tooltip
content based on `kind` without containing persistence or filesystem logic.

### Data flow

```text
Add Workspace picker ───────────┐
                               │
Add Folder picker ──────────────┼─> Unified local registry ─> Projects sidebar
                               │                         └─> Combined Quick Pick
Workspace discovery ─> Reconciler┘

Selection ─> kind/existence validation ─> vscode.openFolder ─> timestamp update
Refresh ───> missing-target validation ─> stale-entry removal ─> UI refresh
```

## Error handling

- A non-`.code-workspace` file selected for workspace registration is rejected.
- A file selected as a folder, or a folder selected as a workspace, is rejected.
- A target confirmed missing before opening is removed and reported as no longer
  existing.
- A target whose kind changed is retained and reported as no longer being the
  registered kind.
- A filesystem permission or transient I/O error does not remove an entry.
- A failed `vscode.openFolder` call leaves the entry intact and does not update
  `lastOpenedAt`.
- Canceling any picker has no side effects.
- Adding a duplicate succeeds idempotently and retains its metadata.
- Background refresh failures do not produce repeated notifications; a manual
  refresh produces one actionable summary.

## Testing strategy

### Domain unit tests

- Legacy-entry migration and migration persistence.
- Rejection of unknown explicit entry kinds.
- Workspace and folder default labels.
- Aliases and alias resets for both kinds.
- Deduplication and metadata preservation.
- Combined sorting with the current project first.
- Discovery provenance updates that preserve folders.
- Confirmed deletion versus inaccessible-target retention.

### Presentation unit tests

- Workspace and folder tree icons, descriptions, context values, commands, and
  tooltips.
- Combined Quick Pick icons, labels, descriptions, details, sorting, and search
  metadata.
- Empty-state and menu contribution conditions.
- Saved-workspace, single-folder, untitled-workspace, and multi-root current
  detection.

### Command and opener tests

- Add Project routes to the selected direct add flow.
- Workspace and folder picker cancellation.
- Folder kind validation and multi-selection.
- Opening each kind in the current and new windows.
- Stable existing command identifiers and updated display titles.
- Missing and kind-changed targets.
- Alias, reset, remove, reveal, and refresh for either kind.

### Regression and release verification

- Existing configured-root and current-area workspace discovery.
- Watcher-driven `.code-workspace` creation and deletion.
- Manual workspace deletion and discovered workspace deletion.
- Registry mutation serialization.
- Type-check, lint, all unit tests, and extension-host integration tests.
- Production bundle and VSIX packaging.
- Manual smoke test on a clean VS Code profile for adding, switching, aliasing,
  refreshing, removing, and deleting both kinds.
- CI coverage on macOS, Windows, and Linux before Marketplace release.

## Documentation and release surface

- Update the extension description and keywords to mention folders.
- Update the README setup, opening, cleanup, shortcut, and limitation sections.
- Add the feature and migration behavior to the changelog.
- Keep the extension preview designation for this release.

## Success criteria

The release is successful when a user can:

1. Add one or more local folders through the sidebar or Command Palette.
2. See folders and saved workspaces together with distinct native icons.
3. Open either kind in the current window or a new window from the sidebar and
   Quick Pick commands.
4. Use an existing custom keybinding for `workspaceAtlas.switchWorkspace`
   without reconfiguration after upgrading.
5. Alias, reset, reveal, and remove either kind without modifying the target on
   disk.
6. Open a folder window and see its corresponding Atlas entry marked Current.
7. Refresh after deleting a registered folder and have the stale entry removed.
8. Upgrade an existing registry and retain every valid workspace, alias,
   provenance value, and timestamp.
9. Continue discovering and cleaning up `.code-workspace` files exactly as in
   Stage 1.
10. Package and use the extension on macOS, Windows, and Linux.

## Future considerations

After this release has been used in normal work, Workspace Atlas can separately
evaluate pinned projects, recent-project sections, numbered shortcut slots, and
onboarding. Those features should build on the unified entry model but are not
part of this implementation.
