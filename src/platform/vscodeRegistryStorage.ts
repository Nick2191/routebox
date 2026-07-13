import type { ExtensionContext } from 'vscode';
import type { WorkspaceEntry } from '../domain/workspaceEntry.js';
import type { RegistryStorage } from '../domain/workspaceRegistry.js';

const registryKey = 'workspaceAtlas.registry.v1';

type GlobalState = Pick<ExtensionContext['globalState'], 'get' | 'update'>;

export class VscodeRegistryStorage implements RegistryStorage {
  constructor(private readonly globalState: GlobalState) {}

  read(): Promise<unknown> {
    return Promise.resolve(this.globalState.get(registryKey));
  }

  async write(entries: readonly WorkspaceEntry[]): Promise<void> {
    await this.globalState.update(registryKey, entries);
  }
}
