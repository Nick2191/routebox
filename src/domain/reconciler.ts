import type { DiscoveryResult, FileSystemPort } from './discovery.js';
import type { WorkspaceSourceId } from './projectEntry.js';
import type { ProjectRegistry } from './projectRegistry.js';

export interface TargetAccessError {
  uri: string;
  error: string;
}

export interface RemoveMissingResult {
  removed: number;
  targetAccessErrors: TargetAccessError[];
}

export class ProjectReconciler {
  constructor(
    private readonly registry: ProjectRegistry,
    private readonly fs: FileSystemPort,
  ) {}

  async reconcileSource(source: WorkspaceSourceId, result: DiscoveryResult): Promise<void> {
    if (result.status === 'error') return;
    const discovered = new Set(result.workspaceUris);
    await this.registry.updateEntries(entries => {
      for (const entry of entries.values()) {
        if (entry.kind !== 'workspace') continue;
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
        if (entry.kind !== 'workspace') continue;
        entry.discoveredFrom = entry.discoveredFrom.filter(value => value !== source);
        if (!entry.manuallyRegistered && entry.discoveredFrom.length === 0) {
          entries.delete(entry.id);
        }
      }
    });
  }

  async removeMissing(): Promise<RemoveMissingResult> {
    const current = this.registry.list();
    const checks = await Promise.all(current.map(async entry => {
      try {
        return {
          status: 'ok',
          entry,
          kind: await this.fs.statKind(entry.uri),
        } as const;
      } catch (error) {
        return {
          status: 'error',
          entry,
          targetAccessError: {
            uri: entry.uri,
            error: error instanceof Error ? error.message : String(error),
          },
        } as const;
      }
    }));
    const missingIds = checks
      .filter(check => check.status === 'ok' && check.kind === 'missing')
      .map(check => check.entry.id);
    const targetAccessErrors = checks.reduce<TargetAccessError[]>((errors, check) => {
      if (check.status === 'error') errors.push(check.targetAccessError);
      return errors;
    }, []);
    return {
      removed: await this.registry.remove(missingIds),
      targetAccessErrors,
    };
  }
}
