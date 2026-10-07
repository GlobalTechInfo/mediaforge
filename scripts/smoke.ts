/**
 * Clean-room install smoke test.
 *
 * Everything else in CI validates the repository. Nothing validated the artefact
 * a consumer actually receives — and the artefact is where packaging faults hide,
 * because `npm pack` applies the `files` allowlist, strips `.gitignore`d paths
 * and applies npm-specific rules that a local build never sees.
 *
 * Two faults found this way in earlier releases:
 *
 *  - Every `.d.ts.map` pointed at `../../lib/*.ts`, which was not in `files`, so
 *    "go to definition" was broken for all 52 exported modules in a consumer.
 *  - Published declarations kept `./x.ts` import specifiers.
 *
 * This packs the tarball, installs it into a scratch directory with no
 * relationship to the source tree, and exercises every published entry point:
 * ESM import, CJS require, and the `mediaforge` binary.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), 'mediaforge-smoke-'));

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL ${name}${detail === '' ? '' : `\n       ${detail}`}`);
  }
}

/** Resolve `.`/`..` segments in a POSIX-style path, as source maps use them. */
function resolvePosix(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '..') out.pop();
    else if (part !== '.' && part !== '') out.push(part);
  }
  return out.join('/');
}

/**
 * Environment for a *nested* npm invocation.
 *
 * `npm run` exports this project's .npmrc settings into the environment as
 * `npm_config_*`, and a child npm inherits them verbatim. This repo's .npmrc
 * carries `allow-scripts=esbuild` (needed so esbuild's postinstall runs under
 * npm 11's script blocking), and npm 11 refuses an `allow-scripts` config in a
 * project-scoped install:
 *
 *   npm error --allow-scripts is not allowed in project-scoped installs.
 *
 * So `npm install ./mediaforge.tgz` inside the scratch directory failed with a
 * bare exit 1 and no message — it only failed when spawned from `npm run`, and
 * only on npm >= 11, which is why it passed locally and on the Node 20/22 legs
 * while Node 24 broke. The scratch install is not this project, so none of this
 * project's config applies to it. Dropping every inherited `npm_config_*` and
 * `npm_*` key makes the nested install behave like a fresh shell.
 */
function nestedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key.startsWith('npm_config_') || key === 'npm_lifecycle_event' || key === 'npm_lifecycle_script') continue;
    env[key] = value;
  }
  return env;
}

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // Only strip for npm: the ffmpeg/CLI probes must keep the real environment.
    env: command === 'npm' ? nestedEnv() : process.env,
  });
}

try {
  console.log('smoke: packing the tarball');
  const packOutput = run('npm', ['pack', '--silent', '--pack-destination', scratch], ROOT);
  const tarball = join(scratch, packOutput.trim().split('\n').pop()!.trim());
  check('npm pack produced a tarball', existsSync(tarball), tarball);

  // ── Manifest contents ──────────────────────────────────────────────────────
  console.log('\nsmoke: published file list');
  const contents = run('tar', ['-tzf', tarball], ROOT);
  const entries = contents
    .split('\n')
    .map((l) => l.replace(/^package\//, '').trim())
    .filter((l) => l !== '' && !l.endsWith('/'));

  // `lib` must ship or every .d.ts.map points at a file that is not published,
  // which silently breaks go-to-definition in a consumer's editor.
  const libSources = entries.filter((e) => e.startsWith('lib/') && e.endsWith('.ts'));
  check('lib/*.ts ships so declaration maps resolve', libSources.length > 0, `found ${libSources.length}`);

  // Declaration maps are the reason `lib` has to ship: their `sources` point at
  // `../../lib/*.ts`, which `npm pack` excludes unless it is in `files`. Resolve
  // every map's target and confirm it is actually in the tarball.
  const declared = new Set(entries);
  const missingTargets = new Set<string>();
  const mapEntries = entries.filter((e) => e.endsWith('.d.ts.map'));
  for (const entry of mapEntries) {
    const raw = execFileSync('tar', ['-xzOf', tarball, `package/${entry}`], { encoding: 'utf8' });
    for (const match of raw.matchAll(/"sources":\s*\[([^\]]*)\]/g)) {
      for (const spec of match[1]!.matchAll(/"([^"]+)"/g)) {
        const resolved = resolvePosix(join(dirname(entry), spec[1]!));
        if (!declared.has(resolved)) missingTargets.add(resolved);
      }
    }
  }
  check(
    `every .d.ts.map target ships in the tarball (${mapEntries.length} maps)`,
    missingTargets.size === 0,
    `missing: ${[...missingTargets].slice(0, 3).join(', ')}`,
  );

  // Declarations must not carry .ts specifiers.
  const declarationEntries = entries.filter((e) => e.startsWith('dist/') && e.endsWith('.d.ts'));
  let staleSpecifiers = 0;
  for (const entry of declarationEntries) {
    const raw = execFileSync('tar', ['-xzOf', tarball, `package/${entry}`], { encoding: 'utf8' });
    staleSpecifiers += [...raw.matchAll(/\bfrom\s+['"]\.{1,2}\/[^'"]+\.ts['"]/g)].length;
  }
  check(
    'published declarations use .js specifiers',
    staleSpecifiers === 0,
    `${staleSpecifiers} stale specifier(s)`,
  );

  check('the CLI has a shebang', readFileSync(join(ROOT, 'dist/esm/cli/index.js'), 'utf8').startsWith('#!'));

  // ── Install and exercise every entry point ────────────────────────────────
  console.log('\nsmoke: installing into a clean directory');
  run('npm', ['init', '-y', '--silent'], scratch);
  run('npm', ['install', tarball, '--silent', '--no-audit', '--no-fund'], scratch);

  // CJS require. Resolve by package *name*, not tarball path: requiring the
  // .tgz would make Node try to parse the archive as JavaScript. This is also
  // how a consumer really reaches the package.
  writeFileSync(
    join(scratch, 'check.cjs'),
    `const m = require('mediaforge');\n` +
      `const names = Object.keys(m);\n` +
      `if (names.length < 300) throw new Error('too few exports: ' + names.length);\n` +
      `if (typeof m.ffmpeg !== 'function') throw new Error('ffmpeg is not a function');\n` +
      `const e = new m.FFmpegError('x', 'TIMEOUT');\n` +
      `if (!(e instanceof m.FFmpegError) || e.code !== 'TIMEOUT') throw new Error('error taxonomy broken');\n` +
      `console.log('CJS_OK ' + names.length);\n`,
  );
  const cjs = run('node', [join(scratch, 'check.cjs')], scratch);
  check('CJS require works', /CJS_OK \d+/.test(cjs), cjs.trim());

  // ESM import
  writeFileSync(
    join(scratch, 'check.mjs'),
    `import * as m from 'mediaforge';\n` +
      `const names = Object.keys(m);\n` +
      `if (names.length < 300) throw new Error('too few exports: ' + names.length);\n` +
      `if (typeof m.withAtomicOutput !== 'function') throw new Error('withAtomicOutput missing');\n` +
      `console.log('ESM_OK ' + names.length);\n`,
  );
  const esm = run('node', [join(scratch, 'check.mjs')], scratch);
  check('ESM import works', /ESM_OK \d+/.test(esm), esm.trim());

  // The installed bin, on every runtime available here.
  const bin = join(scratch, 'node_modules', '.bin', 'mediaforge');
  check('the bin was linked', existsSync(bin), bin);

  const versionOut = run(bin, ['version'], scratch);
  check('the installed CLI runs', /ffmpeg version/.test(versionOut), versionOut.split('\n')[0]);

  // Exit codes must survive the build.
  let unknownCode = 0;
  try {
    execFileSync(bin, ['definitely-not-a-command'], { cwd: scratch, stdio: 'ignore' });
  } catch (error) {
    unknownCode = (error as { status?: number }).status ?? -1;
  }
  check('the installed CLI reports usage errors as exit 2', unknownCode === 2, `got ${unknownCode}`);

  // stdout piping must not deadlock in the published build.
  const piped = execFileSync(
    bin,
    ['-f', 'lavfi', '-i', 'testsrc=duration=0.3:size=64x64:rate=10', '-frames:v', '1', '-f', 'mjpeg', 'pipe:1'],
    { cwd: scratch, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  check('the installed CLI can pipe to stdout', piped.length > 100, `${piped.length} bytes`);

  console.log(`\nsmoke: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}