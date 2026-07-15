# Workspace Atlas Current Icon and Restore Layout Correction Design

## Summary

Workspace Atlas will make the current project more visually distinct by replacing
its kind icon with VS Code's native `pass-filled` icon while retaining the
existing theme-provided accent and **Current** description. The excluded-
workspace Quick Pick will move each filesystem path from the second detail line
to the same-line description, allowing VS Code to vertically center the inline
Add button within a single-line item.

This is a focused native-UI correction. It does not change project discovery,
exclusion persistence, restoration semantics, workspace color settings, or the
extension's version.

## Goals

- Show `pass-filled` for the current project in the Projects sidebar.
- Retain the theme-provided `charts.blue` color on the current icon.
- Retain the existing **Current** description.
- Continue showing `file-code` for available workspace files.
- Continue showing `folder-opened` for available folders.
- Render excluded-workspace restore items on one line so the Add button is
  vertically centered by VS Code's native Quick Pick layout.
- Keep full excluded paths visible as the item description and searchable.

## Non-goals

This correction does not include:

- Programmatically selecting or revealing the current project.
- Applying a background color to a Tree View row.
- Creating a custom webview or applying custom CSS.
- Changing icons in the project-switching Quick Pick.
- Changing Command Center or title-bar colors.
- Changing exclusion, discovery-root, refresh, or restore behavior.
- Changing the extension version or public command identifiers.

## Projects sidebar

The current project is already identified by comparing each canonical project
URI with the canonical URI resolved from the active VS Code window. That
comparison remains unchanged.

The sidebar icon rules become:

```text
Current project       -> pass-filled + ThemeColor('charts.blue')
Available workspace   -> file-code
Available folder      -> folder-opened
```

The current item continues to display **Current** as its description. Its
tooltip continues to report `Status: Current` and its underlying project kind.
Using `pass-filled` intentionally replaces the kind icon only while the project
is current; type information remains available through the label, tooltip, and
the icon shown when the project is not current.

Workspace Atlas will not programmatically select the row. Native list selection
remains entirely controlled by the user's navigation, avoiding focus changes or
selection conflicts with context-menu actions.

## Excluded-workspace Quick Pick

Each excluded workspace currently uses:

```ts
{
  label: '$(file-code) Workspace Name',
  detail: '/full/path/to/Workspace.code-workspace',
  buttons: [restoreButton],
}
```

The correction changes the path field to `description`:

```ts
{
  label: '$(file-code) Workspace Name',
  description: '/full/path/to/Workspace.code-workspace',
  buttons: [restoreButton],
}
```

VS Code renders `description` on the label line, so each result becomes a single
line and its native Add button aligns vertically with that line. Long paths may
be visually truncated by VS Code, which is acceptable; the item remains
searchable by path because the picker switches from `matchOnDetail` to
`matchOnDescription`.

Keyboard selection, inline Add behavior, multi-restore behavior, in-flight
deduplication, dismissal safety, live-list refresh, validation, and error
reporting remain unchanged.

## Architecture and files

The correction remains within the existing presentation units:

- `src/ui/projectTreeProvider.ts` selects the current or kind-specific ThemeIcon.
- `src/ui/excludedWorkspaceQuickPick.ts` builds single-line items and configures
  description matching.
- Existing VS Code test adapters continue modeling the native objects; no new
  platform abstraction is required.

No registry, reconciler, coordinator, command-handler, storage, or activation
logic changes are necessary.

## Error handling

No error paths change. If an excluded restore fails validation or persistence,
the existing picker behavior reports the error and refreshes from the live
exclusion list. Icon selection is synchronous and contains no new failure mode.

## Testing

Unit tests will verify:

- A current workspace uses `ThemeIcon('pass-filled', ThemeColor('charts.blue'))`.
- A current folder uses the same current-project icon and color.
- Non-current workspaces retain `file-code` without a color.
- Non-current folders retain `folder-opened` without a color.
- Current descriptions and tooltip type/status content remain unchanged.
- Excluded items use `description` for the filesystem path and no `detail`.
- Excluded item ordering, labels, Add buttons, and restore behavior remain intact.
- The picker enables `matchOnDescription` rather than `matchOnDetail`.

The complete unit, type-check, lint, integration, and VSIX packaging flows will
run before handoff.

## Acceptance criteria

- The current sidebar project displays a theme-colored `pass-filled` icon and
  the **Current** description.
- Available sidebar projects retain their workspace/folder kind icons.
- No row is programmatically selected by Workspace Atlas.
- Every excluded-workspace restore result renders as one line with the path next
  to the label and the Add button vertically aligned by native VS Code layout.
- Filtering the excluded picker matches the displayed path.
- Exclusion and refresh behavior is unchanged.
- All automated verification and final-head VSIX packaging pass.
