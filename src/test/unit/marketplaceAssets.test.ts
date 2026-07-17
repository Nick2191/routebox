import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Marketplace assets', () => {
  it('provides a 256 by 256 PNG icon', () => {
    const png = readFileSync(resolve(process.cwd(), 'resources/routebox-marketplace.png'));

    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.readUInt32BE(16)).toBe(256);
    expect(png.readUInt32BE(20)).toBe(256);
  });

  it('excludes local worktrees from Marketplace packages', () => {
    const ignoreRules = readFileSync(resolve(process.cwd(), '.vscodeignore'), 'utf8')
      .split(/\r?\n/);

    expect(ignoreRules).toContain('.worktrees/**');
  });
});
