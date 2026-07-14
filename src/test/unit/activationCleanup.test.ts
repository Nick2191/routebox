import { describe, expect, it } from 'vitest';
import { activationCleanupMessage } from '../../extension.js';
import type { RefreshReason } from '../../platform/discoveryCoordinator.js';

describe('activation cleanup notification', () => {
  it.each([
    [1, 'Removed 1 missing workspace.'],
    [2, 'Removed 2 missing workspaces.'],
  ])('formats an aggregate activation message for %i removals', (removed, expected) => {
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
});
