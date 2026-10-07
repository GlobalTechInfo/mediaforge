import { rmSync, mkdirSync, writeFileSync, chmodSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

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

// Resolve tsc through Node rather than shelling out to `node_modules/.bin/tsc`.
// That path is a shell script on Unix but a `.cmd` shim on Windows, so the bare
// path fails there with "'node_modules' is not recognized" — which is how the
// Windows leg of the matrix died at Build. Running the JS entry point with the
// current interpreter works identically on every platform.
const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');
for (const project of ['tsconfig.build.json', 'tsconfig.cjs.json']) {
  execFileSync(process.execPath, [tsc, '-p', project], { stdio: 'inherit', cwd: root });
}

writeFileSync(join(root, 'dist/cjs/package.json'), JSON.stringify({ type: 'commonjs' }) + '\n');
chmodSync(join(root, 'dist/esm/cli/index.js'), 0o755);

// `rewriteRelativeImportExtensions` rewrites `./x.ts` to `./x.js` in the emitted
// JavaScript, but TypeScript does not apply it to declaration output — so every
// published `.d.ts` kept a `./x.ts` specifier that resolves only because
// TypeScript is lenient enough to strip it. A stricter declaration consumer
// (or any non-TypeScript checker) would fail to resolve them.
//
// A previous attempt at this used a global `sed s/\.ts'/\.js'/g`, which rewrote
// any string ending in `.ts` rather than only import paths and so corrupted
// runtime defaults such as hls.ts's `segmentFilename = 'segment%03d.ts'`. This
// only touches the `from '…'` position of an import/export specifier.
const declarationFiles = ['dist/esm', 'dist/cjs'];
let rewritten = 0;

for (const outDir of declarationFiles) {
  const dir = join(root, outDir);
  if (!existsSync(dir)) continue;

  for (const file of readdirSync(dir, { recursive: true })) {
    if (typeof file !== 'string' || !file.endsWith('.d.ts')) continue;
    const full = join(dir, file);
    const before = readFileSync(full, 'utf8');
    // A specifier is the string immediately after `from ` or bare `import '`,
    // so anchoring on those keywords cannot touch a runtime string literal.
    const after = before.replace(
      /(\bfrom\s+|\bimport\s+)(['"])(\.{1,2}\/[^'"]+?)\.ts\2/g,
      (_match, keyword: string, quote: string, specifier: string) =>
        `${keyword}${quote}${specifier}.js${quote}`,
    );
    if (after !== before) {
      writeFileSync(full, after);
      rewritten++;
    }
  }
}

if (rewritten > 0) {
  console.log(`build — rewrote .ts import specifiers in ${rewritten} declaration file(s)`);
}
