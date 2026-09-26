import { rmSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const root = join(import.meta.dirname, '..');

// Import specifiers in lib/ use explicit `.ts` extensions (required by
// `allowImportingTsExtensions` and needed for Deno, which resolves `./x.ts`
// directly). Both build targets set `rewriteRelativeImportExtensions`, so tsc
// rewrites those specifiers to `.js` in the emitted output for us.
//
// This used to be done by copying lib/ to a temp dir and running a global
// `sed s/\.ts'/\.js'/g` over every source file. That rewrote *any* string
// ending in `.ts`, not just import paths — it silently corrupted runtime
// defaults such as hls.ts's `segmentFilename = 'segment%03d.ts'`, which shipped
// as `.js` in the published package while the source (and Deno consumers)
// produced `.ts`.
rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(join(root, 'dist'), { recursive: true });

for (const project of ['tsconfig.build.json', 'tsconfig.cjs.json']) {
  execSync(`node_modules/.bin/tsc -p ${project}`, { stdio: 'inherit', cwd: root });
}

writeFileSync(join(root, 'dist/cjs/package.json'), JSON.stringify({ type: 'commonjs' }) + '\n');
chmodSync(join(root, 'dist/esm/cli/index.js'), 0o755);
