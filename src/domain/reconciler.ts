import type { DiscoveryResult, FileSystemPort } from './discovery.js';
import type { WorkspaceSourceId } from './workspaceEntry.js';
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
      if (next.has(uri)) continue;
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
    const retained = this.registry.list()
      .map(entry => ({
        ...entry,
        discoveredFrom: entry.discoveredFrom.filter(value => value !== source),
      }))
      .filter(entry => entry.manuallyRegistered || entry.discoveredFrom.length > 0);
    await this.registry.replace(retained);
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
