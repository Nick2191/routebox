import { describe, expect, it } from 'vitest';
import {
  activationCleanupMessage,
  registryLoadWarning,
} from '../../extension.js';
import type { RefreshReason } from '../../platform/discoveryCoordinator.js';

describe('activation cleanup notification', () => {
  it.each([
    [1, 'Removed 1 missing project.'],
    [2, 'Removed 2 missing projects.'],
  ])('formats project cleanup for %i removals', (removed, expected) => {
    expect(activationCleanupMessage('activation', removed)).toBe(expected);
  });

  it.each<RefreshReason>([
    'view-visible',
    'manual',
    'settings-change',
    'watcher',
    'workspace-change',
  ])('does not notify for a %s refresh', reason => {
    expect(activationCleanupMessage(reason, 2)).toBeUndefined();
  });

  it('does not notify when activation removes nothing', () => {
    expect(activationCleanupMessage('activation', 0)).toBeUndefined();
  });

  it('formats discarded registry records without mentioning migration', () => {
    expect(registryLoadWarning({ discarded: 2, reset: false, migrated: 1 }))
      .toBe('Routebox ignored 2 invalid saved projects.');
  });

  it('reports a registry reset', () => {
    expect(registryLoadWarning({ discarded: 0, reset: true, migrated: 0 }))
      .toBe('Routebox could not read its local registry and started with an empty list.');
  });

  it('keeps migration-only registry loads silent', () => {
    expect(registryLoadWarning({ discarded: 0, reset: false, migrated: 1 }))
      .toBeUndefined();
  });
});
