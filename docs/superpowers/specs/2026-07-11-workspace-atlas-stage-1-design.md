# Workspace Atlas Stage 1 Design

## Summary

Workspace Atlas is a cross-platform VS Code desktop extension for discovering, registering, and quickly opening `.code-workspace` files. It provides a persistent sidebar and searchable Quick Picks. A normal selection opens a workspace in the current window, while a secondary action opens it in a new window.

Stage 1 validates whether VS Code's existing workspace reload behavior is fast and reliable enough for the intended workflow. It does not add native workspace tabs or keep multiple workspaces alive inside one VS Code window.

Marketplace positioning:

> Discover, organize, and switch between `.code-workspace` files.

Project and package name: `workspace-atlas`

Display name: `Workspace Atlas`

## Goals

- Let users manually register one or more `.code-workspace` files.
- Optionally discover `.code-workspace` files beneath configured roots.
- Discover sibling worktree workspace files from the current workspace's surrounding directory.
- Remove registry entries automatically when their files are deleted.
- Offer the same registry through a native sidebar and searchable Quick Picks.
- Open a workspace in the current window by default and in a new window through an alternate action.
- Derive display labels from filenames and allow local custom aliases.
- Store registry data locally because workspace paths are machine-specific and often temporary.
- Use URI-based, supported VS Code APIs for macOS, Windows, and Linux compatibility.

## Non-goals

Stage 1 does not include:

- Git or worktree awareness.
- Workspace profiles, colors, startup commands, or numbered shortcut slots.
- Pinned workspaces, tags, folders, or user-defined grouping.
- Custom default keybindings.
- Native workspace tabs.
- Multiple live workbenches in one window.
- Explicit support for Remote SSH, WSL, dev containers, or browser-hosted VS Code.

These may be reconsidered after the core switching workflow is validated.

## Product behavior

### Registry

The extension maintains a machine-local registry as its source of truth. A workspace can be manually registered, discovered from one or more roots, or both. Provenance is additive so removing a discovery source cannot accidentally remove a manual registration.

The registry is stored in the extension's machine-local global storage. Discovery-root configuration is exposed through VS Code settings. Registry entries and aliases do not participate in Settings Sync.

### Display names

The default label is the workspace filename without the `.code-workspace` suffix. A user may assign a custom alias without modifying the workspace file. Resetting the alias restores the filename-derived label.

### Opening workspaces

- Clicking a sidebar item opens it in the current window.
- An inline item action opens it in a new window.
- `Workspace Atlas: Switch Workspace` shows a Quick Pick and opens the selection in the current window.
- `Workspace Atlas: Open Workspace in New Window` shows the same Quick Pick and opens the selection in a new window.

The currently open workspace is marked in the sidebar and Quick Picks. The sidebar sorts the current workspace first and all remaining entries alphabetically by effective display label. Quick Picks use the same initial order and remain searchable by alias, filename, and path.

## Architecture

The TypeScript extension is divided into focused components:

### `WorkspaceRegistry`

Owns persistence, URI normalization, stable identity, aliases, provenance, and last-opened timestamps. It exposes registry operations without depending on sidebar or Quick Pick APIs.

### `WorkspaceDiscoveryService`

Scans configured roots and the current workspace's surrounding directory for `.code-workspace` files. It returns discoveries and scan outcomes without mutating the registry.

### `WorkspaceReconciler`

Combines manual registrations and discovery results, updates provenance, confirms stale files, and removes invalid entries. It distinguishes a confirmed missing file from an inaccessible or failed scan.

### `WorkspaceTreeProvider`

Maps registry entries to a flat native VS Code tree view. It owns presentation state only and refreshes when registry data changes.

### `WorkspaceCommands`

Coordinates file pickers, Quick Picks, opening behavior, aliases, registration removal, discovery-root management, refreshes, and reveal-in-file-manager behavior.

### Data flow

```text
Manual file picker ──────────────┐
                                │
Configured-root discovery ──────┼─> Reconciler ─> Local registry ─> Sidebar
                                │                         └────────> Quick Picks
Current-area discovery ─────────┘

Filesystem create/delete events ─> Targeted reconciliation ─> Registry refresh
```

No custom webview is required. The extension uses a native view container, tree view, commands, Quick Picks, and VS Code's built-in workspace-opening command.

## Data model

The persisted shape is conceptually:

```ts
interface WorkspaceEntry {
  id: string;
  uri: string;
  alias?: string;
  manuallyRegistered: boolean;
  discoveredFrom: string[];
  lastOpenedAt?: number;
}
```

- `id` is derived from a canonicalized URI and remains stable for that location.
- `uri` is serialized from `vscode.Uri`; code does not construct platform-specific paths by string concatenation.
- `manuallyRegistered` preserves explicit user intent independently of discovery.
- `discoveredFrom` contains canonical source identifiers for configured roots and the transient current-area root; it can contain more than one source.
- `lastOpenedAt` is updated only after the open command is successfully dispatched. It is retained for future recent-workspace features but does not affect Stage 1 sorting.

Duplicate paths that normalize to the same canonical URI produce one entry. Alias and manual-registration metadata survive rediscovery.

## Discovery

### Configured roots

Users may add or remove one or more discovery roots. Each root is searched recursively for filenames ending in `.code-workspace`. Scans skip common heavy or generated directories, including `.git` and `node_modules`.

Discovery roots must be explicitly chosen. Workspace Atlas does not scan an entire home directory by default.

### Current surrounding directory

When VS Code has an active `.code-workspace` file, Workspace Atlas treats the parent of the workspace-containing directory as the surrounding directory.

Example:

```text
/worktrees/BOIS-123/project.code-workspace
```

The containing directory is `/worktrees/BOIS-123`, so `/worktrees` is scanned. This finds workspace files in sibling worktree directories.

If the current window is an untitled workspace or a folder without a saved `.code-workspace` file, current-area discovery does not run. Configured roots and manual registration continue to work.

Current-area discovery is automatic and does not persist its surrounding directory as a configured root.
When the active workspace changes, reconciliation retires provenance from the previous transient current-area root. An affected entry remains only if it is manually registered, still exists under a configured root, or is discovered from the new current area.

### Triggers

Reconciliation runs:

- During extension activation.
- When the Workspace Atlas sidebar first becomes visible.
- When the user runs Refresh Workspaces.
- When configured roots change.
- When a watcher reports creation or deletion of a `.code-workspace` file.
- Immediately before opening a registry entry.

Watchers are created only for active discovery roots, including the current surrounding directory. Watcher changes are debounced to avoid repeated full refreshes during bursts of filesystem activity.

## Reconciliation and cleanup

The following rules prevent both stale entries and accidental data loss:

- A confirmed missing workspace file removes the entire registry entry, including its alias and manual-registration marker.
- A scan error or inaccessible directory does not prove deletion, so existing entries are retained.
- Removing a configured discovery root removes that root from each entry's `discoveredFrom` list.
- An entry is removed after root removal only when it has no remaining discovery provenance and is not manually registered.
- A file deleted while VS Code is closed is removed during the next activation reconciliation.
- A file deleted while VS Code is running is removed after its watcher event is reconciled.
- Before opening, the extension confirms that the selected file still exists. If it does not, the entry is removed and the user sees `Workspace no longer exists.`
- A manual or activation refresh that removes several stale entries shows one summary notification rather than one message per entry.

Removing an entry from Workspace Atlas never deletes its `.code-workspace` file. The `Remove Workspace` command only clears manual registration. If the file remains under an active discovery root, it stays visible because it is still discovered.

## Sidebar UX

Workspace Atlas contributes one Activity Bar container with one flat `Workspaces` view.

The view contains:

- A current-workspace indicator.
- The alias or filename-derived label.
- An inline open-in-new-window action.
- View-title actions for adding a workspace and refreshing.
- Additional management actions in the view-title overflow menu.
- Item context actions for renaming, resetting an alias, removing manual registration, and revealing the file.

The tooltip includes the original filename, full display path, discovery provenance, and current status.

When the registry is empty, welcome content provides two primary paths: `Add Workspace` and `Add Discovery Root`.

## Commands

Stage 1 contributes:

- `Workspace Atlas: Switch Workspace`
- `Workspace Atlas: Open Workspace in New Window`
- `Workspace Atlas: Add Workspace...`
- `Workspace Atlas: Add Discovery Root...`
- `Workspace Atlas: Remove Discovery Root...`
- `Workspace Atlas: Refresh Workspaces`
- `Workspace Atlas: Rename Workspace`
- `Workspace Atlas: Reset Workspace Name`
- `Workspace Atlas: Remove Workspace`
- `Workspace Atlas: Reveal Workspace File`

All commands use a consistent `workspaceAtlas.*` identifier namespace. Switching commands are available to VS Code's Keyboard Shortcuts editor, but Stage 1 ships no default keybindings.

## Error handling

- Selecting a non-`.code-workspace` file through manual registration is rejected with a concise validation message.
- An unreadable discovery root remains configured and produces one actionable warning during a user-initiated refresh; background watcher failures do not repeatedly notify.
- Invalid or corrupt persisted registry data is ignored entry by entry where possible. If the overall stored value is unusable, the extension restores an empty registry and reports that local registry data could not be read.
- A failure to open an existing workspace leaves the registry entry intact and displays the VS Code command failure.
- Concurrent refresh triggers share or serialize reconciliation work so older scan results cannot overwrite newer state.

## Testing strategy

### Unit tests

- URI canonicalization and duplicate detection across supported path styles.
- Filename-derived labels and aliases.
- Registry serialization and malformed-data recovery.
- Manual and discovered provenance merging.
- Removing one of multiple discovery sources.
- Confirmed deletion versus temporary scan failure.
- Sorting, current-workspace identification, and search metadata.

### Filesystem integration tests

Temporary directories and real `.code-workspace` files verify:

- Recursive discovery and excluded directories.
- File creation and deletion reconciliation.
- Configured-root removal.
- Current surrounding-directory calculation.
- Manually registered files outside discovery roots.

### VS Code extension integration tests

- Command registration and activation.
- Tree provider output and inline commands.
- Quick Pick item construction.
- Same-window opening passes the reuse-window option.
- New-window opening passes the new-window option.
- Missing-file validation runs before opening.

### Release verification

- Compile, lint, and run all automated tests.
- Package a `.vsix` successfully.
- Install the package into an Extension Development Host or clean VS Code profile.
- Smoke-test adding, discovering, aliasing, switching, opening in a new window, and deleting a temporary workspace directory.
- Run the automated suite on macOS, Windows, and Linux before Marketplace publication.

## Success criteria

Stage 1 is successful when a user can:

1. Add a `.code-workspace` file manually and see it in both interfaces.
2. Configure a root and see matching workspace files discovered automatically.
3. Open any entry in the current window with one normal selection.
4. Open any entry in a new window through the alternate action.
5. Apply and reset a local alias without modifying the workspace file.
6. Delete a worktree directory and have its missing workspace disappear automatically or on the next activation.
7. Use the same packaged extension on macOS, Windows, and Linux.

## Future decision point

After using Stage 1 in normal work, evaluate switch latency, state restoration, reliability, and window clutter. Only if reload-based switching is inadequate should the project consider a forked native tab strip or retained live workbenches.
