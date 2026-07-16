# Routebox

Your local workspace switcher for VS Code.

Routebox keeps saved `.code-workspace` files and folders together in a dedicated
Activity Bar view. Add the projects you use, discover workspace files beneath
configured roots, give either kind a shorter name, and open them without hunting
through the filesystem.

## Add projects

Use **Add Project** in the Routebox sidebar and choose either **Workspace
File** or **Folder**. Workspace files may also be discovered beneath configured
roots; folders are added manually so the Projects list stays intentional.

For a direct flow, run **Routebox: Add Workspace...** or **Routebox:
Add Folder...** from the Command Palette. Add Workspace accepts one or more saved
`.code-workspace` files; Add Folder registers one or more local folders.

### Add Discovery Root

Use **Add Discovery Root** from the sidebar title or empty-view welcome, or run **Routebox: Add Discovery Root...** from the Command Palette. Select a folder and Routebox will recursively discover `.code-workspace` files beneath it. Common build and dependency directories such as `.git` and `node_modules` are skipped.

You can remove a root with **Routebox: Remove Discovery Root...**. Workspace files found only through that root leave the Projects list; manually registered projects remain.

## Open a project

Click a project to open it in the current window, or use its inline **Open Project
in New Window** action. The sidebar and Quick Picks use VS Code's native
`file-code` Codicon for workspace files and `folder-opened` Codicon for folders.
The current project sorts first, keeps its **Current** label, and uses a
theme-colored `pass-filled` icon in the sidebar; available projects keep their
workspace or folder kind icon.

**Routebox: Switch Project** and **Routebox: Open Project in New
Window** provide the same combined list through Quick Pick.

## Organize, remove, and restore entries

Right-click a project and choose **Rename Project** to assign an alias. The alias changes only the displayed name, not the workspace file or folder. Choose **Reset Project Name** to clear the alias and return to its filesystem-derived label.

Use the inline trash action or right-click **Remove from Routebox** to
remove a project from the list. Removing a manual-only workspace or folder
unregisters it. Removing a workspace that is also known through a discovery root
or the current workspace area excludes that exact workspace-file URI instead, so
later refreshes do not rediscover it. Exclusions are saved across VS Code
restarts and affect only the exact canonical path; other workspace files remain
discoverable.

Use the sidebar's **Show Excluded Workspaces** action (the closed-eye icon), or
run **Routebox: Show Excluded Workspaces**, to review exclusions. Each
excluded workspace appears as a single-line result with its path beside its
label. Select an item or use its inline add action to restore it. Routebox
first checks that the path still exists as a `.code-workspace` file, then
restores it as a manual registration. Restoration from this list keeps the saved
alias and last-opened time. Selecting the same file through **Add Project** >
**Workspace File** or **Routebox: Add Workspace...** also restores it by
clearing its exclusion and creating a fresh manual registration; that regular
Add flow does not reuse the exclusion's saved alias or last-opened time.

Removal and exclusion only change Routebox's registry. They never delete,
move, rename, or modify a workspace file or folder on disk.

## Stale project cleanup

Discovered workspace files retain watcher-driven cleanup: Routebox watches active discovery roots and refreshes after `.code-workspace` files are created or deleted. Manually registered folders are checked on activation, when you run **Routebox: Refresh Projects**, and immediately before they open, so a confirmed deleted folder disappears at those times. Permission and transient I/O failures retain the project, and an unreadable discovery root retains its existing entries until a successful scan can confirm their state.

## Configuration

`routebox.discoveryRoots` is a machine-scoped array of folder URI strings. You can edit it in VS Code settings, for example:

```json
{
  "routebox.discoveryRoots": [
    "file:///Users/nick/Projects",
    "file:///C:/Users/Nick/Projects"
  ]
}
```

Using URI strings rather than platform-specific path strings keeps the stored format unambiguous.

Routebox automatically migrates its earlier registry format on load.
Legacy entry arrays are rewritten as one registry-state object containing the
existing entries plus an empty exclusions list, while preserving aliases,
manual/discovery provenance, and last-opened metadata. Older entries without a
project kind are retained as workspace-file entries.

## Keyboard shortcuts

Routebox does not install default keybindings. Open VS Code's **Keyboard
Shortcuts** editor, search for `Routebox`, and assign shortcuts to either project
Quick Pick command or any other Routebox command.

## Limitations

- Desktop VS Code and local `file:` workspace files and folders only.
- Discovery roots find saved `.code-workspace` files only; folders must be added manually.
- No Git repository or branch awareness.
- No native tab management; current-window and new-window opening use VS Code's standard workspace behavior.

## Upgrading from the development preview

Routebox has a new extension identity. Uninstall the previous local development
VSIX, install Routebox, add your projects and discovery roots again, and
reassign any custom shortcuts. Routebox does not read or delete the previous
extension's local registry or settings.

## Development

Requires Node.js 22 and a compatible desktop VS Code installation.

```bash
npm ci                    # install exact dependencies
npm run compile           # type-check and build the development bundle
npm run test:unit         # run unit tests
npm run test:integration  # run Extension Development Host tests
npm run package           # verify and build the production bundle
npm run vsix              # create the installable VSIX package
```

Run `npm run test:all` for the complete unit and Extension Development Host verification.

## License

Routebox is available under the MIT License. The distribution includes the full `LICENSE` text.
