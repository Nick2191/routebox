# Changelog

All notable changes to Routebox are documented in this file.

## 1.0.0 - 2026-07-16

- Publish the first stable Routebox release for managing local VS Code workspace files and folders.
- Open projects in the current window or a new window.
- Browse and switch projects from the native sidebar and combined Quick Pick.
- Discover `.code-workspace` files under configured roots and around the current workspace area.
- Assign and reset aliases for workspace files and folders.
- Register local folders alongside saved `.code-workspace` files.
- Exclude discovered workspaces, restore them explicitly, and remove stale entries during refreshes.
- Use native Codicons and theme colors, including a distinct marker for the current project.
- Store project metadata locally without telemetry or network requests.
- Support local desktop `file:` workspace files and folders; virtual and remote-specific environments are outside the supported scope.
- Remove or exclude projects from Routebox without deleting, moving, renaming, or modifying files on disk.
