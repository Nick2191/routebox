# Workspace Atlas Project Icons, Current Accent, and Exclusions Design

## Summary

Workspace Atlas will refine its native Projects view with clearer Codicons, a
theme-aware current-project accent, and inline project removal. Discovered
workspace files can be excluded individually without deleting them from disk or
removing their discovery root. Exclusions persist across extension restarts and
can be reviewed and restored through a dedicated Quick Pick.

## Goals

- Use VS Code's `file-code` icon for workspace files.
- Use VS Code's `folder-opened` icon for folder projects.
- Keep the existing **Current** description and add a persistent, theme-provided
  accent to the current project's kind icon.
- Add an inline trash action to every project in the Projects view.
- Allow a discovered workspace to be removed from the active list without
  removing its configured or automatic discovery root.
- Persist per-workspace exclusions across refreshes and VS Code restarts.
- Let users review and restore excluded workspaces from the Projects view.
- Preserve the existing Command Palette removal command and make it use the same
  semantics as the inline action.
- Never delete a workspace file or folder from disk.

## Non-goals

This change does not include:

- Excluding every workspace under a discovery root in one operation.
- Excluding folders, because folders are only registered manually and cannot be
  rediscovered.
- Glob or pattern-based exclusions.
- Automatically restoring an exclusion when its source root changes.
- A custom webview, custom icon library, or arbitrary Tree View row styling.
- Deleting project files or directories from disk.

## User interface

### Project icons and current-project accent

Every active project retains its kind-specific icon:

- Workspace file: the native `file-code` ThemeIcon.
- Folder: the native `folder-opened` ThemeIcon.

When an entry is the current VS Code project, its ThemeIcon also receives a
VS Code theme color. The implementation uses a product theme color rather than
a fixed hex value, so the accent follows the active color theme. The existing
**Current** description remains visible. Non-current icons use the normal
uncolored ThemeIcon behavior.

The accent is applied to the icon rather than the row background. Native Tree
View selection owns the row background and changes as the user navigates, while
the icon accent remains a stable indication of the current project.

### Inline removal

Every active project row exposes **Remove from Workspace Atlas** as a second
inline action after **Open Project in New Window**. The command uses the native
`trash` icon and remains available from the item context menu and Command
Palette.

Removal does not show an additional confirmation dialog, matching the existing
command behavior. It never removes anything from disk.

Removal has two outcomes:

- A manually registered folder or workspace with no discovery provenance is
  deleted from the active registry. It can be registered again through the
  normal Add Project flow.
- A workspace with one or more configured or automatic discovery sources is
  converted into a persistent exclusion and removed from the active registry.
  This applies whether or not it was also registered manually.

### Excluded workspace browser

The Projects view title bar adds **Show Excluded Workspaces**, using the native
`eye-closed` icon. Activating it opens a Quick Pick rather than adding a
permanent second sidebar section.

The Quick Pick lists each excluded workspace using:

- Its retained alias, or its workspace filename without the
  `.code-workspace` suffix.
- Its full local filesystem path.
- The native `file-code` icon.
- An inline **Restore Workspace** button using the native `add` icon.

If there are no exclusions, the command shows a concise informational message.
Triggering the inline restore button restores that item without closing the
Quick Pick, so multiple exclusions can be restored in one session. Selecting an
item performs the same restore operation for keyboard accessibility.

Before restoration, Workspace Atlas verifies that the URI still points to an
existing `.code-workspace` file. A missing or wrong-kind target remains excluded
and produces an actionable error. A successful restore removes the exclusion
and registers the workspace manually, making it immediately visible even if its
original discovery source is no longer active.

Adding the same workspace through the existing **Add Workspace** picker also
clears its exclusion and registers it manually.

## Persistence model

### Registry state

The registry stores active entries and exclusions together so a remove or
restore operation is one queued, atomic persistence mutation:

```ts
interface ExcludedWorkspace {
  id: string;
  uri: string;
  kind: 'workspace';
  alias?: string;
  lastOpenedAt?: number;
}

interface ProjectRegistryState {
  entries: ProjectEntry[];
  exclusions: ExcludedWorkspace[];
}
```

The canonical local file URI remains the stable ID. Exclusions retain the alias
and last-opened timestamp so restoring does not discard user metadata. Discovery
provenance is not retained because it can become stale and will be reconstructed
by later scans if applicable.

### Migration and validation

The existing `workspaceAtlas.registry.v1` storage key remains in use. Its legacy
array value is accepted as `{ entries: legacyEntries, exclusions: [] }` and
rewritten in the new object shape during load. This keeps existing installations
from seeing an empty registry after upgrading.

Load validates active entries and exclusions independently. Malformed active
entries or exclusions are discarded individually, and the existing activation
warning reports the combined discarded-record count. An unusable top-level value
still resets the registry safely.

The registry returns defensive copies of both collections and serializes all
entry/exclusion mutations through its existing mutation queue. A failed storage
write leaves the in-memory active and excluded collections unchanged.

## Registry behavior

The registry exposes explicit operations for the new lifecycle:

- `listExcluded()` returns persisted exclusions.
- `isExcluded(id)` lets reconciliation skip suppressed URIs.
- `removeProject(id)` removes a manual-only project or atomically moves a
  discovered workspace into exclusions.
- `restoreExcluded(id)` atomically removes an exclusion and creates a manually
  registered workspace entry with retained metadata.
- `upsertManualWorkspace(uri)` clears a matching exclusion before creating or
  updating the active manual workspace.

The existing `removeManual` behavior is replaced at command boundaries by the
project-oriented removal operation. Internal cleanup for confirmed missing
targets still deletes active records directly and does not create exclusions.
Missing-path cleanup therefore remains distinct from an intentional user remove.

## Discovery and reconciliation

Configured-root and automatic current-area scans continue returning all matching
workspace URIs. During reconciliation, an excluded URI is ignored before a new
active entry is created. Existing active entries continue receiving normal
source provenance updates.

Because exclusions are keyed by canonical URI, a workspace is suppressed across
all discovery sources. Removing or adding roots does not clear the exclusion.
Deleting and recreating a workspace at the same URI also leaves it excluded until
the user restores or manually adds that exact workspace.

Retiring a discovery source and confirmed missing-target cleanup do not alter the
exclusion collection. Excluded paths are not statted during ordinary active-entry
cleanup; they are validated only when explicitly restored.

## Command and UI flow

### Remove

```text
Trash action / Remove command
  -> resolve active project
  -> registry.removeProject(id)
  -> refresh Projects tree
  -> discovered workspace is excluded, otherwise project is unregistered
```

### Restore

```text
Show Excluded Workspaces
  -> load exclusions into Quick Pick
  -> user selects item or presses its Add button
  -> verify local .code-workspace file
  -> registry.restoreExcluded(id)
  -> refresh Projects tree and Quick Pick
```

### Rediscovery

```text
Discovery scan
  -> canonical workspace URI
  -> skip when registry.isExcluded(uri)
  -> otherwise reconcile active entry and provenance
```

## Error handling

- Removing an entry that disappeared since selection reports that the project is
  no longer registered.
- Restoring an unknown exclusion reports that it is no longer excluded and
  refreshes the Quick Pick state.
- Restoring a missing target reports that the workspace file no longer exists
  and leaves the exclusion intact.
- Restoring a target that is not a `.code-workspace` file reports the kind
  mismatch and leaves the exclusion intact.
- A failed persistence write leaves both active entries and exclusions at their
  prior in-memory state and is reported through the existing command error UI.
- Discovery errors continue preserving prior active provenance and exclusions.

## Testing

Unit tests will cover:

- `file-code` and `folder-opened` TreeItem icons.
- Theme color applied only to the current project's icon.
- Context values and package menu conditions that expose trash for both manual
  and discovered projects.
- Legacy registry-array migration to state with an empty exclusion list.
- Removing manual-only folders and workspaces without creating exclusions.
- Removing discovered and manual-plus-discovered workspaces into exclusions.
- Exclusion persistence, defensive copies, serialized mutations, and rollback on
  failed writes.
- Manual workspace registration clearing a matching exclusion.
- Reconciliation skipping excluded URIs from configured and automatic sources.
- Confirmed missing cleanup not creating exclusions.
- Excluded Quick Pick labels, paths, icons, and restore buttons.
- Successful restore, missing-target restore, and wrong-kind restore command
  behavior.
- Empty excluded-list messaging.

Integration tests will verify the new command contributions, Codicon identifiers,
view-title action, inline trash action, and relaxed item-context condition that
allows removal of discovered projects.

The complete extension test, lint, type-check, integration-test, and VSIX package
flows remain the final acceptance checks.

## Acceptance criteria

- Workspace rows display `file-code`; folder rows display `folder-opened`.
- The current project's icon has a theme-provided accent and still displays the
  **Current** description.
- Every project row has inline open-in-new-window and trash actions.
- Removing a discovered workspace immediately hides it and subsequent refreshes
  do not rediscover it.
- The exclusion survives extension and VS Code restarts.
- The excluded-workspaces Quick Pick restores one or multiple valid exclusions.
- Regular Add Workspace restores a selected exclusion as a manual project.
- Removing or restoring never deletes or modifies the target on disk.
- Existing registry data migrates without losing active projects or metadata.
- All automated verification and packaging commands pass.
