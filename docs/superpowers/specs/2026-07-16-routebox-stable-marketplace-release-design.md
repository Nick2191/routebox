# Routebox Stable Marketplace Release Design

## Summary

Routebox will prepare one polished, free, stable `1.0.0` release for the Visual
Studio Marketplace. The release will not use a public beta channel or automated
Marketplace publishing. The work focuses on presentation, explicit platform and
security boundaries, reproducible packaging, compatibility verification, and a
small manual release process appropriate for the extension's scope.

The permanent Marketplace publisher identity is intentionally deferred until
all other release-readiness work passes review. The final publisher ID will be
chosen and inserted before the release commit, tag, VSIX build, and upload.

## Goals

- Publish Routebox as a polished stable extension rather than a preview.
- Make the source repository public and use GitHub Issues as the official
  support and bug-reporting channel.
- Give Marketplace users enough information to understand the extension,
  evaluate its privacy and security posture, and report problems.
- State and test Routebox's local-only runtime boundaries.
- Verify the declared minimum VS Code version and current Stable VS Code across
  the supported desktop operating systems.
- Produce one reviewed, reproducible `1.0.0` VSIX and publish it manually.

## Non-goals

- A public pre-release or beta channel.
- Automated Marketplace publishing or stored publishing credentials.
- New project-management features.
- Support guarantees for VS Code for the Web, virtual workspaces, Remote SSH,
  dev containers, or WSL-specific behavior.
- Telemetry, analytics, accounts, cloud sync, or network services.
- Marketplace publisher verification, which is not required for the first
  release and has separate eligibility requirements.

## Repository and Support Model

The GitHub repository will become public before the final package is built so
Marketplace links and listing images resolve for all users. GitHub Issues will
be enabled and will serve as the official support and normal bug-reporting
channel.

The repository will add:

- `SUPPORT.md`, directing questions, feature requests, and ordinary bugs to
  GitHub Issues and explaining what information a useful report should include.
- `SECURITY.md`, directing suspected vulnerabilities to GitHub's private
  vulnerability reporting rather than public issues.
- GitHub private vulnerability reporting, enabled before publication.

The README will state that Routebox collects no telemetry, sends no network
requests, and keeps its registry in VS Code's local extension storage. This
claim must be confirmed by a source and dependency audit before publication.

## Marketplace Presentation

### Manifest metadata

`package.json` will include:

- `repository`, pointing to `https://github.com/Nick2191/routebox`.
- `homepage`, pointing to the public repository documentation.
- `bugs.url`, pointing to the repository's Issues page.
- `pricing: "Free"`.
- `icon`, pointing to the Marketplace PNG asset.
- A restrained `galleryBanner` color and theme that complement the icon.
- The existing relevant category and workspace/project keywords, reviewed for
  clarity and discoverability without keyword stuffing.

The current placeholder publisher value will not be finalized during the main
hardening work. The permanent publisher ID will be selected in the Marketplace
management portal at the final release gate. The selected ID must exactly match
the manifest and will permanently determine the extension ID
`<publisher>.routebox`.

### Visual assets

The existing `resources/routebox.svg` remains the theme-aware Activity Bar icon.
A separate 256 by 256 pixel PNG will be created for the Marketplace listing;
the manifest will never use an SVG as its Marketplace icon.

The listing README will contain at least:

- One screenshot of the Routebox sidebar with representative workspace and
  folder entries.
- One screenshot of the combined Quick Pick.

Images will use Marketplace-compatible HTTPS resolution through the public
repository. Screenshots must avoid personal paths, private repository names,
tokens, email addresses, and unrelated window content.

### Listing copy

The README will preserve the existing detailed usage and safety documentation
while improving the opening presentation. Its first screen will communicate:

- The concise value proposition.
- The distinction between saved `.code-workspace` files and folders.
- Current-window and new-window switching.
- The sidebar and Quick Pick entry points.

Installation, key commands, discovery behavior, removal safety, privacy, and
limitations will remain easy to find. The `CHANGELOG.md` will present the
completed feature set as the `1.0.0` release instead of leaving it under an
`Unreleased` heading.

## Runtime and Security Boundaries

### Extension location

The manifest will declare `extensionKind: ["ui"]`. Routebox is a desktop UI
utility that manages local `file:` workspace and folder URIs and should run in
the local extension host near the VS Code interface.

### Workspace capabilities

The manifest will explicitly declare:

- Virtual workspaces unsupported, with a user-facing explanation that Routebox
  manages local files and folders.
- Untrusted workspaces supported because Routebox does not execute workspace
  code, tasks, shell commands, or workspace-provided executables.

Restricted Mode behavior must be verified before the declaration is accepted.
Routebox may read paths and workspace metadata, but opening a selected project
continues to rely on VS Code's own Workspace Trust handling.

### URI and filesystem behavior

Commands and persistence boundaries will accept only supported local `file:`
URIs. Unsupported schemes will be rejected with a concise user-facing message
rather than being silently stored or partially processed.

Discovery and cleanup verification will cover:

- Deleted workspace files, folders, and roots.
- Inaccessible paths and transient permission failures.
- Windows path casing and canonicalization.
- Symbolic links and traversal termination.
- Large discovery roots.
- Corrupt or legacy local registry data.

Permission or transient I/O failures must not erase otherwise valid registered
projects. Discovery must terminate without following cycles indefinitely.

## Build and Dependency Reproducibility

Direct development dependencies currently expressed as `latest` will be
replaced with deliberate version ranges based on the verified toolchain.
`package-lock.json` remains authoritative for CI through `npm ci`.

The production package remains bundled with esbuild. CI will inspect the final
VSIX so that it contains only runtime and listing files, excludes source tests
and local workspace files, and remains within a small documented size budget.

No platform-specific packages are required because Routebox has no native
modules or platform-specific runtime binaries.

## Verification Strategy

### Automated verification

The existing GitHub Actions matrix continues to run type checks, linting, unit
tests, extension-host integration tests, and production packaging on Windows,
macOS, and Linux using current Stable VS Code.

One Linux compatibility job will additionally run the integration suite against
the declared minimum VS Code version, `1.114.0`. If that version cannot pass the
actual API and behavior suite, `engines.vscode` will be raised to the oldest
version that is tested and supported rather than claiming unverified
compatibility.

Manifest and packaging tests will cover the final identity, stable-release
metadata, capability declarations, expected asset paths, VSIX contents, and
package size.

### Manual release checklist

Before the final publisher identity is committed, manual testing will cover:

- Clean installation of the release candidate VSIX.
- Empty windows, single-folder windows, and saved workspaces.
- Adding workspace files and folders.
- Discovery-root add, refresh, removal, and filesystem watcher behavior.
- Current-window and new-window opening.
- Quick Pick and sidebar actions.
- Aliases, removal, exclusion, restoration, and stale-path cleanup.
- Deleted and inaccessible projects and roots.
- Restricted Mode.
- Representative Windows, macOS, and Linux paths.

The checklist will record the tested VS Code and operating-system versions and
any accepted limitations. Unsupported remote and virtual environments need only
show the declared limitation; they are not release targets.

## Stable Release Process

The release remains manual and proceeds in this order:

1. Confirm that the Marketplace extension name and display name are available.
2. Merge the completed rebrand work into `main`.
3. Implement the approved readiness work on a dedicated branch and merge it
   after review and CI.
4. Make the repository public, enable Issues, and enable private vulnerability
   reporting.
5. Set the package version to `1.0.0`, remove the preview designation, and
   finalize the `1.0.0` changelog.
6. Pass automated verification and the manual release checklist with the
   publisher field still treated as provisional.
7. Create the permanent Marketplace publisher and replace the provisional
   manifest publisher ID.
8. Rerun the complete verification suite, build the final VSIX, inspect it, and
   install it into a clean VS Code profile for a final smoke test.
9. Commit the publisher identity, tag `v1.0.0`, and create a GitHub Release with
   the verified VSIX and checksum.
10. Upload that same VSIX manually through the Marketplace publisher portal.
11. Inspect the live listing and install Routebox directly from the Marketplace.

The release will not add a PAT, Entra workload identity, or automated publish
workflow. If a severe issue requires withdrawal, the extension will be
unpublished rather than permanently removed so that its identity and history
are preserved.

## Acceptance Criteria

- The repository is public and exposes working homepage, repository, Issues,
  support, and private security-reporting paths.
- The Marketplace manifest contains complete stable-release metadata and no
  provisional publisher value when the final VSIX is built.
- The Marketplace icon is a compliant PNG; the Activity Bar retains its SVG.
- The README contains sanitized sidebar and Quick Pick screenshots plus clear
  usage, privacy, support, and limitation information.
- A source audit confirms the no-telemetry and no-network claims.
- Runtime location, virtual-workspace support, and Workspace Trust behavior are
  explicitly declared and verified.
- CI passes on Windows, macOS, and Linux, and compatibility passes against VS
  Code `1.114.0` or the manifest is adjusted to the verified minimum.
- Discovery, URI validation, failure preservation, and symlink termination have
  automated or recorded manual evidence.
- The final `1.0.0` VSIX contents, size, identity, checksum, and clean-profile
  installation are recorded.
- The `v1.0.0` GitHub Release and Marketplace listing use the exact verified
  VSIX.

## Official References

- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Extension Manifest](https://code.visualstudio.com/api/references/extension-manifest)
- [Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host)
- [Workspace Trust Extension Guide](https://code.visualstudio.com/api/extension-guides/workspace-trust)
- [Virtual Workspaces](https://code.visualstudio.com/api/extension-guides/virtual-workspaces)
- [Continuous Integration](https://code.visualstudio.com/api/working-with-extensions/continuous-integration)

