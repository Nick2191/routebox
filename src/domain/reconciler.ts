import type { DiscoveryResult, FileSystemPort } from './discovery.js';
import type { WorkspaceSourceId } from './projectEntry.js';
import type { ProjectRegistry } from './projectRegistry.js';

export class WorkspaceReconciler {
  constructor(
    private readonly registry: ProjectRegistry,
    private readonly fs: FileSystemPort,
  ) {}

  async reconcileSource(source: WorkspaceSourceId, result: DiscoveryResult): Promise<void> {
    if (result.status === 'error') return;
    const discovered = new Set(result.workspaceUris);
    await this.registry.updateEntries(entries => {
      for (const entry of entries.values()) {
        const sources = entry.discoveredFrom.filter(value => value !== source);
        if (discovered.has(entry.uri)) sources.push(source);
        entry.discoveredFrom = [...new Set(sources)];
        if (!entry.manuallyRegistered && entry.discoveredFrom.length === 0) {
          entries.delete(entry.id);
        }
      }

      for (const uri of discovered) {
        if (entries.has(uri)) continue;
        entries.set(uri, {
          id: uri,
          uri,
          kind: 'workspace',
          manuallyRegistered: false,
          discoveredFrom: [source],
        });
      }
    });
  }

  async retireSource(source: WorkspaceSourceId): Promise<void> {
    await this.registry.updateEntries(entries => {
      for (const entry of entries.values()) {
        entry.discoveredFrom = entry.discoveredFrom.filter(value => value !== source);
        if (!entry.manuallyRegistered && entry.discoveredFrom.length === 0) {
          entries.delete(entry.id);
        }
      }
    });
  }

  async removeMissing(): Promise<{ removed: number }> {
    const current = this.registry.list();
    const checks = await Promise.all(current.map(async entry => [
      entry,
      await this.fs.exists(entry.uri),
    ] as const));
    const missingIds = checks
      .filter(([, exists]) => !exists)
      .map(([entry]) => entry.id);
    return { removed: await this.registry.remove(missingIds) };
  }
}
