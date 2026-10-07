/**
 * Cross-runtime check of the *installed* package.
 *
 * `scripts/smoke.ts` exercises the published artefact under Node. This does the
 * equivalent for Deno and Bun, because the package resolves three different ways
 * for a consumer depending on the runtime:
 *
 *  - Node reads `exports` and picks `dist/esm` or `dist/cjs`
 *  - Deno reads the `exports` map in `deno.json` and may prefer raw `lib/*.ts`
 *  - Bun resolves the `exports` map with its own algorithm
 *
 * A fault confined to one of those is invisible to the other two, which is why
 * each runtime gets its own check rather than a shared one.
 *
 * Usage:  deno run -A scripts/smoke-deno.ts
 *         bun run scripts/smoke-bun.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNTIME =
  typeof (globalThis as Record<string, unknown>)['Deno'] === 'object'
    ? 'deno'
    : typeof (globalThis as Record<string, unknown>)['Bun'] === 'object'
      ? 'bun'
      : 'node';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), `mediaforge-smoke-${RUNTIME}-`));

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
  console.log(`smoke(${RUNTIME}): packing and installing`);

  const packOutput = run('npm', ['pack', '--silent', '--pack-destination', scratch], ROOT);
  const tarball = join(scratch, packOutput.trim().split('\n').pop()!.trim());

  run('npm', ['init', '-y', '--silent'], scratch);
  run('npm', ['install', tarball, '--silent', '--no-audit', '--no-fund'], scratch);

  const installed = join(scratch, 'node_modules', 'mediaforge');
  check('installed into node_modules', true, installed);

  // ── Resolve the package by name, as a consumer would ───────────────────────
  const probeScript = join(scratch, `probe.${RUNTIME === 'deno' ? 'ts' : 'mjs'}`);
  writeFileSync(
    probeScript,
    `import * as m from 'mediaforge';\n` +
      `const names = Object.keys(m);\n` +
      `if (names.length < 300) throw new Error('too few exports: ' + names.length);\n` +
      `if (typeof m.ffmpeg !== 'function') throw new Error('ffmpeg is not a function');\n` +
      `if (typeof m.withAtomicOutput !== 'function') throw new Error('withAtomicOutput missing');\n` +
      `const args = m.ffmpeg('in.mp4').output('out.mp4').dry();\n` +
      `if (!Array.isArray(args) || args.length === 0) throw new Error('dry() produced nothing');\n` +
      `const e = new m.FFmpegError('x', 'TIMEOUT');\n` +
      `if (!(e instanceof m.FFmpegError) || e.code !== 'TIMEOUT') throw new Error('error taxonomy broken');\n` +
      `console.log('PROBE_OK ' + names.length);\n`,
  );

  const output =
    RUNTIME === 'deno'
      ? run('deno', ['run', '-A', '--node-modules-dir=manual', probeScript], scratch)
      : run('bun', ['run', probeScript], scratch);

  check(
    `package resolves by name under ${RUNTIME}`,
    /PROBE_OK \d+/.test(output),
    output.trim(),
  );

  // ── The installed CLI runs on this runtime ───────────────────────────────
  // Invoke the installed entry point directly rather than through the .bin
  // shim: the shim is a Node shebang script, which `bun run` and `deno run`
  // each interpret differently. The published JS is what matters here.
  const cliJs = join(installed, 'dist', 'esm', 'cli', 'index.js');

  const cliRun =
    RUNTIME === 'deno'
      ? run('deno', ['run', '-A', cliJs, 'version'], scratch)
      : run('bun', ['run', cliJs, 'version'], scratch);
  check(`installed CLI runs under ${RUNTIME}`, /ffmpeg version/.test(cliRun), cliRun.split('\n')[0]);

  // Exit codes must survive packaging.
  let code = 0;
  try {
    if (RUNTIME === 'deno') {
      execFileSync('deno', ['run', '-A', '--node-modules-dir=manual', cliJs, 'definitely-not-a-command'], {
        cwd: scratch,
        stdio: 'ignore',
      });
    } else {
      execFileSync('bun', ['run', cliJs, 'definitely-not-a-command'], { cwd: scratch, stdio: 'ignore' });
    }
  } catch (error) {
    code = (error as { status?: number }).status ?? -1;
  }
  check(`installed CLI exits 2 on a usage error under ${RUNTIME}`, code === 2, `got ${code}`);

  // stdout piping must not deadlock in the published build.
  const pipeArgs = [
    '-f', 'lavfi', '-i', 'testsrc=duration=0.3:size=64x64:rate=10',
    '-frames:v', '1', '-f', 'mjpeg', 'pipe:1',
  ];
  const piped =
    RUNTIME === 'deno'
      ? execFileSync('deno', ['run', '-A', '--node-modules-dir=manual', cliJs, ...pipeArgs], {
          cwd: scratch,
          maxBuffer: 8 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      : execFileSync('bun', ['run', cliJs, ...pipeArgs], {
          cwd: scratch,
          maxBuffer: 8 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
  check(`installed CLI pipes to stdout under ${RUNTIME}`, piped.length > 100, `${piped.length} bytes`);

  console.log(`\nsmoke(${RUNTIME}): ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}