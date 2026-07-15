# Changelog

All notable changes to Workspace Atlas are documented in this file.

## Unreleased

- Add local folders alongside saved `.code-workspace` files.
- Combine both project kinds in the sidebar and Quick Pick with native
  `file-code` and `folder-opened` Codicons.
- Keep the current project first and label it **Current**, with a blue icon accent
  in the sidebar.
- Add inline new-window and trash actions to every project entry while retaining
  the same actions in project context menus.
- Add a unified Add Project flow plus direct Add Folder and Add Workspace commands.
- Mark a normal single-folder window as the current project.
- Persist exact-path exclusions when discovered workspace files are removed so
  configured-root and current-area discovery do not recreate them.
- Add **Show Excluded Workspaces** with keyboard and inline-add restoration after
  verifying that the target still exists as a `.code-workspace` file, retaining
  its alias and last-opened metadata.
- Make the regular Add Workspace flow clear an exclusion and create a fresh
  manual registration for the selected file.
- Keep manual-only project removal as unregistration, and guarantee that no
  removal or exclusion action deletes, moves, renames, or modifies disk content.
- Migrate legacy registry arrays to atomic `{ entries, exclusions }` state with
  an empty initial exclusions list, retaining entries, aliases, provenance, and
  last-opened metadata; retain kind-less legacy entries as workspace files.
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
