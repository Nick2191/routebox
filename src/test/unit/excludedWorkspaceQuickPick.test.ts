import { ThemeIcon, Uri } from 'vscode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExcludedWorkspace } from '../../domain/projectEntry.js';
import {
  VscodeExcludedWorkspacePicker,
  buildExcludedWorkspaceQuickPickItems,
  type ExcludedWorkspaceQuickPickItem,
} from '../../ui/excludedWorkspaceQuickPick.js';
import {
  TestQuickPick,
  setCreateQuickPick,
} from '../adapters/vscode.js';

const excluded = (uri: string, alias?: string): ExcludedWorkspace => ({
  id: uri,
  uri,
  kind: 'workspace',
  ...(alias === undefined ? {} : { alias }),
});

const deferred = <T = void>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} => {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>(resolve => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
};

afterEach(() => {
  setCreateQuickPick(() => new TestQuickPick());
});

describe('buildExcludedWorkspaceQuickPickItems', () => {
  it('builds restorable items with the effective label and native path', () => {
    const entry = excluded('file:///work/atlas-alpha.code-workspace', 'Atlas Alpha');
    const restoreButton = {
      iconPath: new ThemeIcon('add'),
      tooltip: 'Restore Workspace',
    };

    const [item] = buildExcludedWorkspaceQuickPickItems([entry], restoreButton);

    expect(item).toMatchObject({
      label: '$(file-code) Atlas Alpha',
      detail: Uri.parse(entry.uri).fsPath,
      exclusion: entry,
      buttons: [restoreButton],
    });
  });

  it('uses workspace filenames when exclusions have no aliases', () => {
    const restoreButton = {
      iconPath: new ThemeIcon('add'),
      tooltip: 'Restore Workspace',
    };

    expect(buildExcludedWorkspaceQuickPickItems([
      excluded('file:///work/My%20Workspace.code-workspace'),
    ], restoreButton)[0]?.label).toBe('$(file-code) My Workspace');
  });

  it('sorts exclusions alphabetically with case-insensitive numeric ordering', () => {
    const restoreButton = {
      iconPath: new ThemeIcon('add'),
      tooltip: 'Restore Workspace',
    };
    const atlas10 = excluded('file:///work/atlas-10.code-workspace', 'atlas 10');
    const beta = excluded('file:///work/beta.code-workspace', 'Beta');
    const atlas2 = excluded('file:///work/atlas-2.code-workspace', 'Atlas 2');

    expect(buildExcludedWorkspaceQuickPickItems(
      [atlas10, beta, atlas2],
      restoreButton,
    ).map(item => item.exclusion)).toEqual([atlas2, atlas10, beta]);
  });
});

describe('VscodeExcludedWorkspacePicker', () => {
  it('ignores duplicate restore triggers for the same exclusion while it is pending', async () => {
    const entry = excluded('file:///work/atlas.code-workspace', 'Atlas');
    const entries = [entry];
    const pendingRestore = deferred();
    const picker = new TestQuickPick<ExcludedWorkspaceQuickPickItem>();
    setCreateQuickPick(() => picker);
    const list = vi.fn(() => entries);
    const restore = vi.fn(async (id: string) => {
      await pendingRestore.promise;
      entries.splice(entries.findIndex(value => value.id === id), 1);
    });
    const reportError = vi.fn(() => Promise.resolve());

    const shown = new VscodeExcludedWorkspacePicker().show({ list, restore, reportError });
    const item = picker.items[0];
    const button = item?.buttons?.[0];
    expect(item).toBeDefined();
    expect(button).toBeDefined();
    if (!item || !button) throw new Error('Expected an excluded workspace restore button.');

    picker.accept(item);
    picker.triggerItemButton(item, button);

    expect(restore).toHaveBeenCalledTimes(1);
    pendingRestore.resolve();
    await shown;
    expect(list).toHaveBeenCalledTimes(2);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('does not touch or report errors from a restore that finishes after dismissal', async () => {
    const entry = excluded('file:///work/atlas.code-workspace', 'Atlas');
    const pendingRestore = deferred();
    const picker = new TestQuickPick<ExcludedWorkspaceQuickPickItem>();
    setCreateQuickPick(() => picker);
    const restore = vi.fn(() => pendingRestore.promise);
    const reportError = vi.fn(() => Promise.resolve());

    const shown = new VscodeExcludedWorkspacePicker().show({
      list: () => [entry],
      restore,
      reportError,
    });
    const item = picker.items[0];
    const button = item?.buttons?.[0];
    expect(item).toBeDefined();
    expect(button).toBeDefined();
    if (!item || !button) throw new Error('Expected an excluded workspace restore button.');

    picker.triggerItemButton(item, button);
    expect(restore).toHaveBeenCalledOnce();
    picker.hide();

    await shown;
    expect(picker.disposed).toBe(true);
    expect(picker.listenerCount).toBe(0);

    pendingRestore.resolve();
    await pendingRestore.promise;
    await Promise.resolve();

    expect(picker.postDisposalTouches).toBe(0);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('restores the keyboard-selected exclusion and closes when none remain', async () => {
    const entry = excluded('file:///work/atlas.code-workspace', 'Atlas');
    const entries = [entry];
    const picker = new TestQuickPick<ExcludedWorkspaceQuickPickItem>();
    setCreateQuickPick(() => picker);
    const restore = vi.fn((id: string) => {
      entries.splice(entries.findIndex(entry => entry.id === id), 1);
      return Promise.resolve();
    });
    const reportError = vi.fn(() => Promise.resolve());

    const shown = new VscodeExcludedWorkspacePicker().show({
      list: () => entries,
      restore,
      reportError,
    });
    const selected = picker.items[0];
    expect(selected).toBeDefined();
    if (!selected) throw new Error('Expected an excluded workspace item.');

    picker.accept(selected);

    await vi.waitFor(() => expect(restore).toHaveBeenCalledWith(entry.id));
    await shown;
    expect(reportError).not.toHaveBeenCalled();
    expect(picker.visible).toBe(false);
    expect(picker.disposed).toBe(true);
  });

  it('supports multiple sequential inline restores and rebuilds the live item list', async () => {
    const alpha = excluded('file:///work/alpha.code-workspace', 'Alpha');
    const beta = excluded('file:///work/beta.code-workspace', 'Beta');
    const entries = [beta, alpha];
    const picker = new TestQuickPick<ExcludedWorkspaceQuickPickItem>();
    setCreateQuickPick(() => picker);
    const restore = vi.fn((id: string) => {
      entries.splice(entries.findIndex(entry => entry.id === id), 1);
      return Promise.resolve();
    });

    const shown = new VscodeExcludedWorkspacePicker().show({
      list: () => entries,
      restore,
      reportError: () => Promise.resolve(),
    });
    expect(picker.items.map(item => item.exclusion)).toEqual([alpha, beta]);
    const first = picker.items[0];
    const firstButton = first?.buttons?.[0];
    expect(first).toBeDefined();
    expect(firstButton).toBeDefined();
    if (!first || !firstButton) throw new Error('Expected the first restore button.');

    picker.triggerItemButton(first, firstButton);

    await vi.waitFor(() => {
      expect(restore).toHaveBeenCalledWith(alpha.id);
      expect(picker.items.map(item => item.exclusion)).toEqual([beta]);
    });
    expect(picker.visible).toBe(true);
    const remaining = picker.items[0];
    const remainingButton = remaining?.buttons?.[0];
    expect(remaining).toBeDefined();
    expect(remainingButton).toBeDefined();
    if (!remaining || !remainingButton) throw new Error('Expected the remaining restore button.');

    picker.triggerItemButton(remaining, remainingButton);

    await shown;
    expect(restore.mock.calls).toEqual([[alpha.id], [beta.id]]);
    expect(picker.disposed).toBe(true);
  });

  it('reports failed event restores and keeps the exclusion visible', async () => {
    const entry = excluded('file:///work/atlas.code-workspace', 'Atlas');
    const picker = new TestQuickPick<ExcludedWorkspaceQuickPickItem>();
    setCreateQuickPick(() => picker);
    const failure = new Error('Restore failed');
    const reportError = vi.fn(() => Promise.resolve());

    const shown = new VscodeExcludedWorkspacePicker().show({
      list: () => [entry],
      restore: () => Promise.reject(failure),
      reportError,
    });
    const item = picker.items[0];
    const button = item?.buttons?.[0];
    expect(item).toBeDefined();
    expect(button).toBeDefined();
    if (!item || !button) throw new Error('Expected an excluded workspace restore button.');

    picker.triggerItemButton(item, button);

    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(failure));
    expect(picker.items.map(value => value.exclusion)).toEqual([entry]);
    expect(picker.visible).toBe(true);

    picker.hide();
    await shown;
    expect(picker.disposed).toBe(true);
  });
});
