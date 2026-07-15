import {
  ThemeIcon,
  Uri,
  window,
  type Disposable,
  type QuickInputButton,
  type QuickPickItem,
} from 'vscode';
import {
  projectLabel,
  type ExcludedWorkspace,
} from '../domain/projectEntry.js';

export interface ExcludedWorkspaceQuickPickItem extends QuickPickItem {
  exclusion: ExcludedWorkspace;
}

export interface ExcludedWorkspacePickerOptions {
  list(): readonly ExcludedWorkspace[];
  restore(id: string): Promise<void>;
  reportError(error: unknown): Promise<void>;
}

export interface ExcludedWorkspacePicker {
  show(options: ExcludedWorkspacePickerOptions): Promise<void>;
}

export function buildExcludedWorkspaceQuickPickItems(
  entries: readonly ExcludedWorkspace[],
  restoreButton: QuickInputButton,
): ExcludedWorkspaceQuickPickItem[] {
  return [...entries]
    .sort((left, right) => projectLabel(left).localeCompare(projectLabel(right), undefined, {
      sensitivity: 'base',
      numeric: true,
    }))
    .map(exclusion => ({
      label: `$(file-code) ${projectLabel(exclusion)}`,
      detail: Uri.parse(exclusion.uri).fsPath,
      exclusion,
      buttons: [restoreButton],
    }));
}

export class VscodeExcludedWorkspacePicker implements ExcludedWorkspacePicker {
  async show(options: ExcludedWorkspacePickerOptions): Promise<void> {
    const quickPick = window.createQuickPick<ExcludedWorkspaceQuickPickItem>();
    const restoreButton: QuickInputButton = {
      iconPath: new ThemeIcon('add'),
      tooltip: 'Restore Workspace',
    };
    quickPick.placeholder = 'Select an excluded workspace to restore';
    quickPick.matchOnDetail = true;
    quickPick.items = buildExcludedWorkspaceQuickPickItems(options.list(), restoreButton);

    await new Promise<void>(resolve => {
      const subscriptions: Disposable[] = [];
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        for (const subscription of subscriptions) subscription.dispose();
        quickPick.dispose();
        resolve();
      };
      const report = (error: unknown): void => {
        void options.reportError(error).catch(() => undefined);
      };
      const restore = async (item: ExcludedWorkspaceQuickPickItem): Promise<void> => {
        await options.restore(item.exclusion.id);
        quickPick.items = buildExcludedWorkspaceQuickPickItems(options.list(), restoreButton);
        if (quickPick.items.length === 0) quickPick.hide();
      };
      const handleRestore = (item: ExcludedWorkspaceQuickPickItem | undefined): void => {
        if (!item) return;
        void restore(item).catch(report);
      };

      subscriptions.push(
        quickPick.onDidAccept(() => { handleRestore(quickPick.selectedItems[0]); }),
        quickPick.onDidTriggerItemButton(event => { handleRestore(event.item); }),
        quickPick.onDidHide(finish),
      );
      quickPick.show();
      if (quickPick.items.length === 0) quickPick.hide();
    });
  }
}
