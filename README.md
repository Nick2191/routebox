# Workspace Atlas

Discover, organize, and switch between `.code-workspace` files.

Workspace Atlas keeps local VS Code workspace files together in a dedicated Activity Bar view. Register individual workspaces, discover them recursively from folders, give them shorter names, and open them without hunting through the filesystem.

## Set up your workspaces

### Add Workspace

Use the **Add Workspace** button in the Workspace Atlas sidebar title, the welcome link in an empty view, or run **Workspace Atlas: Add Workspace...** from the Command Palette. Select one or more `.code-workspace` files to register them manually.

### Add Discovery Root

Use **Add Discovery Root** from the sidebar title or empty-view welcome, or run **Workspace Atlas: Add Discovery Root...** from the Command Palette. Select a folder and Workspace Atlas will recursively discover `.code-workspace` files beneath it. Common build and dependency directories such as `.git` and `node_modules` are skipped.

You can remove a root with **Workspace Atlas: Remove Discovery Root...**. Workspaces found only through that root leave the list; manually registered workspaces remain.

## Open a workspace

Clicking a workspace in the sidebar opens it in the current window. The inline **Open Workspace in New Window** action opens the same entry in a separate window.

The Command Palette also provides two Quick Pick commands:

- **Workspace Atlas: Switch Workspace** opens the selected workspace in the current window.
- **Workspace Atlas: Open Workspace in New Window** opens the selected workspace in a new window.

## Organize and remove entries

Right-click a workspace and choose **Rename Workspace** to assign an alias. The alias changes only the displayed name, not the file. Choose **Reset Workspace Name** to clear the alias and return to the filename-derived label.

**Remove Workspace** removes the manual registration. If the same file is still found through a discovery root, it remains as a discovered entry. **Remove Workspace never deletes files or folders from disk.**

## Stale workspace cleanup

Workspace Atlas watches active discovery roots and refreshes after workspace files are created or deleted. It also refreshes when settings or the current workspace change, when the view becomes visible, and when you run **Workspace Atlas: Refresh Workspaces**. Entries whose files are confirmed missing are removed automatically. An unreadable discovery root retains its existing entries until a successful scan can confirm their state.

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

Workspace Atlas does not install default keybindings. Open VS Code's **Keyboard Shortcuts** editor, search for `Workspace Atlas`, and assign shortcuts to either Quick Pick command or any other Workspace Atlas command.

## Stage 1 limitations

- Desktop VS Code and local `file:` workspaces only.
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
