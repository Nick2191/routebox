# Workspace Atlas Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-platform VS Code desktop extension that locally registers and discovers `.code-workspace` files, automatically removes deleted entries, and opens them from a sidebar or Quick Pick in the current or a new window.

**Architecture:** Keep the registry, discovery, and reconciliation rules in pure TypeScript modules behind small storage and filesystem ports. Put VS Code-specific URI, filesystem, watcher, command, and tree-view code in adapters, then compose everything in `activate()`. Bundle the runtime with esbuild, run fast domain tests with Vitest, and run activation/contribution tests inside the official VS Code Extension Development Host.

**Tech Stack:** TypeScript in strict mode, VS Code Extension API `^1.114.0`, Node.js 22 for development, esbuild, ESLint, Vitest, `@vscode/test-cli`, `@vscode/test-electron`, Mocha, and `@vscode/vsce`.

## Global Constraints

- Project/package name is `workspace-atlas`; display name is `Workspace Atlas`.
- All command identifiers use the `workspaceAtlas.*` namespace.
- Registry entries and aliases use machine-local extension storage and are not registered for Settings Sync.
- Persist URI strings and manipulate paths through `vscode.Uri`; do not build platform paths with string concatenation.
- Support VS Code desktop on macOS, Windows, and Linux; browser and explicit remote-environment support are outside Stage 1.
- A normal selection reuses the current window; a secondary action opens a new window.
- Removing a registry entry never deletes its `.code-workspace` file.
- Recursive scans exclude `.git` and `node_modules`, and no home-directory scan is enabled by default.
- Ship no default keyboard shortcuts.
- Use test-driven development and commit after every task.

## File map

- `package.json` — extension manifest, commands, settings, views, menus, scripts, and Marketplace metadata.
- `src/extension.ts` — dependency composition, activation lifecycle, and disposal only.
- `src/domain/workspaceEntry.ts` — persisted entry types, labels, sorting, and validation.
- `src/domain/workspaceRegistry.ts` — registry persistence and mutations.
- `src/domain/discovery.ts` — recursive scan behavior through a filesystem port.
- `src/domain/reconciler.ts` — provenance merging and confirmed-deletion rules.
- `src/platform/vscodeFileSystem.ts` — `vscode.workspace.fs` adapter and URI helpers.
- `src/platform/discoveryCoordinator.ts` — configured/current roots, watchers, debouncing, and refresh orchestration.
- `src/platform/workspaceOpener.ts` — existence check and `vscode.openFolder` options.
- `src/ui/workspaceTreeProvider.ts` — native flat tree presentation.
- `src/ui/workspaceQuickPick.ts` — searchable selection model.
- `src/commands/registerCommands.ts` — command handlers and user prompts.
- `src/test/unit/` — pure Vitest tests.
- `src/test/integration/` — tests executed inside VS Code.
- `resources/workspace-atlas.svg` — Activity Bar view-container icon.
- `README.md`, `CHANGELOG.md`, `LICENSE` — Marketplace-facing documentation.
- `.github/workflows/ci.yml` — macOS, Windows, and Linux verification.

---

### Task 1: Extension foundation and workspace entry model

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `eslint.config.mjs`
- Create: `esbuild.mjs`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.vscodeignore`
- Create: `src/extension.ts`
- Create: `src/domain/workspaceEntry.ts`
- Test: `src/test/unit/workspaceEntry.test.ts`

**Interfaces:**
- Produces: `WorkspaceEntry`, `WorkspaceSourceId`, `workspaceLabel(entry)`, `sortWorkspaceEntries(entries, currentUri)`, and `isWorkspaceFileUri(uri)`.
- Consumes: no application interfaces.

- [ ] **Step 1: Create the manifest and toolchain files**

Use this initial `package.json` (the later manifest task adds contributed UI):

```json
{
  "name": "workspace-atlas",
  "displayName": "Workspace Atlas",
  "description": "Discover, organize, and switch between .code-workspace files.",
  "version": "0.1.0",
  "publisher": "nick",
  "license": "MIT",
  "engines": { "vscode": "^1.114.0" },
  "categories": ["Other"],
  "keywords": ["workspace", "switcher", "code-workspace", "project manager"],
  "main": "./dist/extension.js",
  "activationEvents": [],
  "scripts": {
    "check-types": "tsc --noEmit",
    "lint": "eslint src",
    "compile": "npm run check-types && node esbuild.mjs",
    "watch": "node esbuild.mjs --watch",
    "test:unit": "vitest run",
    "test": "npm run check-types && npm run lint && npm run test:unit",
    "package": "npm run test && node esbuild.mjs --production",
    "vscode:prepublish": "npm run package",
    "vsix": "npm run package && vsce package"
  },
  "devDependencies": {
    "@eslint/js": "latest",
    "@types/node": "latest",
    "@types/vscode": "^1.114.0",
    "@vscode/vsce": "latest",
    "esbuild": "latest",
    "eslint": "latest",
    "typescript": "latest",
    "typescript-eslint": "latest",
    "vitest": "latest"
  }
}
```

Use `tsconfig.json` with `strict`, `noUncheckedIndexedAccess`, and no emit:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noEmit": true,
    "types": ["node", "vscode", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "vitest.config.ts"]
}
```

Configure ESLint to apply TypeScript recommended type-checked rules, configure Vitest for `src/test/unit/**/*.test.ts`, and configure esbuild with entry point `src/extension.ts`, output `dist/extension.js`, CommonJS format, Node platform, and external module `vscode`. `.gitignore` must ignore `node_modules/`, `dist/`, `out/`, `.vscode-test/`, `*.vsix`, and coverage output. `.vscodeignore` must exclude source, tests, configs, and development artifacts while retaining `dist/`, `resources/`, README, changelog, and license.

Use these exact tool configurations:

```js
// eslint.config.mjs
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['src/**/*.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: { '@typescript-eslint/explicit-function-return-type': 'error' },
  },
  { ignores: ['dist/', 'out/', 'node_modules/'] },
);
```

```js
// esbuild.mjs
import * as esbuild from 'esbuild';
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const context = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: 'node',
  target: 'node22',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  logLevel: 'info',
});
if (watch) await context.watch();
else { await context.rebuild(); await context.dispose(); }
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['src/test/unit/**/*.test.ts'], coverage: { reporter: ['text', 'html'] } },
});
```

```gitignore
node_modules/
dist/
out/
.vscode-test/
coverage/
*.vsix
```

```text
# .vscodeignore
.github/**
.vscode/**
src/**
node_modules/**
out/**
coverage/**
docs/**
*.config.*
esbuild.mjs
tsconfig*.json
```

- [ ] **Step 2: Install dependencies and generate the lockfile**

Run: `npm install`

Expected: exit 0 and a new `package-lock.json` using lockfile version 3.

- [ ] **Step 3: Write failing workspace-entry tests**

Create `src/test/unit/workspaceEntry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  isWorkspaceFileUri,
  sortWorkspaceEntries,
  workspaceLabel,
  type WorkspaceEntry,
} from '../../domain/workspaceEntry.js';

const entry = (uri: string, alias?: string): WorkspaceEntry => ({
  id: uri,
  uri,
  alias,
  manuallyRegistered: false,
  discoveredFrom: [],
});

describe('workspace entries', () => {
  it('uses an alias before the workspace filename', () => {
    expect(workspaceLabel(entry('file:///work/bois.code-workspace', 'BOIS'))).toBe('BOIS');
    expect(workspaceLabel(entry('file:///work/bois.code-workspace'))).toBe('bois');
  });

  it('accepts only code-workspace URIs case-insensitively', () => {
    expect(isWorkspaceFileUri('file:///work/a.code-workspace')).toBe(true);
    expect(isWorkspaceFileUri('file:///work/a.CODE-WORKSPACE')).toBe(true);
    expect(isWorkspaceFileUri('file:///work/a.json')).toBe(false);
  });

  it('places the current workspace first then sorts by effective label', () => {
    const values = [
      entry('file:///work/z.code-workspace'),
      entry('file:///work/a.code-workspace'),
      entry('file:///work/m.code-workspace', 'Beta'),
    ];
    expect(sortWorkspaceEntries(values, values[0]!.uri).map(workspaceLabel)).toEqual([
      'z',
      'a',
      'Beta',
    ]);
  });
});
```

- [ ] **Step 4: Run the unit test and verify failure**

Run: `npm run test:unit -- src/test/unit/workspaceEntry.test.ts`

Expected: FAIL because `src/domain/workspaceEntry.ts` does not exist.

- [ ] **Step 5: Implement the workspace entry model**

Create `src/domain/workspaceEntry.ts`:

```ts
export type WorkspaceSourceId = `configured:${string}` | `current:${string}`;

export interface WorkspaceEntry {
  id: string;
  uri: string;
  alias?: string;
  manuallyRegistered: boolean;
  discoveredFrom: WorkspaceSourceId[];
  lastOpenedAt?: number;
}

export function isWorkspaceFileUri(uri: string): boolean {
  return uri.toLowerCase().endsWith('.code-workspace');
}

export function workspaceLabel(entry: WorkspaceEntry): string {
  if (entry.alias?.trim()) return entry.alias.trim();
  const pathname = new URL(entry.uri).pathname;
  const filename = decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1));
  return filename.replace(/\.code-workspace$/i, '');
}

export function sortWorkspaceEntries(
  entries: readonly WorkspaceEntry[],
  currentUri?: string,
): WorkspaceEntry[] {
  return [...entries].sort((left, right) => {
    if (left.uri === currentUri) return right.uri === currentUri ? 0 : -1;
    if (right.uri === currentUri) return 1;
    return workspaceLabel(left).localeCompare(workspaceLabel(right), undefined, {
      sensitivity: 'base',
      numeric: true,
    });
  });
}
```

Create `src/extension.ts` with empty lifecycle exports so the bundle is runnable:

```ts
import type { ExtensionContext } from 'vscode';

export function activate(_context: ExtensionContext): void {}
export function deactivate(): void {}
```

- [ ] **Step 6: Verify the foundation**

Run: `npm run test:unit -- src/test/unit/workspaceEntry.test.ts`

Expected: 3 tests PASS.

Run: `npm run compile`

Expected: exit 0 and `dist/extension.js` exists.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json eslint.config.mjs esbuild.mjs vitest.config.ts .gitignore .vscodeignore src
git commit -m "chore: scaffold Workspace Atlas extension"
```

---

### Task 2: Machine-local workspace registry

**Files:**
- Create: `src/domain/workspaceRegistry.ts`
- Test: `src/test/unit/workspaceRegistry.test.ts`

**Interfaces:**
- Consumes: `WorkspaceEntry` from Task 1.
- Produces: `RegistryStorage.read()`, `RegistryStorage.write(entries)`, and `WorkspaceRegistry` methods `load`, `list`, `get`, `upsertManual`, `setAlias`, `resetAlias`, `removeManual`, `replace`, and `markOpened`.

- [ ] **Step 1: Write failing persistence and mutation tests**

Create an in-memory `RegistryStorage` in `src/test/unit/workspaceRegistry.test.ts` and assert:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceRegistry, type RegistryStorage } from '../../domain/workspaceRegistry.js';

class MemoryStorage implements RegistryStorage {
  value: unknown;
  async read(): Promise<unknown> { return this.value; }
  async write(entries: unknown): Promise<void> { this.value = entries; }
}

describe('WorkspaceRegistry', () => {
  let storage: MemoryStorage;
  let registry: WorkspaceRegistry;

  beforeEach(async () => {
    storage = new MemoryStorage();
    registry = new WorkspaceRegistry(storage);
    await registry.load();
  });

  it('persists one canonical entry for duplicate manual registration', async () => {
    await registry.upsertManual('file:///work/a.code-workspace');
    await registry.upsertManual('file:///work/a.code-workspace');
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]!.manuallyRegistered).toBe(true);
  });

  it('sets and resets aliases without changing the URI', async () => {
    const saved = await registry.upsertManual('file:///work/a.code-workspace');
    await registry.setAlias(saved.id, 'Alpha');
    expect(registry.get(saved.id)?.alias).toBe('Alpha');
    await registry.resetAlias(saved.id);
    expect(registry.get(saved.id)?.alias).toBeUndefined();
  });

  it('keeps a discovered entry when manual registration is removed', async () => {
    const saved = await registry.upsertManual('file:///work/a.code-workspace');
    await registry.replace([{ ...saved, discoveredFrom: ['configured:file:///work'] }]);
    await registry.removeManual(saved.id);
    expect(registry.get(saved.id)?.manuallyRegistered).toBe(false);
  });

  it('drops invalid persisted records but loads valid ones', async () => {
    storage.value = [
      { id: 'file:///a.code-workspace', uri: 'file:///a.code-workspace', manuallyRegistered: true, discoveredFrom: [] },
      { broken: true },
    ];
    registry = new WorkspaceRegistry(storage);
    const report = await registry.load();
    expect(registry.list()).toHaveLength(1);
    expect(report).toEqual({ discarded: 1, reset: false });
  });

  it('reports an unusable top-level stored value', async () => {
    storage.value = { broken: true };
    registry = new WorkspaceRegistry(storage);
    expect(await registry.load()).toEqual({ discarded: 0, reset: true });
    expect(registry.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the registry tests and verify failure**

Run: `npm run test:unit -- src/test/unit/workspaceRegistry.test.ts`

Expected: FAIL because `WorkspaceRegistry` is not defined.

- [ ] **Step 3: Implement registry storage and mutations**

Implement `src/domain/workspaceRegistry.ts` with this public surface and validation:

```ts
import { isWorkspaceFileUri, type WorkspaceEntry } from './workspaceEntry.js';

export interface RegistryStorage {
  read(): Promise<unknown>;
  write(entries: readonly WorkspaceEntry[]): Promise<void>;
}

function isEntry(value: unknown): value is WorkspaceEntry {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<WorkspaceEntry>;
  return typeof item.id === 'string'
    && typeof item.uri === 'string'
    && isWorkspaceFileUri(item.uri)
    && typeof item.manuallyRegistered === 'boolean'
    && Array.isArray(item.discoveredFrom)
    && item.discoveredFrom.every(source => typeof source === 'string');
}

export class WorkspaceRegistry {
  private entries = new Map<string, WorkspaceEntry>();

  constructor(private readonly storage: RegistryStorage) {}

  async load(): Promise<{ discarded: number; reset: boolean }> {
    const stored = await this.storage.read();
    const values = Array.isArray(stored) ? stored : [];
    const valid = values.filter(isEntry);
    this.entries = new Map(valid.map(entry => [entry.id, { ...entry }]));
    return {
      discarded: values.length - valid.length,
      reset: stored !== undefined && !Array.isArray(stored),
    };
  }

  list(): WorkspaceEntry[] { return [...this.entries.values()].map(entry => ({ ...entry })); }
  get(id: string): WorkspaceEntry | undefined {
    const entry = this.entries.get(id);
    return entry ? { ...entry } : undefined;
  }

  async upsertManual(uri: string): Promise<WorkspaceEntry> {
    if (!isWorkspaceFileUri(uri)) throw new Error('Select a .code-workspace file.');
    const existing = this.entries.get(uri);
    const entry: WorkspaceEntry = existing
      ? { ...existing, manuallyRegistered: true }
      : { id: uri, uri, manuallyRegistered: true, discoveredFrom: [] };
    this.entries.set(entry.id, entry);
    await this.persist();
    return { ...entry };
  }

  async setAlias(id: string, alias: string): Promise<void> {
    const entry = this.require(id);
    const clean = alias.trim();
    this.entries.set(id, { ...entry, alias: clean || undefined });
    await this.persist();
  }

  async resetAlias(id: string): Promise<void> { await this.setAlias(id, ''); }

  async removeManual(id: string): Promise<void> {
    const entry = this.require(id);
    if (entry.discoveredFrom.length === 0) this.entries.delete(id);
    else this.entries.set(id, { ...entry, manuallyRegistered: false });
    await this.persist();
  }

  async replace(entries: readonly WorkspaceEntry[]): Promise<void> {
    this.entries = new Map(entries.map(entry => [entry.id, { ...entry }]));
    await this.persist();
  }

  async markOpened(id: string, at: number): Promise<void> {
    const entry = this.require(id);
    this.entries.set(id, { ...entry, lastOpenedAt: at });
    await this.persist();
  }

  private require(id: string): WorkspaceEntry {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('Workspace is no longer registered.');
    return entry;
  }

  private async persist(): Promise<void> { await this.storage.write(this.list()); }
}
```

- [ ] **Step 4: Run tests and commit**

Run: `npm run test:unit -- src/test/unit/workspaceRegistry.test.ts`

Expected: 5 tests PASS.

```bash
git add src/domain/workspaceRegistry.ts src/test/unit/workspaceRegistry.test.ts
git commit -m "feat: add local workspace registry"
```

---

### Task 3: Recursive workspace discovery

**Files:**
- Create: `src/domain/discovery.ts`
- Test: `src/test/unit/discovery.test.ts`

**Interfaces:**
- Produces: `FileSystemPort`, `FileKind`, `DiscoveryResult`, and `WorkspaceDiscoveryService.scan(rootUri)`.
- Consumes: `isWorkspaceFileUri` from Task 1.

- [ ] **Step 1: Write failing discovery tests**

Build a fake filesystem tree and cover recursive matches, `.git`/`node_modules` exclusions, deduplication, and inaccessible roots:

```ts
it('finds nested workspace files and skips excluded directories', async () => {
  fs.directory('file:///root', [
    ['one', 'directory'], ['node_modules', 'directory'], ['README.md', 'file'],
  ]);
  fs.directory('file:///root/one', [['one.code-workspace', 'file']]);
  fs.directory('file:///root/node_modules', [['hidden.code-workspace', 'file']]);
  await expect(service.scan('file:///root')).resolves.toEqual({
    rootUri: 'file:///root',
    workspaceUris: ['file:///root/one/one.code-workspace'],
    status: 'ok',
  });
});

it('reports an inaccessible root without claiming an empty successful scan', async () => {
  fs.fail('file:///root');
  expect((await service.scan('file:///root')).status).toBe('error');
});
```

- [ ] **Step 2: Run the discovery tests and verify failure**

Run: `npm run test:unit -- src/test/unit/discovery.test.ts`

Expected: FAIL because `WorkspaceDiscoveryService` is not defined.

- [ ] **Step 3: Implement recursive discovery through a port**

Create `src/domain/discovery.ts`:

```ts
import { isWorkspaceFileUri } from './workspaceEntry.js';

export type FileKind = 'file' | 'directory' | 'other';

export interface FileSystemPort {
  readDirectory(uri: string): Promise<readonly [name: string, kind: FileKind][]>;
  joinPath(baseUri: string, ...segments: string[]): string;
  canonicalize(uri: string): string;
  exists(uri: string): Promise<boolean>;
  parent(uri: string): string;
}

export interface DiscoveryResult {
  rootUri: string;
  workspaceUris: string[];
  status: 'ok' | 'error';
  error?: string;
}

export class WorkspaceDiscoveryService {
  private readonly excluded = new Set(['.git', 'node_modules']);
  constructor(private readonly fs: FileSystemPort) {}

  async scan(rootUri: string): Promise<DiscoveryResult> {
    const found = new Set<string>();
    try {
      await this.walk(rootUri, found);
      return { rootUri, workspaceUris: [...found].sort(), status: 'ok' };
    } catch (error) {
      return {
        rootUri,
        workspaceUris: [],
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async walk(uri: string, found: Set<string>): Promise<void> {
    for (const [name, kind] of await this.fs.readDirectory(uri)) {
      const child = this.fs.joinPath(uri, name);
      if (kind === 'directory' && !this.excluded.has(name)) await this.walk(child, found);
      if (kind === 'file' && isWorkspaceFileUri(child)) found.add(child);
    }
  }
}
```

- [ ] **Step 4: Verify and commit**

Run: `npm run test:unit -- src/test/unit/discovery.test.ts`

Expected: all discovery tests PASS.

```bash
git add src/domain/discovery.ts src/test/unit/discovery.test.ts
git commit -m "feat: discover workspace files recursively"
```

---

### Task 4: Provenance reconciliation and stale cleanup

**Files:**
- Create: `src/domain/reconciler.ts`
- Test: `src/test/unit/reconciler.test.ts`

**Interfaces:**
- Consumes: `WorkspaceRegistry`, `WorkspaceEntry`, `WorkspaceSourceId`, `FileSystemPort`, and `DiscoveryResult`.
- Produces: `WorkspaceReconciler.reconcileSource(sourceId, result)`, `retireSource(sourceId)`, and `removeMissing()` returning `{ removed: number }`.

- [ ] **Step 1: Write failing reconciliation tests**

Cover additive provenance, scan-error retention, retired transient sources, manual preservation, and confirmed deletion:

```ts
it('merges discoveries without losing manual metadata', async () => {
  const manual = await registry.upsertManual('file:///root/a.code-workspace');
  await registry.setAlias(manual.id, 'Alpha');
  await reconciler.reconcileSource('configured:file:///root', {
    rootUri: 'file:///root', status: 'ok', workspaceUris: [manual.uri],
  });
  expect(registry.get(manual.id)).toMatchObject({
    alias: 'Alpha', manuallyRegistered: true,
    discoveredFrom: ['configured:file:///root'],
  });
});

it('retains entries when a scan fails', async () => {
  await reconciler.reconcileSource('configured:file:///root', {
    rootUri: 'file:///root', status: 'error', workspaceUris: [], error: 'denied',
  });
  expect(registry.list()).toHaveLength(1);
});

it('removes a confirmed missing file even when manually registered', async () => {
  fs.setExists('file:///root/a.code-workspace', false);
  expect(await reconciler.removeMissing()).toEqual({ removed: 1 });
  expect(registry.list()).toEqual([]);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:unit -- src/test/unit/reconciler.test.ts`

Expected: FAIL because `WorkspaceReconciler` is not defined.

- [ ] **Step 3: Implement reconciliation rules**

Implement `src/domain/reconciler.ts` so a successful source scan replaces only that source's provenance, an error changes nothing, and removal requires `exists(uri) === false`:

```ts
import type { DiscoveryResult, FileSystemPort } from './discovery.js';
import type { WorkspaceEntry, WorkspaceSourceId } from './workspaceEntry.js';
import type { WorkspaceRegistry } from './workspaceRegistry.js';

export class WorkspaceReconciler {
  constructor(
    private readonly registry: WorkspaceRegistry,
    private readonly fs: FileSystemPort,
  ) {}

  async reconcileSource(source: WorkspaceSourceId, result: DiscoveryResult): Promise<void> {
    if (result.status === 'error') return;
    const discovered = new Set(result.workspaceUris);
    const next = new Map(this.registry.list().map(entry => [entry.id, entry]));

    for (const entry of next.values()) {
      const sources = entry.discoveredFrom.filter(value => value !== source);
      if (discovered.has(entry.uri)) sources.push(source);
      entry.discoveredFrom = [...new Set(sources)];
      if (!entry.manuallyRegistered && entry.discoveredFrom.length === 0) next.delete(entry.id);
    }

    for (const uri of discovered) {
      const existing = next.get(uri);
      if (existing) continue;
      next.set(uri, {
        id: uri,
        uri,
        manuallyRegistered: false,
        discoveredFrom: [source],
      });
    }
    await this.registry.replace([...next.values()]);
  }

  async retireSource(source: WorkspaceSourceId): Promise<void> {
    const next = this.registry.list()
      .map(entry => ({ ...entry, discoveredFrom: entry.discoveredFrom.filter(value => value !== source) }))
      .filter(entry => entry.manuallyRegistered || entry.discoveredFrom.length > 0);
    await this.registry.replace(next);
  }

  async removeMissing(): Promise<{ removed: number }> {
    const current = this.registry.list();
    const checks = await Promise.all(current.map(async entry => [entry, await this.fs.exists(entry.uri)] as const));
    const retained: WorkspaceEntry[] = checks.filter(([, exists]) => exists).map(([entry]) => entry);
    await this.registry.replace(retained);
    return { removed: current.length - retained.length };
  }
}
```

- [ ] **Step 4: Verify and commit**

Run: `npm run test:unit -- src/test/unit/reconciler.test.ts`

Expected: all reconciliation tests PASS.

```bash
git add src/domain/reconciler.ts src/test/unit/reconciler.test.ts
git commit -m "feat: reconcile workspace provenance"
```

---

### Task 5: VS Code filesystem, storage, and discovery coordinator

**Files:**
- Create: `src/platform/vscodeFileSystem.ts`
- Create: `src/platform/vscodeRegistryStorage.ts`
- Create: `src/platform/discoveryCoordinator.ts`
- Test: `src/test/unit/discoveryCoordinator.test.ts`
- Test: `src/test/unit/vscodeFileSystem.test.ts`

**Interfaces:**
- Consumes: domain ports and services from Tasks 2–4.
- Produces: `VscodeFileSystem`, `VscodeRegistryStorage`, `DiscoveryCoordinator.refresh(reason)`, `updateWatchers()`, and `dispose()`.

- [ ] **Step 1: Write coordinator tests with fake roots and watchers**

The tests must assert that:

```ts
it('scans every configured root plus the current surrounding root', async () => {
  settings.roots = ['file:///configured'];
  current.workspaceFile = 'file:///worktrees/BOIS-1/bois.code-workspace';
  await coordinator.refresh('manual');
  expect(discovery.scanned).toEqual(['file:///configured', 'file:///worktrees']);
});

it('retires the previous transient current source after a workspace change', async () => {
  current.workspaceFile = 'file:///old/A/a.code-workspace';
  await coordinator.refresh('activation');
  current.workspaceFile = 'file:///new/B/b.code-workspace';
  await coordinator.refresh('workspace-change');
  expect(reconciler.retired).toContain('current:file:///old');
});

it('retires transient current sources restored from a previous session', async () => {
  registry.seedDiscoveredSource('current:file:///stale');
  current.workspaceFile = undefined;
  await coordinator.refresh('activation');
  expect(reconciler.retired).toContain('current:file:///stale');
});

it('debounces watcher bursts into one refresh', async () => {
  watcher.fireCreate('file:///configured/a.code-workspace');
  watcher.fireDelete('file:///configured/b.code-workspace');
  await timers.advanceTimersByTimeAsync(250);
  expect(discovery.scanCount).toBe(1);
});
```

- [ ] **Step 2: Run coordinator tests and verify failure**

Run: `npm run test:unit -- src/test/unit/discoveryCoordinator.test.ts`

Expected: FAIL because the coordinator does not exist.

- [ ] **Step 3: Implement VS Code adapters**

`VscodeRegistryStorage` wraps one `ExtensionContext.globalState` key named `workspaceAtlas.registry.v1`; call `globalState.get` and `globalState.update`, but never `setKeysForSync`.

`VscodeFileSystem` maps `FileType.File` and `FileType.Directory`, uses `Uri.joinPath`, and implements `exists` by calling `workspace.fs.stat`: return `false` only for `FileSystemError.FileNotFound`; rethrow other errors so inaccessible storage is not treated as deletion. Implement `parent` with URI path segments, preserving scheme and authority. Implement `canonicalize` by parsing with `Uri.parse`, normalizing dot segments, lowercasing a Windows drive letter, and serializing with `toString(true)`. Call it for every URI entering the registry from dialogs or discovery, and add adapter tests for spaces, dot segments, and Windows drive-letter casing.

- [ ] **Step 4: Implement the discovery coordinator**

The coordinator must:

```ts
export type RefreshReason = 'activation' | 'view-visible' | 'manual' | 'settings-change' | 'watcher' | 'workspace-change';

export interface DiscoverySettings {
  configuredRoots(): readonly string[];
}

export interface CurrentWorkspace {
  workspaceFileUri(): string | undefined;
}
```

For each configured root, scan with source ID ``configured:${root}``. For an active workspace file, compute `containing = fs.parent(workspaceFile)` and `surrounding = fs.parent(containing)`, then scan with source ID ``current:${surrounding}``. Before that scan, collect all persisted `current:` sources from registry entries and retire every one except the newly calculated source; this also cleans transient provenance left by a previous VS Code session. If there is no saved current workspace file, retire all persisted `current:` sources. Run `removeMissing()` after successful scan reconciliation. Serialize refresh promises so an older scan cannot overwrite newer registry state.

Track the previous configured-source set. When settings remove a root, call `retireSource` for that root before scanning the remaining roots; entries with manual or other discovery provenance remain.

Create `FileSystemWatcher` instances with `new RelativePattern(Uri.parse(root), '**/*.code-workspace')`; listen to create and delete events, debounce by 250 ms, and rebuild watchers when roots or the current surrounding directory change. Dispose replaced watchers and all event subscriptions.

For a manual refresh, return `{ removed, errors }` so the command layer can show one cleanup summary and one actionable scan warning.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:unit -- src/test/unit/discoveryCoordinator.test.ts`

Expected: coordinator tests PASS.

Run: `npm test`

Expected: all unit tests, type checks, and lint checks PASS.

```bash
git add src/platform src/test/unit/discoveryCoordinator.test.ts
git commit -m "feat: coordinate workspace discovery"
```

---

### Task 6: Workspace opening and searchable Quick Picks

**Files:**
- Create: `src/platform/workspaceOpener.ts`
- Create: `src/ui/workspaceQuickPick.ts`
- Test: `src/test/unit/workspaceOpener.test.ts`
- Test: `src/test/unit/workspaceQuickPick.test.ts`

**Interfaces:**
- Consumes: `WorkspaceRegistry`, `FileSystemPort`, `WorkspaceEntry`, `workspaceLabel`, and `sortWorkspaceEntries`.
- Produces: `WorkspaceOpener.open(id, mode)`, `OpenMode = 'reuse' | 'new'`, and `buildWorkspaceQuickPickItems(entries, currentUri)`.

- [ ] **Step 1: Write failing opener tests**

Use a fake command executor and clock:

```ts
it('uses forceReuseWindow for the primary action', async () => {
  await opener.open(entry.id, 'reuse');
  expect(commands.calls).toEqual([['vscode.openFolder', entry.uri, { forceReuseWindow: true }]]);
});

it('uses forceNewWindow for the alternate action', async () => {
  await opener.open(entry.id, 'new');
  expect(commands.calls[0]).toEqual(['vscode.openFolder', entry.uri, { forceNewWindow: true }]);
});

it('removes a missing entry before returning a missing result', async () => {
  fs.setExists(entry.uri, false);
  expect(await opener.open(entry.id, 'reuse')).toEqual({ status: 'missing' });
  expect(registry.get(entry.id)).toBeUndefined();
});
```

- [ ] **Step 2: Write failing Quick Pick model tests**

Assert the item shape contains label, filename description, path detail, current indicator, and the original entry:

```ts
expect(buildWorkspaceQuickPickItems([entry], entry.uri)[0]).toMatchObject({
  label: '$(circle-filled) Alpha',
  description: 'a.code-workspace · Current',
  detail: '/work/a.code-workspace',
  entry,
});
```

- [ ] **Step 3: Run both test files and verify failure**

Run: `npm run test:unit -- src/test/unit/workspaceOpener.test.ts src/test/unit/workspaceQuickPick.test.ts`

Expected: FAIL because opener and Quick Pick modules do not exist.

- [ ] **Step 4: Implement opener and Quick Pick model**

Define the opener ports explicitly:

```ts
export interface CommandExecutor {
  execute(command: string, ...args: unknown[]): Promise<unknown>;
}

export interface Clock { now(): number; }
export type OpenMode = 'reuse' | 'new';
export type OpenResult = { status: 'opened' } | { status: 'missing' };
```

`WorkspaceOpener.open` looks up the entry, checks existence, removes the whole entry with `registry.replace` when confirmed missing, executes `vscode.openFolder` with exactly one force option, then calls `markOpened(id, clock.now())`. Let command failures propagate without removing the existing entry.

`buildWorkspaceQuickPickItems` returns plain objects compatible with `QuickPickItem`, ordered through `sortWorkspaceEntries`. Use `Uri.parse(entry.uri).fsPath` only in the VS Code-facing mapping layer for the displayed native path.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:unit -- src/test/unit/workspaceOpener.test.ts src/test/unit/workspaceQuickPick.test.ts`

Expected: opener and Quick Pick tests PASS.

```bash
git add src/platform/workspaceOpener.ts src/ui/workspaceQuickPick.ts src/test/unit/workspaceOpener.test.ts src/test/unit/workspaceQuickPick.test.ts
git commit -m "feat: open workspaces from searchable picks"
```

---

### Task 7: Sidebar tree and complete command surface

**Files:**
- Create: `src/ui/workspaceTreeProvider.ts`
- Create: `src/commands/registerCommands.ts`
- Test: `src/test/unit/commandHandlers.test.ts`
- Test: `src/test/unit/workspaceTreeProvider.test.ts`

**Interfaces:**
- Consumes: registry, coordinator, opener, label/sort helpers, and VS Code window/workspace APIs.
- Produces: `WorkspaceTreeProvider.refresh()`, `onDidChangeTreeData`, and `registerWorkspaceCommands(dependencies)` returning disposables.

- [ ] **Step 1: Write failing command-handler tests against a UI port**

Extract prompts behind this interface so command behavior is unit-testable:

```ts
export interface WorkspaceUi {
  pickWorkspaceFiles(): Promise<readonly string[]>;
  pickDiscoveryRoot(): Promise<string | undefined>;
  pickDiscoveryRootToRemove(roots: readonly string[]): Promise<string | undefined>;
  pickWorkspace(entries: readonly WorkspaceEntry[], currentUri?: string): Promise<WorkspaceEntry | undefined>;
  inputAlias(entry: WorkspaceEntry): Promise<string | undefined>;
  showInfo(message: string): Promise<void>;
  showWarning(message: string): Promise<void>;
  showError(message: string): Promise<void>;
  revealFile(uri: string): Promise<void>;
}
```

Tests must verify multi-file add rejects non-workspace files, switch uses `reuse`, alternate switch uses `new`, rename persists a trimmed alias, reset clears it, refresh aggregates deleted counts using `Removed 2 missing workspaces.`, scan warnings appear only for manual refreshes, removing a discovery root updates settings then refreshes provenance, open failures use `showError`, and Remove Workspace clears only manual registration.

- [ ] **Step 2: Run command tests and verify failure**

Run: `npm run test:unit -- src/test/unit/commandHandlers.test.ts`

Expected: FAIL because command handlers do not exist.

- [ ] **Step 3: Implement command handlers and VS Code prompts**

Register these exact IDs:

```ts
const commandIds = {
  switchWorkspace: 'workspaceAtlas.switchWorkspace',
  openNewWindow: 'workspaceAtlas.openWorkspaceInNewWindow',
  addWorkspace: 'workspaceAtlas.addWorkspace',
  addDiscoveryRoot: 'workspaceAtlas.addDiscoveryRoot',
  removeDiscoveryRoot: 'workspaceAtlas.removeDiscoveryRoot',
  refresh: 'workspaceAtlas.refreshWorkspaces',
  rename: 'workspaceAtlas.renameWorkspace',
  resetName: 'workspaceAtlas.resetWorkspaceName',
  remove: 'workspaceAtlas.removeWorkspace',
  reveal: 'workspaceAtlas.revealWorkspaceFile',
} as const;
```

Use `showOpenDialog({ canSelectMany: true, filters: { 'VS Code Workspaces': ['code-workspace'] } })` for manual files and a folder-only dialog for roots. Store configured root URI strings through `workspace.getConfiguration('workspaceAtlas').update('discoveryRoots', roots, ConfigurationTarget.Global)`.

Convert dialog results with `fs.canonicalize(uri.toString(true))` before registry or settings writes. Reject any manual selection for which `isWorkspaceFileUri` is false with `Select a .code-workspace file.`

After every registry-changing command, call the tree provider's `refresh`. `Remove Workspace` calls only `removeManual`; it never invokes filesystem deletion.

For Remove Discovery Root, show the configured roots in a Quick Pick, remove exactly the selected URI from `workspaceAtlas.discoveryRoots`, persist the new array, and call `coordinator.refresh('settings-change')`. Catch opening failures at the command boundary and pass the error message to `showError` without changing the entry.

- [ ] **Step 4: Implement the flat tree provider**

Each tree item must set:

```ts
item.label = workspaceLabel(entry);
item.description = entry.uri === currentUri ? 'Current' : undefined;
item.tooltip = new MarkdownString(`**${filename}**\n\n${nativePath}\n\n${provenance}`);
item.contextValue = entry.manuallyRegistered ? 'workspace.manual' : 'workspace.discovered';
item.command = {
  command: 'workspaceAtlas.openEntryInCurrentWindow',
  title: 'Open Workspace',
  arguments: [entry.id],
};
```

Register the internal `workspaceAtlas.openEntryInCurrentWindow` command even though it is not shown in the Command Palette. Use a `ThemeIcon('circle-filled')` for the current entry and `ThemeIcon('workspace-untrusted')` or the nearest supported workspace product icon for other entries. Keep items non-collapsible.

Add `src/test/unit/workspaceTreeProvider.test.ts` with a mocked `vscode` module and assert that the current item is first, uses the current icon/description, carries the internal current-window command, and that a manual item receives `workspace.manual` context. Include this test in the verification command.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:unit -- src/test/unit/commandHandlers.test.ts src/test/unit/workspaceTreeProvider.test.ts`

Expected: all command-handler and tree-provider tests PASS.

Run: `npm test`

Expected: all checks PASS.

```bash
git add src/commands src/ui/workspaceTreeProvider.ts src/test/unit/commandHandlers.test.ts
git commit -m "feat: add workspace sidebar commands"
```

---

### Task 8: Manifest contributions, activation lifecycle, and empty state

**Files:**
- Modify: `package.json`
- Modify: `src/extension.ts`
- Create: `resources/workspace-atlas.svg`
- Create: `.vscode/launch.json`
- Create: `.vscode/tasks.json`
- Test: `src/test/integration/extension.test.ts`
- Create: `tsconfig.integration.json`
- Create: `.vscode-test.mjs`

**Interfaces:**
- Consumes: all runtime components from Tasks 1–7.
- Produces: a fully activated extension and contributed Activity Bar container, view, commands, menus, configuration, and welcome content.

- [ ] **Step 1: Add the integration-test toolchain**

Install: `npm install --save-dev @types/mocha @vscode/test-cli @vscode/test-electron`

Add scripts:

```json
{
  "compile:integration": "tsc -p tsconfig.integration.json",
  "test:integration": "npm run compile && npm run compile:integration && vscode-test",
  "test:all": "npm test && npm run test:integration"
}
```

Configure `.vscode-test.mjs` with label `integration`, files `out/test/integration/**/*.test.js`, version `stable`, and launch arguments `--disable-extensions`. Configure `tsconfig.integration.json` to emit CommonJS test files into `out/test/integration` with Mocha and VS Code types.

Use:

```js
// .vscode-test.mjs
export default [{
  label: 'integration',
  files: 'out/test/integration/**/*.test.js',
  version: 'stable',
  launchArgs: ['--disable-extensions'],
}];
```

```json
// tsconfig.integration.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "strict": true,
    "rootDir": "src/test/integration",
    "outDir": "out/test/integration",
    "types": ["node", "vscode", "mocha"]
  },
  "include": ["src/test/integration/**/*.ts"]
}
```

- [ ] **Step 2: Write the failing Extension Development Host test**

Create `src/test/integration/extension.test.ts`:

```ts
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

suite('Workspace Atlas extension', () => {
  test('activates and registers its public commands', async () => {
    const extension = vscode.extensions.getExtension('nick.workspace-atlas');
    assert.ok(extension);
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'workspaceAtlas.switchWorkspace',
      'workspaceAtlas.openWorkspaceInNewWindow',
      'workspaceAtlas.addWorkspace',
      'workspaceAtlas.addDiscoveryRoot',
      'workspaceAtlas.refreshWorkspaces',
    ]) assert.ok(commands.includes(id), `${id} was not registered`);
  });
});
```

- [ ] **Step 3: Run the integration test and verify failure**

Run: `npm run test:integration`

Expected: FAIL because manifest contributions and runtime registrations are incomplete.

- [ ] **Step 4: Add exact manifest contributions**

Extend `package.json` with:

- An Activity Bar `viewsContainers.activitybar` entry `workspaceAtlas` using `resources/workspace-atlas.svg`.
- A `views.workspaceAtlas` entry with ID `workspaceAtlas.workspaces` and name `Workspaces`.
- All ten public commands from Task 7, plus the internal current-window item command.
- `view/title` actions for Add Workspace and Refresh.
- A `view/item/context` inline new-window action and context actions for rename, reset, remove, and reveal.
- `viewsWelcome` links for Add Workspace and Add Discovery Root when the view is empty.
- Configuration `workspaceAtlas.discoveryRoots` as a machine-overridable array of URI strings with default `[]`.
- No `contributes.keybindings` section.

Use `when` clauses scoped to `view == workspaceAtlas.workspaces` and item `contextValue` values. Use Codicon references for command icons except the Activity Bar SVG.

The contribution object must be equivalent to:

```json
{
  "viewsContainers": {
    "activitybar": [{ "id": "workspaceAtlas", "title": "Workspace Atlas", "icon": "resources/workspace-atlas.svg" }]
  },
  "views": {
    "workspaceAtlas": [{ "id": "workspaceAtlas.workspaces", "name": "Workspaces" }]
  },
  "commands": [
    { "command": "workspaceAtlas.switchWorkspace", "title": "Workspace Atlas: Switch Workspace" },
    { "command": "workspaceAtlas.openWorkspaceInNewWindow", "title": "Workspace Atlas: Open Workspace in New Window", "icon": "$(empty-window)" },
    { "command": "workspaceAtlas.addWorkspace", "title": "Workspace Atlas: Add Workspace...", "icon": "$(add)" },
    { "command": "workspaceAtlas.addDiscoveryRoot", "title": "Workspace Atlas: Add Discovery Root..." },
    { "command": "workspaceAtlas.removeDiscoveryRoot", "title": "Workspace Atlas: Remove Discovery Root..." },
    { "command": "workspaceAtlas.refreshWorkspaces", "title": "Workspace Atlas: Refresh Workspaces", "icon": "$(refresh)" },
    { "command": "workspaceAtlas.renameWorkspace", "title": "Workspace Atlas: Rename Workspace" },
    { "command": "workspaceAtlas.resetWorkspaceName", "title": "Workspace Atlas: Reset Workspace Name" },
    { "command": "workspaceAtlas.removeWorkspace", "title": "Workspace Atlas: Remove Workspace" },
    { "command": "workspaceAtlas.revealWorkspaceFile", "title": "Workspace Atlas: Reveal Workspace File" },
    { "command": "workspaceAtlas.openEntryInCurrentWindow", "title": "Open Workspace" }
  ],
  "menus": {
    "view/title": [
      { "command": "workspaceAtlas.addWorkspace", "when": "view == workspaceAtlas.workspaces", "group": "navigation@1" },
      { "command": "workspaceAtlas.refreshWorkspaces", "when": "view == workspaceAtlas.workspaces", "group": "navigation@2" },
      { "command": "workspaceAtlas.addDiscoveryRoot", "when": "view == workspaceAtlas.workspaces", "group": "management@1" },
      { "command": "workspaceAtlas.removeDiscoveryRoot", "when": "view == workspaceAtlas.workspaces", "group": "management@2" }
    ],
    "view/item/context": [
      { "command": "workspaceAtlas.openWorkspaceInNewWindow", "when": "view == workspaceAtlas.workspaces", "group": "inline@1" },
      { "command": "workspaceAtlas.renameWorkspace", "when": "view == workspaceAtlas.workspaces", "group": "manage@1" },
      { "command": "workspaceAtlas.resetWorkspaceName", "when": "view == workspaceAtlas.workspaces", "group": "manage@2" },
      { "command": "workspaceAtlas.removeWorkspace", "when": "view == workspaceAtlas.workspaces && viewItem == workspace.manual", "group": "manage@3" },
      { "command": "workspaceAtlas.revealWorkspaceFile", "when": "view == workspaceAtlas.workspaces", "group": "navigation@1" }
    ]
  },
  "viewsWelcome": [{
    "view": "workspaceAtlas.workspaces",
    "contents": "No workspaces registered.\n[Add Workspace](command:workspaceAtlas.addWorkspace)\n[Add Discovery Root](command:workspaceAtlas.addDiscoveryRoot)"
  }],
  "configuration": {
    "title": "Workspace Atlas",
    "properties": {
      "workspaceAtlas.discoveryRoots": {
        "type": "array",
        "scope": "machine-overridable",
        "default": [],
        "items": { "type": "string" },
        "description": "Folder URIs recursively searched for .code-workspace files."
      }
    }
  }
}
```

Create the monochrome Activity Bar icon as:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M4 5.5h6l2 2h8v11H4z"/>
  <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M8 12h8M12 9.5V15"/>
</svg>
```

Use this launch configuration and task:

```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [{
    "name": "Run Workspace Atlas",
    "type": "extensionHost",
    "request": "launch",
    "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
    "outFiles": ["${workspaceFolder}/dist/**/*.js"],
    "preLaunchTask": "npm: compile"
  }]
}
```

```json
// .vscode/tasks.json
{
  "version": "2.0.0",
  "tasks": [{
    "type": "npm",
    "script": "compile",
    "problemMatcher": ["$tsc"],
    "group": { "kind": "build", "isDefault": true }
  }]
}
```

- [ ] **Step 5: Compose activation**

In `activate(context)`:

1. Create `VscodeRegistryStorage(context.globalState)` and load `WorkspaceRegistry`; if `load()` returns `reset: true`, show `Workspace Atlas could not read its local registry and started with an empty list.` once.
2. Create `VscodeFileSystem`, discovery service, reconciler, coordinator, opener, tree provider, and command UI adapter.
3. Register the tree provider and all commands into `context.subscriptions`.
4. Subscribe to view visibility, configuration changes, and workspace-file changes.
5. Start `coordinator.refresh('activation')` without blocking activation forever; catch and surface one activation warning.
6. Push coordinator/watchers and event emitters into `context.subscriptions`.

Keep `extension.ts` limited to composition; do not move business rules into activation callbacks.

- [ ] **Step 6: Verify runtime and commit**

Run: `npm run test:integration`

Expected: integration test PASS.

Run: `npm run test:all`

Expected: unit and integration suites PASS.

Press F5 using `.vscode/launch.json` and confirm the Workspace Atlas Activity Bar icon opens an empty view with Add Workspace and Add Discovery Root links.

```bash
git add package.json package-lock.json src/extension.ts src/test/integration tsconfig.integration.json .vscode-test.mjs resources .vscode
git commit -m "feat: activate Workspace Atlas workbench UI"
```

---

### Task 9: Marketplace documentation, packaging, and cross-platform CI

**Files:**
- Create: `README.md`
- Create: `CHANGELOG.md`
- Create: `LICENSE`
- Create: `.github/workflows/ci.yml`
- Modify: `package.json`

**Interfaces:**
- Consumes: completed extension commands and settings.
- Produces: installable `.vsix`, user documentation, and three-platform automated verification.

- [ ] **Step 1: Write Marketplace-facing documentation**

`README.md` must contain these concrete sections:

- What Workspace Atlas does and the subtitle “Discover, organize, and switch between `.code-workspace` files.”
- Add Workspace and Add Discovery Root setup flows.
- Sidebar click versus inline new-window behavior.
- Both Quick Pick commands.
- Alias/reset/remove semantics, explicitly stating that Remove Workspace never deletes files.
- Automatic stale cleanup behavior.
- `workspaceAtlas.discoveryRoots` configuration example using URI strings.
- Keyboard shortcut instructions using VS Code's Keyboard Shortcuts editor.
- Stage 1 limitations: desktop/local files, no Git awareness, no native tabs.
- Development commands: install, compile, unit test, integration test, package.

`CHANGELOG.md` begins with `0.1.0` and lists manual registration, discovery roots, current-area discovery, stale cleanup, sidebar, Quick Picks, aliases, and two open modes. Use the standard MIT license text with copyright year 2026 and holder `Nick`.

- [ ] **Step 2: Add three-platform CI**

Create `.github/workflows/ci.yml` with a matrix of `ubuntu-latest`, `windows-latest`, and `macos-latest`, Node 22, `npm ci`, `npm test`, and `npm run package`. Run the Extension Development Host integration test on Linux under `xvfb-run -a`; run it directly on macOS and Windows. Upload the `.vsix` from one packaging job only.

Use this exact workflow:

```yaml
name: CI
on:
  push:
  pull_request:
jobs:
  verify:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - if: runner.os == 'Linux'
        run: xvfb-run -a npm run test:integration
      - if: runner.os != 'Linux'
        run: npm run test:integration
      - run: npm run package
  package:
    needs: verify
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run vsix
      - uses: actions/upload-artifact@v4
        with:
          name: workspace-atlas-vsix
          path: workspace-atlas-*.vsix
```

- [ ] **Step 3: Package and inspect the VSIX**

Run: `npm run vsix`

Expected: exit 0 and `workspace-atlas-0.1.0.vsix` is created.

Run: `npx vsce ls`

Expected: includes `dist/extension.js`, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, and `resources/workspace-atlas.svg`; excludes `src/`, tests, and local build caches.

- [ ] **Step 4: Perform the Stage 1 smoke test**

In a clean Extension Development Host or profile:

1. Create two temporary directories containing valid `.code-workspace` files.
2. Add one manually and discover the other through a configured root.
3. Assign and reset an alias.
4. Open each workspace in the current window and in a new window.
5. Delete one temporary directory outside VS Code.
6. Confirm its entry disappears after the watcher refresh or explicit refresh.
7. Confirm Remove Workspace does not delete the remaining file.

Expected: all seven checks succeed without duplicate entries or per-file notification spam.

- [ ] **Step 5: Run final verification and commit**

Run: `npm run test:all`

Expected: all unit and Extension Development Host tests PASS.

Run: `npm run vsix`

Expected: package succeeds with no fatal validation errors; record non-fatal repository or Marketplace-icon warnings for the later publication-preparation pass.

```bash
git add README.md CHANGELOG.md LICENSE .github/workflows/ci.yml package.json package-lock.json .vscodeignore
git commit -m "docs: prepare Workspace Atlas preview package"
```

## Completion gate

Before describing Stage 1 as complete:

- Run `git status --short` and confirm only intentionally ignored build artifacts are present.
- Run `npm run test:all` and retain the passing output.
- Run `npm run vsix` and confirm the package filename.
- Review `npx vsce ls` for accidental source, test, cache, or secret inclusion.
- Confirm the manual smoke-test checklist on the target macOS development machine.
- Do not publish to the Marketplace until the user confirms the publisher ID, final icon, public repository URL, privacy/support links if applicable, and the still-available Marketplace display/package names.
