# Workspace Atlas

Discover, organize, and switch between local VS Code projects.

Workspace Atlas keeps saved `.code-workspace` files and folders together in a dedicated Activity Bar view. Add the projects you use, discover workspace files beneath configured roots, give either kind a shorter name, and open them without hunting through the filesystem.

## Add projects

Use **Add Project** in the Workspace Atlas sidebar and choose either **Workspace
File** or **Folder**. Workspace files may also be discovered beneath configured
roots; folders are added manually so the Projects list stays intentional.

For a direct flow, run **Workspace Atlas: Add Workspace...** or **Workspace Atlas:
Add Folder...** from the Command Palette. Add Workspace accepts one or more saved
`.code-workspace` files; Add Folder registers one or more local folders.

### Add Discovery Root

Use **Add Discovery Root** from the sidebar title or empty-view welcome, or run **Workspace Atlas: Add Discovery Root...** from the Command Palette. Select a folder and Workspace Atlas will recursively discover `.code-workspace` files beneath it. Common build and dependency directories such as `.git` and `node_modules` are skipped.

You can remove a root with **Workspace Atlas: Remove Discovery Root...**. Workspace files found only through that root leave the Projects list; manually registered projects remain.

## Open a project

Click a project to open it in the current window, or use its inline **Open Project
in New Window** action. **Workspace Atlas: Switch Project** and **Workspace Atlas:
Open Project in New Window** provide the same combined list through Quick Pick.

Workspace Atlas keeps the existing `workspaceAtlas.switchWorkspace` command ID,
so shortcuts assigned before folder support continue working.

## Organize and remove entries

Right-click a project and choose **Rename Project** to assign an alias. The alias changes only the displayed name, not the workspace file or folder. Choose **Reset Project Name** to clear the alias and return to its filesystem-derived label.

**Remove from Workspace Atlas** removes a manual registration. If the same workspace file is still found through a discovery root, it remains as a discovered project. Removing a project never deletes its workspace file or folder from disk.

## Stale project cleanup

Discovered workspace files retain watcher-driven cleanup: Workspace Atlas watches active discovery roots and refreshes after `.code-workspace` files are created or deleted. Manually registered folders are checked on activation, when you run **Workspace Atlas: Refresh Projects**, and immediately before they open, so a confirmed deleted folder disappears at those times. Permission and transient I/O failures retain the project, and an unreadable discovery root retains its existing entries until a successful scan can confirm their state.

## Configuration

`workspaceAtlas.discoveryRoots` is a machine-scoped array of folder URI strings. You can edit it in VS Code settings, for example:

```json
{
  "workspaceAtlas.discoveryRoots": [
    "file:///Users/nick/Projects",
    "file:///C:/Users/Nick/Projects"
  ]
}
```

Using URI strings rather than platform-specific path strings keeps the stored format unambiguous.

## Keyboard shortcuts

Workspace Atlas does not install default keybindings. Open VS Code's **Keyboard Shortcuts** editor, search for `Workspace Atlas`, and assign shortcuts to either project Quick Pick command or any other Workspace Atlas command. Existing shortcuts bound to `workspaceAtlas.switchWorkspace` continue to open the combined project list.

## Limitations

- Desktop VS Code and local `file:` workspace files and folders only.
- Discovery roots find saved `.code-workspace` files only; folders must be added manually.
- No Git repository or branch awareness.
- No native tab management; current-window and new-window opening use VS Code's standard workspace behavior.

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

Workspace Atlas is available under the MIT License. The distribution includes the full `LICENSE` text.
