import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { vscode: resolve(process.cwd(), 'src/test/adapters/vscode.ts') } },
  test: { include: ['src/test/unit/**/*.test.ts'], coverage: { reporter: ['text', 'html'] } },
});
