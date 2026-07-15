# Changelog

All notable changes to Workspace Atlas are documented in this file.

## Unreleased

- Add local folders alongside saved `.code-workspace` files.
- Combine both project kinds in the sidebar and Quick Pick with native type icons.
- Add a unified Add Project flow plus direct Add Folder and Add Workspace commands.
- Mark a normal single-folder window as the current project.
- Migrate existing workspace registry entries without losing aliases or provenance.
- Preserve existing command IDs and user-defined keyboard shortcuts.
- Rename the native view and management copy from Workspaces to Projects.

## 0.1.0

- Register individual `.code-workspace` files manually.
- Configure discovery roots for recursive workspace discovery.
- Discover workspaces around the currently open workspace area.
- Remove stale entries after watcher-driven or explicit refreshes.
- Browse and manage workspaces from the Activity Bar sidebar.
- Switch workspaces from current-window and new-window Quick Picks.
- Assign and reset workspace aliases.
- Open workspace files in either the current window or a new window.
