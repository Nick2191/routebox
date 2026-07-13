import * as esbuild from 'esbuild';
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const context = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: 'node',
  target: 'node22',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  logLevel: 'info',
});
if (watch) await context.watch();
else { await context.rebuild(); await context.dispose(); }
