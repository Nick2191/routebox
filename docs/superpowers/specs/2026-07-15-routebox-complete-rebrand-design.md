# Routebox Complete Rebrand Design

## Summary

Workspace Atlas will be fully rebranded as **Routebox** before its first public
Marketplace release. Routebox remains a local desktop VS Code extension for
organizing and switching between saved `.code-workspace` files and folders.
The rebrand changes both visible copy and permanent technical identifiers so the
published extension has one coherent identity.

This is intentionally a clean pre-release identity reset. It does not preserve
the locally installed Workspace Atlas extension's registry, settings, command
IDs, or extension ID. The current private/local user can uninstall Workspace
Atlas, install Routebox, and register projects again.

## Product Identity

- Product and display name: **Routebox**
- Package name and Marketplace slug: `routebox`
- Intended extension ID with the current publisher: `nick.routebox`
- Tagline: **Your local workspace switcher for VS Code.**
- Short description: **Organize and quickly switch between VS Code workspace
  files and folders.**
- Activity Bar container title: **Routebox**
- Primary Tree View title: **Projects**
- Command title prefix: **Routebox:**
- Settings namespace: `routebox`
- Global-state namespace: `routebox`

The publisher value remains `nick` during this rebrand. Publisher registration
and any final publisher-ID adjustment belong to the Marketplace-readiness work
that follows the rebrand.

## Identity Mapping

The active product uses the following mapping:

| Surface | Current | Routebox |
| --- | --- | --- |
| Package name | `workspace-atlas` | `routebox` |
| Display name | `Workspace Atlas` | `Routebox` |
| Extension ID | `nick.workspace-atlas` | `nick.routebox` |
| View container | `workspaceAtlas` | `routebox` |
| Project view | `workspaceAtlas.workspaces` | `routebox.projects` |
| Configuration | `workspaceAtlas.discoveryRoots` | `routebox.discoveryRoots` |
| Registry storage | `workspaceAtlas.registry.v1` | `routebox.registry.v1` |
| VSIX | `workspace-atlas-0.1.0.vsix` | `routebox-0.1.0.vsix` |
| CI artifact | `workspace-atlas-vsix` | `routebox-vsix` |
| Repository/workspace file | `workspace-atlas.code-workspace` | `routebox.code-workspace` |
| Sidebar resource | `workspace-routes-thin.svg` | `routebox.svg` |

Version `0.1.0` remains unchanged for the rebrand artifact. Selecting the first
Marketplace release version is a separate Marketplace-readiness decision.

## Command Contract

All contributed and registered commands move to the `routebox.*` namespace.
Names that previously referred to a workspace while acting on either supported
project kind are corrected to use `Project`.

| Current command | Routebox command | Routebox title |
| --- | --- | --- |
| `workspaceAtlas.switchWorkspace` | `routebox.switchProject` | Routebox: Switch Project |
| `workspaceAtlas.openWorkspaceInNewWindow` | `routebox.openProjectInNewWindow` | Routebox: Open Project in New Window |
| `workspaceAtlas.addProject` | `routebox.addProject` | Routebox: Add Project... |
| `workspaceAtlas.addWorkspace` | `routebox.addWorkspace` | Routebox: Add Workspace... |
| `workspaceAtlas.addFolder` | `routebox.addFolder` | Routebox: Add Folder... |
| `workspaceAtlas.addDiscoveryRoot` | `routebox.addDiscoveryRoot` | Routebox: Add Discovery Root... |
| `workspaceAtlas.removeDiscoveryRoot` | `routebox.removeDiscoveryRoot` | Routebox: Remove Discovery Root... |
| `workspaceAtlas.refreshWorkspaces` | `routebox.refreshProjects` | Routebox: Refresh Projects |
| `workspaceAtlas.renameWorkspace` | `routebox.renameProject` | Routebox: Rename Project |
| `workspaceAtlas.resetWorkspaceName` | `routebox.resetProjectName` | Routebox: Reset Project Name |
| `workspaceAtlas.removeWorkspace` | `routebox.removeProject` | Routebox: Remove from Routebox |
| `workspaceAtlas.showExcludedWorkspaces` | `routebox.showExcludedWorkspaces` | Routebox: Show Excluded Workspaces |
| `workspaceAtlas.revealWorkspaceFile` | `routebox.revealProject` | Routebox: Reveal in File Manager |
| `workspaceAtlas.openEntryInCurrentWindow` | `routebox.openProjectInCurrentWindow` | Open Project |

Manifest menu references, welcome links, Tree Item commands, production command
constants, test adapters, and integration expectations must use the Routebox
IDs. No `workspaceAtlas.*` compatibility aliases are registered.

## Settings and Stored Data

Routebox reads and writes discovery roots only through
`routebox.discoveryRoots`. It stores its project registry only under
`routebox.registry.v1` in its own extension `globalState`.

Because changing the package name changes the extension ID, Routebox cannot
access Workspace Atlas's extension-scoped `globalState`. There is therefore no
automatic registry migration. The old setting and registry key are neither read
nor deleted.

The installation handoff is explicit:

1. Note any discovery roots or aliases that should be recreated.
2. Uninstall the locally installed Workspace Atlas VSIX.
3. Install the Routebox VSIX.
4. Add discovery roots, workspace files, and folders again.
5. Reassign any custom shortcuts to the new `routebox.*` commands.

Routebox must not silently manipulate the old extension's settings or data.

## User-Facing Copy

All active product copy changes from Workspace Atlas to Routebox, including:

- README heading and prose
- changelog introduction and current release notes
- Activity Bar title and command titles
- **Remove from Routebox** labels and validation guidance
- activation, refresh, storage, and validation messages
- Keyboard Shortcuts documentation
- integration suite and test expectation names
- package description and workspace-folder display name

The concepts **workspace**, **workspace file**, and **Workspace Discovery** remain
where they describe VS Code domain behavior. Domain types such as
`ExcludedWorkspace`, `WorkspaceDiscoveryService`, and `WorkspaceSourceId` are
not brand names and are not renamed.

## Repository, Files, and Packaging

The repository should ultimately be named `routebox`, with the local checkout
and origin updated after the code rebrand is committed and verified. Renaming
the GitHub repository is an external operation and occurs only during the
explicit repository-rebrand step of the implementation plan.

Within the tracked project:

- Rename `workspace-atlas.code-workspace` to `routebox.code-workspace` and set
  its folder label to **Routebox**.
- Rename the active sidebar asset from `resources/workspace-routes-thin.svg` to
  `resources/routebox.svg` without changing the approved artwork.
- Remove the unused `resources/workspace-atlas.svg` asset.
- Update `.vscodeignore` so `*.code-workspace` development files are not shipped.
- Rename package-lock root metadata and CI artifact/path patterns.
- Package `routebox-0.1.0.vsix` and confirm only the required Routebox runtime,
  documentation, license, and active resource are included.

Creating the separate PNG Marketplace listing icon, adding publisher metadata,
and publishing are outside this rebrand. They remain part of the subsequent
Marketplace-readiness work.

## Historical Records

Past files under `docs/superpowers/specs/` and `docs/superpowers/plans/` describe
the implementation under its name at that time. They remain unchanged rather
than rewriting historical decisions. Git commit messages and branch names also
remain unchanged.

The active-brand audit excludes historical Superpowers documents and Git
history. It includes source, tests, manifest, root documentation, configuration,
CI, resources, and packaged files.

## Behavior and Architecture

The rebrand does not change discovery, reconciliation, ordering, opening,
exclusion, restoration, filesystem validation, persistence semantics, or UI
interaction behavior. It changes identity strings, resource paths, and their
tests only.

Existing brand-neutral boundaries remain intact:

- `ProjectRegistry` owns project and exclusion state.
- discovery services find local `.code-workspace` files.
- `ProjectTreeProvider` presents Projects.
- command handlers manage and open projects.
- the VS Code adapter stores state and uses native dialogs, Quick Picks, and
  Tree Views.

## Error Handling

Existing failure behavior remains unchanged. Messages that name the product use
Routebox, for example:

- `Routebox could not refresh projects: ...`
- `Routebox could not read its local registry and started with an empty list.`
- `Routebox ignored N invalid saved projects.`
- `Project is no longer a folder. Remove it from Routebox and add it again.`

No new migration warnings or automatic prompts are added because this is a
clean, pre-release identity reset.

## Testing and Verification

Implementation follows test-driven development for observable identity changes:

1. Update manifest integration expectations first and observe failures for old
   extension, command, view, menu, welcome, and configuration IDs.
2. Update unit expectations first for command IDs, storage keys, settings,
   Tree Item commands, and Routebox messages.
3. Apply the minimal production identity changes and return focused tests to
   green.
4. Run type checking, linting, the complete unit suite, and extension-host
   integration tests on the rebranded extension ID.
5. Audit active files for `Workspace Atlas`, `workspace-atlas`, and
   `workspaceAtlas`; only historical Superpowers documents may retain them.
6. Build the production VSIX, inspect its file list, install it into a clean VS
   Code profile, and verify the Routebox Activity Bar, Projects view, commands,
   settings, current/new-window opening, removal, exclusions, and restoration.

## Acceptance Criteria

- VS Code and the packaged extension expose only the Routebox product identity.
- The package and extension ID are `routebox` and `nick.routebox`.
- All active command, view, configuration, and storage IDs use `routebox`.
- All active user-facing copy says Routebox where it names the product.
- Workspace/domain terminology remains correct where it describes VS Code data.
- No compatibility aliases or automatic local-data migration are included.
- The active SVG artwork is preserved under `resources/routebox.svg`; the old
  unused icon is removed.
- Development `.code-workspace` files and historical design documents are not
  included in the VSIX.
- All automated verification passes and `routebox-0.1.0.vsix` is produced.
- The repository and local checkout can be renamed to `routebox` only after the
  verified code rebrand is committed.
