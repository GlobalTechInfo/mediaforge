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
 * Environment and invocation for a *nested* npm call.
 *
 * Two platform/npm traps, both of which only show up on one leg of the matrix:
 *
 * 1. `npm_config_*` inheritance. `npm run` exports this project's .npmrc
 *    settings into the environment, and a child npm inherits them verbatim. This
 *    repo's .npmrc carries `allow-scripts=esbuild` (needed so esbuild's
 *    postinstall runs under npm 11's script blocking), and npm 11 refuses an
 *    `allow-scripts` config in a project-scoped install:
 *    `npm error --allow-scripts is not allowed in project-scoped installs`.
 *    So `npm install ./mediaforge.tgz` in the scratch directory died with a bare
 *    exit 1 and no message - only under `npm run`, and only on npm >= 11, which
 *    is why it passed locally and on Node 20/22 while Node 24 broke. The scratch
 *    install is not this project, so none of this project's config applies.
 *
 * 2. Windows has no `npm` binary, only `npm.cmd`, and Node refuses to execute a
 *    `.cmd` without a shell (the BatBadBut fix). Going through the shell is only
 *    safe if the arguments are quoted first, since it does not quote them itself.
 *
 * Returns the command, its leading arguments, and the environment to use.
 */
function npmInvocation(): { cmd: string; args: string[]; env: NodeJS.ProcessEnv } {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key.startsWith('npm_config_') || key === 'npm_lifecycle_event' || key === 'npm_lifecycle_script') continue;
    env[key] = value;
  }
  if (process.platform !== 'win32') return { cmd: 'npm', args: [], env };
  // cmd.exe does not quote its arguments, so quote anything with a space in it.
  return {
    cmd: 'npm.cmd',
    args: [],
    env,
  };
}

/** Run a non-npm command with the real environment (ffmpeg, the CLI, deno, bun). */
function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function runNpm(args: string[], cwd: string): string {
  const inv = npmInvocation();
  const quoted = process.platform === 'win32'
    ? args.map((a) => (/\s/.test(a) ? `"${a}"` : a))
    : args;
  return execFileSync(inv.cmd, [...inv.args, ...quoted], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: inv.env,
    // Required on Windows: Node will not run a `.cmd` without a shell.
    shell: process.platform === 'win32',
  });
}


try {
  console.log('smoke: packing the tarball');
  const packOutput = runNpm(['pack', '--silent', '--pack-destination', scratch], ROOT);
  const tarball = join(scratch, packOutput.trim().split('\n').pop()!.trim());
  check('npm pack produced a tarball', existsSync(tarball), tarball);

  // ── Manifest contents ──────────────────────────────────────────────────────
  console.log('\nsmoke: published file list');
  const contents = run('tar', ['-tzf', tarball], ROOT);
  // Normalise to forward slashes. `tar` prints `package/lib/utils/args.ts` on
  // Unix but `package\lib\utils\args.ts` on Windows, so the entry list did not
  // match the paths inside the .d.ts.map files (which always use '/'), and the
  // check below reported sources as missing that were present in the tarball.
  const entries = contents
    .split('\n')
    .map((l) => l.replace(/^package[\\/]/, '').replace(/\\/g, '/').trim())
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
        // Join with '/' rather than path.join: source maps are POSIX-style and
        // resolvePosix splits on '/', but path.join emits '\' on Windows, so
        // the resolved target came out as `lib\utils\args.ts` and matched
        // nothing in the (correctly normalised) entry list.
        const resolved = resolvePosix(`${dirname(entry)}/${spec[1]!}`);
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
  runNpm(['init', '-y', '--silent'], scratch);
  runNpm(['install', tarball, '--silent', '--no-audit', '--no-fund'], scratch);

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
  //
  // npm writes a POSIX shell shim on Unix but a `.cmd` shim on Windows, and Node
  // will not run a `.cmd` without a shell. Spawning the extensionless path - as
  // this did - fails with ENOENT there even though the install succeeded, which
  // reads like a broken package rather than a broken test. Prefer the real
  // executable the shim points at when one exists, so the CLI is exercised
  // directly and identically on every platform.
  const binDir = join(scratch, 'node_modules', '.bin');
  const shim = join(binDir, 'mediaforge');
  const jsEntry = join(scratch, 'node_modules', 'mediaforge', 'dist', 'esm', 'cli', 'index.js');
  const useNodeEntry = process.platform === 'win32' && existsSync(jsEntry);
  const bin: [string, ...string[]] = useNodeEntry ? [process.execPath, jsEntry] : [shim];
  check('the bin was linked', existsSync(shim), shim);

  const versionOut = run(bin[0], bin.slice(1).concat('version'), scratch);
  check('the installed CLI runs', /ffmpeg version/.test(versionOut), versionOut.split('\n')[0]);

  // Exit codes must survive the build.
  let unknownCode = 0;
  try {
    execFileSync(bin[0], bin.slice(1).concat('definitely-not-a-command'), { cwd: scratch, stdio: 'ignore' });
  } catch (error) {
    unknownCode = (error as { status?: number }).status ?? -1;
  }
  check('the installed CLI reports usage errors as exit 2', unknownCode === 2, `got ${unknownCode}`);

  // stdout piping must not deadlock in the published build.
  const piped = execFileSync(
    bin[0],
    bin.slice(1).concat([
      '-f', 'lavfi', '-i', 'testsrc=duration=0.3:size=64x64:rate=10',
      '-frames:v', '1', '-f', 'mjpeg', 'pipe:1',
    ]),
    { cwd: scratch, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  check('the installed CLI can pipe to stdout', piped.length > 100, `${piped.length} bytes`);

  console.log(`\nsmoke: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}