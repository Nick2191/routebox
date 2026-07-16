# Routebox Stable Marketplace Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare, verify, and manually publish one polished, free, stable Routebox `1.0.0` release to the Visual Studio Marketplace.

**Architecture:** Preserve Routebox's existing local registry, discovery, and native VS Code UI architecture. Add an explicit Marketplace/runtime contract in the manifest, public support and security documentation, reproducible release assets and dependencies, and CI gates for the minimum supported VS Code version and packaged contents. Repository visibility, permanent publisher identity, tagging, GitHub Release creation, and Marketplace upload remain explicit human-reviewed gates.

**Tech Stack:** TypeScript 6, VS Code Extension API, Vitest, Mocha extension-host tests, esbuild, `@vscode/vsce`, GitHub Actions, GitHub CLI, Visual Studio Marketplace publisher portal.

## Global Constraints

- Release exactly `1.0.0` as stable; never use `vsce --pre-release`.
- Declare `pricing: "Free"`.
- Remain desktop- and local-`file:`-only for `1.0.0`.
- Declare `extensionKind: ["ui"]`, support untrusted workspaces, and reject virtual workspaces.
- Collect no telemetry, make no runtime network requests, and store the registry only in VS Code local extension storage; audit these claims before publication.
- Keep `resources/routebox.svg` as the Activity Bar icon.
- Use a separate 256 by 256 PNG as the Marketplace icon.
- Make the repository public only at Task 5's explicit external-state checkpoint.
- Use GitHub Issues for support and private vulnerability reporting for security.
- Defer the permanent Marketplace publisher ID until Task 7; the user must supply the exact created ID.
- Add no PAT, Marketplace secret, Entra identity, or automated publishing.
- Add no Remote SSH, WSL, dev-container, virtual-workspace, or web-extension support.
- Preserve all existing commands, views, configuration keys, registry keys, and behavior.
- Use `npm ci` and commit `package-lock.json`.
- Apply test-first red/green verification to code and manifest behavior.

---

## Execution Preflight

This plan starts from `feat/marketplace-readiness` based on an up-to-date `main` containing the rebrand plus approved design and plan.

- [ ] **Step 1: Verify the current baseline**

```bash
git status --short --branch
git log --oneline --decorate -8
npm test
```

Expected: clean tracked tree and at least 14 passing test files with 192 passing tests.

- [ ] **Step 2: Integrate the current rebrand branch**

Invoke `superpowers:finishing-a-development-branch` and let the user choose local merge or pull request. Do not start Task 1 until:

```bash
git merge-base --is-ancestor "$(git log -1 --format=%H -- docs/superpowers/plans/2026-07-16-routebox-stable-marketplace-release.md)" main
```

Expected: exit code `0`.

- [ ] **Step 3: Create the implementation checkout**

Invoke `superpowers:using-git-worktrees` and create `feat/marketplace-readiness` from `main`. Expected: a clean named-branch worktree.

- [ ] **Step 4: Check Marketplace name availability before implementation**

Run:

```bash
npx vsce search routebox --json
```

Also search for `Routebox` in the Visual Studio Marketplace web UI. Expected: no existing extension has the exact case-insensitive package name `routebox` or display name `Routebox`. Search is a preliminary gate; the Marketplace upload remains authoritative. Stop and return to naming design if either exact name is occupied.

---

### Task 1: Marketplace Metadata, Reproducible Toolchain, and Listing Icon

**Files:**
- Create: `resources/routebox-marketplace.png`
- Create: `src/test/unit/marketplaceAssets.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/test/integration/extension.test.ts`

**Interfaces:**
- Consumes: manifest identity fields and `resources/routebox.svg`.
- Produces: a 256 by 256 Marketplace PNG, complete non-publisher listing metadata, deliberate tool versions, and tests that survive the final publisher change.

- [ ] **Step 1: Make integration lookup publisher-independent**

Add this helper to `src/test/integration/extension.test.ts` and replace both hard-coded `getExtension('nick.routebox')` calls with `routeboxExtension()`:

```ts
function routeboxExtension(): vscode.Extension<unknown> {
  const extension = vscode.extensions.all.find(candidate => (
    candidate.packageJSON.name === 'routebox'
      && candidate.packageJSON.displayName === 'Routebox'
  ));
  assert.ok(extension);
  assert.equal(extension.id, `${extension.packageJSON.publisher}.routebox`);
  return extension;
}
```

- [ ] **Step 2: Add failing manifest assertions**

In the workbench-surface integration test, define `manifest` and assert:

```ts
const manifest = extension.packageJSON as Record<string, unknown>;
assert.deepEqual(manifest.repository, {
  type: 'git',
  url: 'https://github.com/Nick2191/routebox.git',
});
assert.equal(manifest.homepage, 'https://github.com/Nick2191/routebox#readme');
assert.deepEqual(manifest.bugs, {
  url: 'https://github.com/Nick2191/routebox/issues',
});
assert.equal(manifest.pricing, 'Free');
assert.equal(manifest.icon, 'resources/routebox-marketplace.png');
assert.deepEqual(manifest.galleryBanner, {
  color: '#172033',
  theme: 'dark',
});
assert.deepEqual(manifest.categories, ['Other']);
assert.deepEqual(manifest.keywords, [
  'workspace',
  'switcher',
  'code-workspace',
  'project manager',
  'folder',
  'project switcher',
]);
```

Run `npm run test:integration`. Expected: fail because the new Marketplace fields are absent.

- [ ] **Step 3: Add the failing icon contract**

Create `src/test/unit/marketplaceAssets.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Marketplace assets', () => {
  it('provides a 256 by 256 PNG icon', () => {
    const png = readFileSync(resolve(process.cwd(), 'resources/routebox-marketplace.png'));

    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.readUInt32BE(16)).toBe(256);
    expect(png.readUInt32BE(20)).toBe(256);
  });
});
```

Run:

```bash
npm run test:unit -- src/test/unit/marketplaceAssets.test.ts
npm run compile:integration
```

Expected: the unit test fails with `ENOENT`; integration compilation succeeds.

- [ ] **Step 4: Add exact metadata and dependency ranges**

Add these top-level fields without changing `version`, `preview`, or `publisher`:

```json
"repository": {
  "type": "git",
  "url": "https://github.com/Nick2191/routebox.git"
},
"homepage": "https://github.com/Nick2191/routebox#readme",
"bugs": {
  "url": "https://github.com/Nick2191/routebox/issues"
},
"pricing": "Free",
"icon": "resources/routebox-marketplace.png",
"galleryBanner": {
  "color": "#172033",
  "theme": "dark"
},
```

Replace only `latest` dependency declarations with:

```json
"@eslint/js": "^10.0.1",
"@types/node": "^22.0.0",
"@vscode/vsce": "^3.9.2",
"esbuild": "^0.28.1",
"eslint": "^10.7.0",
"typescript": "^6.0.3",
"typescript-eslint": "^8.64.0",
"vitest": "^4.1.10",
"vscode-uri": "^3.1.0"
```

Set `@types/vscode` to exact `1.114.0` so compilation cannot use APIs above the engine floor. Preserve existing deliberate ranges for `@types/mocha`, `@vscode/test-cli`, and `@vscode/test-electron`.

```bash
npm install --package-lock-only
npm ci
npm ls --depth=0
```

Expected: installation succeeds without invalid dependencies.

- [ ] **Step 5: Generate and visually approve the icon**

Create `/tmp/routebox-marketplace-icon.svg` with this exact content:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="36" fill="#172033"/>
  <g fill="#ffffff">
    <path d="M224,68H153.33l-28.8-21.6a12.05,12.05,0,0,0-7.2-2.4H72A12,12,0,0,0,60,56V76H40A12,12,0,0,0,28,88V200a12,12,0,0,0,12,12H192.89A11.12,11.12,0,0,0,204,200.89V180h20.89A11.12,11.12,0,0,0,236,168.89V80A12,12,0,0,0,224,68ZM196,200.89a3.12,3.12,0,0,1-3.11,3.11H40a4,4,0,0,1-4-4V88a4,4,0,0,1,4-4H85.33a4,4,0,0,1,2.4.8l29.87,22.4a4,4,0,0,0,2.4.8h72a4,4,0,0,1,4,4Zm32-32a3.12,3.12,0,0,1-3.11,3.11H204V112a12,12,0,0,0-12-12H121.33L92.53,78.4a12.05,12.05,0,0,0-7.2-2.4H68V56a4,4,0,0,1,4-4h45.33a4,4,0,0,1,2.4.8L149.6,75.2a4,4,0,0,0,2.4.8h72a4,4,0,0,1,4,4Z"/>
  </g>
  <g fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M72 137h17c24 0 29 40 54 40h22m-14-14 14 14-14 14"/>
    <path d="M72 180h17c24 0 29-42 54-42h22m-14-14 14 14-14 14"/>
  </g>
</svg>
```

Rasterize:

```bash
mkdir -p /tmp/routebox-marketplace-icon
qlmanage -t -s 256 -o /tmp/routebox-marketplace-icon /tmp/routebox-marketplace-icon.svg
mv /tmp/routebox-marketplace-icon/routebox-marketplace-icon.svg.png resources/routebox-marketplace.png
```

Inspect the PNG with the image viewer. The user must approve its appearance at full size and 64 pixels. Do not modify `resources/routebox.svg`.

- [ ] **Step 6: Verify and commit**

```bash
npm run test:unit -- src/test/unit/marketplaceAssets.test.ts
npm test
npm run test:integration
npx vsce ls
git diff --check
git add package.json package-lock.json resources/routebox-marketplace.png src/test/unit/marketplaceAssets.test.ts src/test/integration/extension.test.ts
git commit -m "feat: add Routebox Marketplace metadata"
```

Expected: tests pass; package list contains both icons and emits no repository warning.

---

### Task 2: Explicit Runtime and Filesystem Boundary Contract

**Files:**
- Modify: `package.json`
- Modify: `src/test/integration/extension.test.ts`
- Modify: `src/test/unit/discovery.test.ts`

**Interfaces:**
- Consumes: `WorkspaceDiscoveryService.scan(rootUri: string)` and `FileKind`.
- Produces: exact capability declarations and regression evidence for symlink leaves and finite deep scans.

- [ ] **Step 1: Add failing capability assertions**

```ts
assert.deepEqual(manifest.extensionKind, ['ui']);
assert.deepEqual(manifest.capabilities, {
  untrustedWorkspaces: { supported: true },
  virtualWorkspaces: {
    supported: false,
    description: 'Routebox manages local workspace files and folders.',
  },
});
```

- [ ] **Step 2: Add discovery boundary tests**

Add `readonly reads: string[] = [];` to `FakeFileSystem` and push `uri` at the start of `readDirectory`. Add:

```ts
it('treats symbolic-link-like other entries as leaves', async () => {
  const fs = new FakeFileSystem();
  fs.directory('file:///root', [
    ['linked-directory', 'other'],
    ['visible.code-workspace', 'file'],
  ]);

  await expect(new WorkspaceDiscoveryService(fs).scan('file:///root')).resolves.toMatchObject({
    workspaceUris: ['file:///root/visible.code-workspace'],
    status: 'ok',
  });
  expect(fs.reads).toEqual(['file:///root']);
});

it('terminates a deep finite directory scan', async () => {
  const fs = new FakeFileSystem();
  let parent = 'file:///root';
  for (let depth = 0; depth < 200; depth += 1) {
    fs.directory(parent, [['next', 'directory']]);
    parent = `${parent}/next`;
  }
  fs.directory(parent, [['deep.code-workspace', 'file']]);

  const result = await new WorkspaceDiscoveryService(fs).scan('file:///root');

  expect(result.status).toBe('ok');
  expect(result.workspaceUris).toEqual([`${parent}/deep.code-workspace`]);
  expect(fs.reads).toHaveLength(201);
});
```

- [ ] **Step 3: Verify the manifest test is red**

```bash
npm run test:unit -- src/test/unit/discovery.test.ts
npm run test:integration
```

Expected: discovery tests pass; integration fails because capabilities are absent.

- [ ] **Step 4: Add exact declarations**

Add to top-level `package.json`:

```json
"extensionKind": ["ui"],
"capabilities": {
  "untrustedWorkspaces": {
    "supported": true
  },
  "virtualWorkspaces": {
    "supported": false,
    "description": "Routebox manages local workspace files and folders."
  }
},
```

Do not add runtime trust checks; Routebox executes no workspace code and VS Code owns trust handling when a selected project opens.

- [ ] **Step 5: Run boundary coverage and commit**

```bash
npm run test:unit -- src/test/unit/projectEntry.test.ts src/test/unit/projectRegistry.test.ts src/test/unit/commandHandlers.test.ts src/test/unit/discovery.test.ts src/test/unit/discoveryCoordinator.test.ts src/test/unit/vscodeFileSystem.test.ts
npm run test:integration
git diff --check
git add package.json src/test/integration/extension.test.ts src/test/unit/discovery.test.ts
git commit -m "test: define Routebox runtime boundaries"
```

Expected: existing non-local URI, corrupt registry, permission preservation, Windows/UNC, and symlink tests all remain green.

---

### Task 3: Marketplace README, Support, Security, and Screenshots

**Files:**
- Create: `SUPPORT.md`
- Create: `SECURITY.md`
- Create: `docs/images/routebox-sidebar.png`
- Create: `docs/images/routebox-quick-pick.png`
- Modify: `README.md`
- Modify: `.vscodeignore`

**Interfaces:**
- Consumes: public URLs from Task 1 and current UI.
- Produces: Marketplace listing content, GitHub reporting contracts, sanitized screenshots, and privacy disclosure.

- [ ] **Step 1: Create `SUPPORT.md`**

```md
# Routebox Support

Use [GitHub Issues](https://github.com/Nick2191/routebox/issues) for Routebox
questions, feature requests, and ordinary bug reports.

Before opening an issue, search for an existing report. For bugs, include:

- Routebox version.
- VS Code version and operating system.
- Whether the project is a folder or `.code-workspace` file.
- Whether it was added manually or discovered from a root.
- Reproduction steps and the exact visible error message.

Remove usernames, private repository names, tokens, and confidential filesystem
paths from screenshots and logs.

Do not report suspected security vulnerabilities in a public issue. Follow
[SECURITY.md](SECURITY.md) instead.
```

- [ ] **Step 2: Create `SECURITY.md`**

```md
# Routebox Security Policy

## Supported versions

Security fixes are provided for the latest Marketplace version of Routebox.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for
[Nick2191/routebox](https://github.com/Nick2191/routebox/security/advisories/new).
Do not include vulnerability details in a public issue.

Include the affected Routebox version, VS Code version, operating system,
reproduction steps, impact, and any suggested mitigation. Remove unrelated
private data from reports and attachments.
```

- [ ] **Step 3: Rewrite the README opening**

Use this exact opening, then retain and polish the existing detailed sections:

```md
# Routebox

Your local workspace switcher for VS Code.

Routebox keeps saved `.code-workspace` files and folders together in one native
sidebar. Open a project in the current window, launch it in a new window, or use
the Quick Pick when your hands are already on the keyboard.

![Routebox sidebar](docs/images/routebox-sidebar.png)

## Highlights

- Keep workspace files and folders in one project list.
- Discover `.code-workspace` files beneath selected local roots.
- Switch in the current window or open a separate VS Code window.
- Assign display aliases without renaming anything on disk.
- Exclude discovered workspaces and restore them later.
- Use only native VS Code views, Quick Picks, commands, and theme colors.

![Routebox Quick Pick](docs/images/routebox-quick-pick.png)
```

Add before `Limitations`:

```md
## Privacy and security

Routebox collects no telemetry and sends no network requests. Its project
registry is stored locally in VS Code extension storage and is not synchronized.

Routebox reads only the local folders, workspace files, and discovery roots you
select. Removing a project from Routebox never deletes, moves, or modifies the
underlying file or folder.

For help, see [SUPPORT.md](SUPPORT.md). Report suspected vulnerabilities through
the private process in [SECURITY.md](SECURITY.md).
```

State under `Limitations` that virtual workspaces, VS Code for the Web, and remote workspace management are unsupported.

- [ ] **Step 4: Capture sanitized screenshots**

Use neutral fixtures under `/tmp/routebox-marketplace-demo`. Capture:

- `docs/images/routebox-sidebar.png` with current, workspace, folder, and title actions.
- `docs/images/routebox-quick-pick.png` with workspace/folder icons and neutral paths.

Crop to the relevant UI at readable 2x density, inspect both images, and run:

```bash
rg -a -n -i 'nick|Users/|worktrees|fullmind|BOIS|token|email' docs/images || true
```

Expected: no private identifiers. User visually approves both screenshots.

- [ ] **Step 5: Define packaged docs and audit privacy**

Add `SECURITY.md` immediately after `docs/**` in `.vscodeignore`. Keep `SUPPORT.md` packaged.

```bash
rg -n -i 'fetch\(|https?://|createTelemetryLogger|telemetry|node:http|node:https|node:net|WebSocket' src package.json
npm ls --omit=dev --depth=all
npx vsce ls
npm test
```

Expected: no runtime network/telemetry code, no production dependencies, and package list includes README/SUPPORT/license/changelog/icons/bundle while excluding SECURITY/docs/source/tests.

- [ ] **Step 6: Commit**

```bash
git add README.md SUPPORT.md SECURITY.md docs/images .vscodeignore
git commit -m "docs: prepare Routebox Marketplace listing"
```

---

### Task 4: Minimum-Version and VSIX Gates in CI

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `engines.vscode = ^1.114.0` and `npm run vsix`.
- Produces: `test:integration:min`, VS Code `1.114.0` CI evidence, package-content checks, and a 1 MiB maximum.

- [ ] **Step 1: Add and run the minimum-version script**

Add:

```json
"test:integration:min": "npm run compile && npm run compile:integration && vscode-test --code-version 1.114.0"
```

```bash
npm run test:integration:min
```

Expected: VS Code `1.114.0` runs two passing extension-host tests. If Routebox actually requires a newer API, raise both `engines.vscode` and exact `@types/vscode` to the oldest passing Stable version and update the job; never skip the gate.

- [ ] **Step 2: Add `minimum-vscode` job**

```yaml
  minimum-vscode:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: xvfb-run -a npm run test:integration:min
```

Set package dependencies to:

```yaml
    needs: [verify, minimum-vscode]
```

- [ ] **Step 3: Replace the package command with inspected gates**

```yaml
      - name: Inspect package inputs
        shell: bash
        run: |
          npx vsce ls | tee /tmp/routebox-package-files.txt
          grep -Fx 'dist/extension.js' /tmp/routebox-package-files.txt
          grep -Fx 'resources/routebox.svg' /tmp/routebox-package-files.txt
          grep -Fx 'resources/routebox-marketplace.png' /tmp/routebox-package-files.txt
          grep -Fx 'README.md' /tmp/routebox-package-files.txt
          grep -Fx 'SUPPORT.md' /tmp/routebox-package-files.txt
          ! grep -E '(^|/)(src|docs|node_modules|\.vscode)/|\.code-workspace$|\.test\.' /tmp/routebox-package-files.txt
      - run: npm run vsix
      - name: Verify VSIX archive and size
        shell: bash
        run: |
          mapfile -t packages < <(find . -maxdepth 1 -name 'routebox-*.vsix' -type f)
          test "${#packages[@]}" -eq 1
          test "$(stat -c%s "${packages[0]}")" -lt 1048576
          unzip -Z1 "${packages[0]}" | tee /tmp/routebox-vsix-files.txt
          grep -F 'extension/resources/routebox-marketplace.png' /tmp/routebox-vsix-files.txt
          ! grep -E 'extension/(src|docs|node_modules|\.vscode)/|\.code-workspace$|\.test\.' /tmp/routebox-vsix-files.txt
```

- [ ] **Step 4: Verify and commit**

Move old ignored VSIX artifacts outside the checkout, then:

```bash
npm test
npm run test:integration
npm run test:integration:min
npm run vsix
npx vsce ls
git diff --check
git add package.json package-lock.json .github/workflows/ci.yml
git commit -m "ci: verify Routebox release packages"
git push -u origin feat/marketplace-readiness
```

Expected: local gates and all GitHub Actions jobs pass.

---

### Task 5: Public Repository and Reporting Channels

**Files:**
- No tracked changes.
- External: GitHub visibility, Issues, private vulnerability reporting, description, topics.

**Interfaces:**
- Consumes: passing Task 4 CI and committed support/security docs.
- Produces: publicly resolvable repository/Issues links and private vulnerability intake.

- [ ] **Step 1: Obtain explicit visibility confirmation**

Tell the user that public visibility exposes full commit history and existing Actions logs and that later re-privatization cannot guarantee removal of public copies. Stop until the user explicitly confirms the command.

- [ ] **Step 2: Audit history before exposure**

```bash
git grep -l -E 'ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY' $(git rev-list --all)
git grep -l -i -E 'token|password|secret|api[_-]?key'
git ls-files | rg -i '(^|/)(\.env|id_rsa|credentials|secrets?)($|\.)'
gh secret list --repo Nick2191/routebox
gh api repos/Nick2191/routebox/actions/artifacts --jq '.artifacts[] | [.name, .expired, .workflow_run.head_branch] | @tsv'
```

Expected: no credential material in tracked history. Review secret names and artifacts without printing secret values. Stop and remediate if anything sensitive is tracked.

- [ ] **Step 3: Change visibility and configure channels**

After confirmation:

```bash
gh repo edit Nick2191/routebox --visibility public --accept-visibility-change-consequences --enable-issues --description "A local workspace and folder switcher for Visual Studio Code." --add-topic vscode-extension --add-topic workspace --add-topic project-switcher
gh api --method PUT repos/Nick2191/routebox/private-vulnerability-reporting
```

- [ ] **Step 4: Verify**

```bash
gh repo view Nick2191/routebox --json nameWithOwner,visibility,url,hasIssuesEnabled,description,repositoryTopics
gh api repos/Nick2191/routebox/private-vulnerability-reporting
curl -I https://github.com/Nick2191/routebox
curl -I https://github.com/Nick2191/routebox/issues
```

Expected: `PUBLIC`, Issues enabled, exact description/topics, vulnerability reporting enabled, and public URLs resolve.

---

### Task 6: Stable `1.0.0` Release Candidate and Acceptance Record

**Files:**
- Create: `docs/releases/1.0.0.md`
- Create: `docs/release-checklists/1.0.0.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`
- Test: `src/test/integration/extension.test.ts`

**Interfaces:**
- Consumes: public repository and passing release gates.
- Produces: stable `1.0.0` candidate, release notes, checksum, and recorded automated/manual evidence.

- [ ] **Step 1: Add failing stable assertions**

```ts
assert.equal(manifest.version, '1.0.0');
assert.equal('preview' in manifest, false);
```

```bash
npm run test:integration
```

Expected: fail because manifest is `0.1.0` and preview.

- [ ] **Step 2: Promote to stable**

Set `version` to `1.0.0`, remove `preview`, and run:

```bash
npm install --package-lock-only
```

Do not change the provisional publisher.

- [ ] **Step 3: Finalize changelog and release notes**

Replace the development `Unreleased`/`0.1.0` split with `## 1.0.0 - ` followed by the release-candidate date returned by `date +%F`. First bullet:

```md
- Publish the first stable Routebox release for managing local VS Code workspace files and folders.
```

Preserve concise bullets for switching modes, sidebar/Quick Pick, discovery, aliases, folders, exclusions/restoration, stale cleanup, native theme behavior, local limitations, and no-delete safety.

Create `docs/releases/1.0.0.md`:

```md
# Routebox 1.0.0

Routebox is a local workspace and folder switcher for Visual Studio Code.

## Highlights

- Keep saved `.code-workspace` files and folders in one native sidebar.
- Switch in the current window or open a project in a new window.
- Use the combined project Quick Pick from the Command Palette.
- Discover workspace files under selected local roots.
- Assign aliases and safely remove, exclude, or restore projects without deleting files.

Routebox is free, collects no telemetry, and sends no network requests. See the
[README](https://github.com/Nick2191/routebox#readme) for usage and limitations.
```

- [ ] **Step 4: Build and install the candidate**

Move old VSIX files outside the checkout:

```bash
npm ci
npm test
npm run test:integration
npm run test:integration:min
npm run vsix
npx vsce ls
shasum -a 256 routebox-1.0.0.vsix
stat -f '%z bytes' routebox-1.0.0.vsix
code --user-data-dir /tmp/routebox-1.0.0-user --extensions-dir /tmp/routebox-1.0.0-extensions --install-extension routebox-1.0.0.vsix --force
code --user-data-dir /tmp/routebox-1.0.0-user --extensions-dir /tmp/routebox-1.0.0-extensions --list-extensions --show-versions
```

Expected: full tests pass; one sub-1-MiB VSIX; provisional publisher plus `.routebox@1.0.0` installs cleanly.

- [ ] **Step 5: Complete the manual checklist with the user**

Use neutral `/tmp/routebox-release-test` fixtures. Verify empty/folder/workspace windows, add workspace/folder, discovery lifecycle, current/new window, sidebar/Quick Pick, aliases, remove/exclude/restore, deleted/inaccessible paths, Restricted Mode, and sanitized screenshots.

Collect the evidence first:

```bash
git rev-parse HEAD
node --version
code --version
shasum -a 256 routebox-1.0.0.vsix
stat -f '%z' routebox-1.0.0.vsix
gh run list --branch feat/marketplace-readiness --workflow CI --limit 5 --json databaseId,url,headSha,status,conclusion
```

Create `docs/release-checklists/1.0.0.md` using the exact command outputs and CI URLs. Use these fixed headings and labels; never write descriptive stand-ins such as “tested commit SHA” or “passed run URL”:

```md
# Routebox 1.0.0 Release Checklist

## Build identity

- Commit:
- VSIX: `routebox-1.0.0.vsix`
- SHA-256:
- Size:
- Node.js:
- VS Code Stable:
- Minimum VS Code: `1.114.0`

## Automated evidence

- Windows GitHub Actions:
- macOS GitHub Actions:
- Linux GitHub Actions:
- VS Code 1.114.0 job:
- Unit, lint, types, integration, package-content, and size gates: passed

## Manual macOS evidence

- Clean-profile install: passed
- Empty, folder, and saved-workspace windows: passed
- Manual workspace and folder registration: passed
- Discovery add, refresh, watcher, and removal: passed
- Current-window and new-window opening: passed
- Sidebar and Quick Pick actions: passed
- Alias, remove, exclude, and restore: passed
- Deleted and inaccessible paths: passed
- Restricted Mode: passed
- Screenshots contain no private data: passed
- Representative Windows/UNC, macOS, and Linux path fixtures: passed

## Accepted limitations

- Local desktop `file:` workspace files and folders only.
- No VS Code for the Web or virtual workspace support.
- No Remote SSH, dev-container, or WSL-specific support guarantee.
```

Fill every blank value on the same line with exact captured evidence before commit. Stop and fix any failure test-first.

- [ ] **Step 6: Commit and push the candidate**

```bash
git add package.json package-lock.json CHANGELOG.md src/test/integration/extension.test.ts docs/releases/1.0.0.md docs/release-checklists/1.0.0.md
git commit -m "chore: prepare Routebox 1.0.0"
git push
```

Expected: branch CI passes. Do not tag or create a release.

---

### Task 7: Permanent Publisher and Manual Publication

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/release-checklists/1.0.0.md`
- External: Marketplace publisher/listing, Git tag, GitHub Release.

**Interfaces:**
- Consumes: exact immutable publisher ID supplied by the user after portal creation and passing Task 6 candidate.
- Produces: permanent `publisherId.routebox` identity, final VSIX, `v1.0.0` tag, GitHub Release, and live Marketplace listing.

- [ ] **Step 1: Pause for exact publisher ID**

Direct the user to https://marketplace.visualstudio.com/manage/publishers/. Do not infer the ID from its display name.

Record the exact user response. The next step validates and applies it in one shell operation.

- [ ] **Step 2: Apply permanent identity**

```bash
printf 'Exact Marketplace publisher ID: '
read -r PUBLISHER_ID
node -e "const id=process.argv[1]; if(!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(id)) process.exit(1)" "$PUBLISHER_ID"
npm pkg set publisher="$PUBLISHER_ID"
npm install --package-lock-only
node -e "const p=require('./package.json'); console.log(p.publisher + '.' + p.name + '@' + p.version)"
```

Expected: the exact supplied publisher plus `.routebox@1.0.0`.

- [ ] **Step 3: Rebuild and clean-install final VSIX**

After confirming the candidate checksum is recorded, move that ignored candidate artifact out of the checkout so the final package cannot be confused with it:

```bash
mv routebox-1.0.0.vsix /tmp/routebox-1.0.0-provisional.vsix
```

Then run:

```bash
PUBLISHER_ID="$(node -p "require('./package.json').publisher")"
npm ci
npm test
npm run test:integration
npm run test:integration:min
npm run vsix
code --user-data-dir /tmp/routebox-final-user --extensions-dir /tmp/routebox-final-extensions --install-extension routebox-1.0.0.vsix --force
code --user-data-dir /tmp/routebox-final-user --extensions-dir /tmp/routebox-final-extensions --list-extensions --show-versions
shasum -a 256 routebox-1.0.0.vsix
stat -f '%z bytes' routebox-1.0.0.vsix
```

Expected: all tests pass and the permanent `publisherId.routebox@1.0.0` installs. Update checklist identity/checksum/size.

- [ ] **Step 4: Commit, push, and wait for CI**

```bash
git add package.json package-lock.json docs/release-checklists/1.0.0.md
git commit -m "chore: finalize Routebox publisher identity"
git push
```

Expected: all jobs pass at this commit.

- [ ] **Step 5: Merge readiness branch**

Invoke `superpowers:finishing-a-development-branch`. After the user's merge choice completes:

```bash
git merge-base --is-ancestor feat/marketplace-readiness main
npm test
```

Expected: pass on current `main`.

- [ ] **Step 6: Rebuild from main, tag, and release**

```bash
git status --short --branch
npm ci
npm run test:all
npm run vsix
shasum -a 256 routebox-1.0.0.vsix
git tag -a v1.0.0 -m "Routebox 1.0.0"
git push origin v1.0.0
shasum -a 256 routebox-1.0.0.vsix > routebox-1.0.0.sha256
gh release create v1.0.0 routebox-1.0.0.vsix routebox-1.0.0.sha256 --title "Routebox 1.0.0" --notes-file docs/releases/1.0.0.md
```

Expected: clean tracked tree, passing suite, and public GitHub Release with exact VSIX/checksum.

- [ ] **Step 7: Upload the exact VSIX manually**

In the publisher portal choose **New extension → Visual Studio Code** and upload the exact GitHub Release `routebox-1.0.0.vsix`. Do not rebuild. Verify Free pricing, stable `1.0.0`, permanent publisher, icon, README, support, repository, and Issues links.

- [ ] **Step 8: Verify Marketplace installation**

```bash
PUBLISHER_ID="$(node -p "require('./package.json').publisher")"
code --user-data-dir /tmp/routebox-marketplace-user --extensions-dir /tmp/routebox-marketplace-extensions --install-extension "$PUBLISHER_ID.routebox" --force
code --user-data-dir /tmp/routebox-marketplace-user --extensions-dir /tmp/routebox-marketplace-extensions --list-extensions --show-versions
```

Expected: permanent `publisherId.routebox@1.0.0` installs from Marketplace. Manually verify Activity Bar, sidebar, screenshots, Quick Pick, repository, Issues, support, and security links.

- [ ] **Step 9: Record publication**

Append exact tag, GitHub Release URL, Marketplace identity/listing URL, install result, and final checksum to `docs/release-checklists/1.0.0.md`. Commit as:

```bash
git add docs/release-checklists/1.0.0.md
git commit -m "docs: record Routebox 1.0.0 publication"
git push origin main
```

---

## Final Verification

Invoke `superpowers:verification-before-completion` and freshly run:

```bash
git status --short --branch
npm ci
npm test
npm run test:integration
npm run test:integration:min
npx vsce ls
shasum -a 256 routebox-1.0.0.vsix
gh release view v1.0.0 --repo Nick2191/routebox
gh repo view Nick2191/routebox --json visibility,hasIssuesEnabled,url
```

Confirm the installed Marketplace identity and live listing separately. Request a final whole-change review with `superpowers:requesting-code-review` and fix every Critical and Important finding before completion.
