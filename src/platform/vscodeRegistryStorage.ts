import type { ExtensionContext } from 'vscode';
import type { ProjectEntry } from '../domain/projectEntry.js';
import type { RegistryStorage } from '../domain/projectRegistry.js';

const registryKey = 'workspaceAtlas.registry.v1';

type GlobalState = Pick<ExtensionContext['globalState'], 'get' | 'update'>;

export class VscodeRegistryStorage implements RegistryStorage {
  constructor(private readonly globalState: GlobalState) {}

  read(): Promise<unknown> {
    return Promise.resolve(this.globalState.get(registryKey));
  }

  async write(entries: readonly ProjectEntry[]): Promise<void> {
    await this.globalState.update(registryKey, entries);
  }
}
