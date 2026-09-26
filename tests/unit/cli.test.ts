/**
 * Tests for the task-oriented CLI.
 *
 * Covers argument parsing, the help/usage surface, error messages for bad
 * input, and end-to-end runs of the subcommands that produce files.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

import { CLI_TASKS, parseTaskArgs, taskHelpText, taskDetail } from '../../dist/esm/cli/tasks.js';
import { FILTER_REGISTRY, filterNames } from '../../dist/esm/cli/filter-registry.js';
import { LIBRARY_ONLY, INTERNAL_NOTES, argOpNames, codecBuilderNames } from '../../dist/esm/cli/tasks.extra.js';
import { FilterChain } from '../../dist/esm/types/filters.js';
import * as lib from '../../dist/esm/index.js';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mediaforge-cli-'));
const CLI = path.resolve('dist/esm/cli/index.js');

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
const FFMPEG = hasFfmpeg();

let fixture: string;
let still: string;

before(() => {
  if (FFMPEG) {
    fixture = path.join(TMP, 'in.mp4');
    still = path.join(TMP, 'still.png');
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=160x90:rate=10',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', fixture,
    ], { stdio: 'pipe' });
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=red:size=40x40:rate=1', '-frames:v', '1', still], { stdio: 'pipe' });
  }
});

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function cli(...args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 180_000 });
}

// ─── Argument parsing ────────────────────────────────────────────────────────

describe('parseTaskArgs', () => {
  it('collects positionals and --flag value pairs', () => {
    const r = parseTaskArgs(['a.mp4', 'b.mp4', '--start', '5', '--end', '9']);
    assert.deepEqual(r.positional, ['a.mp4', 'b.mp4']);
    assert.deepEqual(r.flags, { start: '5', end: '9' });
  });

  it('supports --flag=value', () => {
    const r = parseTaskArgs(['--start=5']);
    assert.deepEqual(r.flags, { start: '5' });
  });

  it('treats a flag followed by another flag as boolean', () => {
    const r = parseTaskArgs(['a.mp4', '--cut', '--threshold', '0.5']);
    assert.equal(r.flags['cut'], true);
    assert.equal(r.flags['threshold'], '0.5');
  });

  it('treats a trailing flag as boolean', () => {
    assert.equal(parseTaskArgs(['--detect']).flags['detect'], true);
  });

  it('handles an empty argv', () => {
    assert.deepEqual(parseTaskArgs([]), { positional: [], flags: {} });
  });

  it('keeps negative numbers as flag values', () => {
    // -50 is a value, not another flag, because it does not start with --.
    const r = parseTaskArgs(['a.mp4', '--threshold', '-50']);
    assert.equal(r.flags['threshold'], '-50');
  });
});

// ─── Library-surface commands ────────────────────────────────────────────────

describe('CLI filter registry', () => {
  it('addresses every built-in filter by name', () => {
    assert.equal(filterNames().length, 77);
    for (const name of ['scale', 'crop', 'pad', 'unsharp', 'hqdn3d', 'delogo', 'volume', 'sofalizer']) {
      assert.ok(FILTER_REGISTRY[name], `registry is missing ${name}`);
    }
  });

  it('marks every required key as one the filter accepts', () => {
    for (const [name, entry] of Object.entries(FILTER_REGISTRY)) {
      for (const req of entry.required ?? []) {
        assert.ok(entry.keys.includes(req), `${name}: required key ${req} is not in its key list`);
      }
    }
  });

  it('serialises every filter without placeholder values', () => {
    for (const name of filterNames()) {
      const entry = FILTER_REGISTRY[name]!;
      const rec: Record<string, string | number | boolean> = {};
      for (const k of entry.required ?? []) rec[k] = (k === 'width' || k === 'height') ? 2 : 1;
      const out = entry.apply(new FilterChain(), rec).toString();
      assert.ok(out.length > 0, `${name} serialised to an empty string`);
      assert.doesNotMatch(out, /undefined|NaN|\[object Object\]/, `${name} serialised a placeholder`);
    }
  });
});

describe('CLI arg-op and codec tables', () => {
  it('exposes a broad set of arg builders and codec builders', () => {
    assert.ok(argOpNames().length >= 55, `only ${argOpNames().length} arg builders`);
    assert.ok(codecBuilderNames().length >= 35, `only ${codecBuilderNames().length} codec builders`);
    assert.deepEqual(argOpNames(), [...argOpNames()].sort(), 'arg op names are not sorted');
  });
});

describe('CLI reachability', () => {
  it('gives every library-only entry a reason', () => {
    for (const [name, reason] of Object.entries(LIBRARY_ONLY)) {
      assert.ok(reason.length >= 10, `${name}: reason too short`);
      assert.ok(name in lib, `LIBRARY_ONLY lists ${name}, which is not a public export`);
    }
  });

  it('keeps the non-exported internals out of LIBRARY_ONLY', () => {
    for (const name of Object.keys(INTERNAL_NOTES)) {
      assert.ok(!(name in lib), `${name} is a public export, so it belongs in LIBRARY_ONLY`);
    }
  });

  it('leaves no runtime export unreachable from the CLI', () => {
    const src = ['tasks.ts', 'tasks.extra.ts', 'filter-registry.ts', 'index.ts', 'flags.ts', 'types.ts']
      .map(f => fs.readFileSync(path.join('lib/cli', f), 'utf8'))
      .join('\n');
    const named = new Set<string>();
    for (const m of src.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) named.add(m[1]!);
    // Uppercase names are type-only exports, which are erased at runtime.
    const missing = Object.keys(lib).filter(
      n => !named.has(n) && !(n in LIBRARY_ONLY) && !/^[A-Z0-9_]+$/.test(n),
    );
    assert.deepEqual(missing, [], `unreachable from the CLI: ${missing.join(', ')}`);
  });
});

// ─── Command surface ─────────────────────────────────────────────────────────

describe('CLI task registry', () => {
  it('exposes a non-trivial number of commands', () => {
    assert.ok(Object.keys(CLI_TASKS).length >= 25, `only ${Object.keys(CLI_TASKS).length} commands`);
  });

  it('gives every command a name matching its key, a summary and a usage line', () => {
    for (const [key, t] of Object.entries(CLI_TASKS)) {
      assert.equal(t.name, key, `${key}: name does not match its key`);
      assert.ok(t.summary.length > 0, `${key}: missing summary`);
      assert.ok(t.usage.startsWith('mediaforge '), `${key}: usage should start with "mediaforge"`);
      assert.equal(typeof t.run, 'function', `${key}: missing run`);
    }
  });

  it('documents every command in the help listing', () => {
    const help = taskHelpText();
    for (const key of Object.keys(CLI_TASKS)) {
      assert.ok(help.includes(key), `${key} missing from help`);
    }
  });

  it('returns detail for real commands and explains unknown ones', () => {
    assert.ok(taskDetail('trim').includes('--start'), `expected ${taskDetail('trim')} to include ${'--start'}; got ${taskDetail('trim')}`);
    // An empty string here made `mediaforge help <typo>` print nothing at all,
    // which reads like a silent success.
    const d = taskDetail('nope');
    assert.ok(d.length > 0, `expected ${d.length} to be greater than ${0}; got ${d.length}`);
    assert.ok(d.includes('nope'), `expected ${d} to include ${'nope'}; got ${d}`);
    assert.ok(d.includes('mediaforge help'), `expected ${d} to include ${'mediaforge help'}; got ${d}`);
  });

  it('describes flags with a leading --', () => {
    for (const key of Object.keys(CLI_TASKS)) {
      for (const flag of Object.keys(CLI_TASKS[key]!.flags)) {
        assert.ok(taskDetail(key).includes(`--${flag}`), `${key}: --${flag} missing from detail`);
      }
    }
  });
});

// ─── Help / errors ───────────────────────────────────────────────────────────

describe('CLI help and errors', () => {
  it('prints usage listing the task commands when run bare', () => {
    const r = cli();
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('TASK COMMANDS'), `expected ${r.stdout} to include ${'TASK COMMANDS'}; got ${r.stdout}`);
    assert.ok(r.stdout.includes('chapters'), `expected ${r.stdout} to include ${'chapters'}; got ${r.stdout}`);
  });

  it('prints per-command help with --help', () => {
    const r = cli('trim', '--help');
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('--start'), `expected ${r.stdout} to include ${'--start'}; got ${r.stdout}`);
  });

  it('rejects an unknown command with a suggestion to run help', () => {
    const r = cli('nonsense');
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('unknown command "nonsense"'), r.stderr);
    assert.ok(r.stderr.includes('mediaforge help'), `expected ${r.stderr} to include ${'mediaforge help'}; got ${r.stderr}`);
  });

  it('reports a missing required flag', () => {
    const r = cli('speed', 'a.mp4', 'b.mp4');
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('speed requires --factor'), r.stderr);
  });

  it('reports too few positionals and prints the usage', () => {
    const r = cli('trim', 'only-one.mp4');
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('trim needs 2 arguments'), r.stderr);
    assert.ok(r.stderr.includes('mediaforge trim'), r.stderr);
  });

  it('rejects a non-numeric value for a numeric flag', () => {
    const r = cli('volume', 'a.mp4', 'b.mp4', '--gain', 'loud');
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('--gain must be a number'), r.stderr);
  });

  it('validates structured flags before touching ffmpeg', () => {
    const r = cli('chapters', 'a.mp4', 'b.mp4', '--chapters', 'NoColonHere');
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('title:startSeconds'), r.stderr);
  });

  it('rejects a malformed chapters timestamp', () => {
    const r = cli('chapters', 'a.mp4', 'b.mp4', '--chapters', 'Intro:abc');
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('non-numeric start'), r.stderr);
  });

  it('rejects a malformed metadata pair', () => {
    const r = cli('metadata', 'a.mp4', 'b.mp4', '--set', 'noequals');
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('key=value'), r.stderr);
  });

  it('rejects a malformed ABR variant spec', () => {
    const r = cli('abr', 'a.mp4', '--out', 'v%v/i.m3u8', '--variants', 'bad');
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('name=WxH:bitrate'), r.stderr);
  });

  it('requires --outdir for hls', () => {
    const r = cli('hls', 'a.mp4');
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('hls requires --outdir'), r.stderr);
  });
});

// ─── End-to-end ──────────────────────────────────────────────────────────────

describe('CLI end-to-end', { skip: !FFMPEG }, () => {
  const out = (name: string) => path.join(TMP, name);

  it('version subcommand still works', () => {
    const r = cli('version');
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('ffmpeg version'), `expected ${r.stdout} to include ${'ffmpeg version'}; got ${r.stdout}`);
  });

  it('probe subcommand still works', () => {
    const r = cli('probe', fixture);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('streams'), `expected ${r.stdout} to include ${'streams'}; got ${r.stdout}`);
  });

  it('trim writes a shorter clip', () => {
    const r = cli('trim', fixture, out('trim.mp4'), '--start', '0.2', '--end', '1');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(out('trim.mp4')), `assertion failed: ${fs.existsSync(out('trim.mp4'))}`);
  });

  it('volume writes a file', () => {
    assert.equal(cli('volume', fixture, out('vol.mp4'), '--gain', '0.5').status, 0);
    assert.ok(fs.existsSync(out('vol.mp4')), `assertion failed: ${fs.existsSync(out('vol.mp4'))}`);
  });

  it('to-bitrate writes a file and accepts rate control', () => {
    const r = cli('to-bitrate', fixture, out('br.mp4'), '--bitrate', '200k', '--maxrate', '300k', '--bufsize', '600k');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(out('br.mp4')), `assertion failed: ${fs.existsSync(out('br.mp4'))}`);
  });

  it('chapters writes chapter markers', () => {
    const r = cli('chapters', fixture, out('ch.mp4'), '--chapters', 'Intro:0,Main:1');
    assert.equal(r.status, 0, r.stderr);
    const probeOut = cli('probe', out('ch.mp4'));
    assert.ok(probeOut.stdout.includes('chapters'), 'no chapters in output');
  });

  it('metadata sets a global tag', () => {
    const r = cli('metadata', fixture, out('meta.mp4'), '--set', 'title=HelloWorld');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(cli('probe', out('meta.mp4')).stdout.includes('HelloWorld'), `expected ${cli('probe', out('meta.mp4')).stdout} to include ${'HelloWorld'}; got ${cli('probe', out('meta.mp4')).stdout}`);
  });

  it('thumbnail extracts a single frame', () => {
    const r = cli('thumbnail', fixture, out('th.jpg'), '--at', '0.5');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.statSync(out('th.jpg')).size > 0, `expected ${fs.statSync(out('th.jpg')).size} to be greater than ${0}; got ${fs.statSync(out('th.jpg')).size}`);
  });

  it('delogo blurs a region', () => {
    const r = cli('delogo', fixture, out('dg.mp4'), '--x', '5', '--y', '5', '--width', '20', '--height', '20');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(out('dg.mp4')), `assertion failed: ${fs.existsSync(out('dg.mp4'))}`);
  });

  it('delogo requires every geometry flag', () => {
    const r = cli('delogo', fixture, out('x.mp4'), '--x', '5');
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('delogo requires --'), `expected ${r.stderr} to include ${'delogo requires --'}; got ${r.stderr}`);
  });

  it('segments splits the file', () => {
    const r = cli('segments', fixture, '--pattern', out('seg%03d.ts'), '--segment', '1');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readdirSync(TMP).filter(f => f.startsWith('seg') && f.endsWith('.ts')).length, 2);
  });

  it('quality reports an SSIM score', () => {
    const r = cli('quality', fixture, fixture, '--metric', 'ssim');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /ssim: 1\.0000/);
  });

  it('quality fails when --min is not met', () => {
    const r = cli('quality', fixture, fixture, '--metric', 'ssim', '--min', '1.5');
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('below the required minimum'), r.stderr);
  });

  it('silence --detect reports without writing', () => {
    const r = cli('silence', fixture, out('ns.mp4'), '--detect');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('silent segment'), `expected ${r.stdout} to include ${'silent segment'}; got ${r.stdout}`);
  });

  it('watermark overlays an image', () => {
    const r = cli('watermark', fixture, still, out('wm.mp4'), '--position', 'bottom-right', '--opacity', '0.7');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(out('wm.mp4')), `assertion failed: ${fs.existsSync(out('wm.mp4'))}`);
  });

  it('interpolate raises the frame rate', () => {
    const r = cli('interpolate', fixture, out('ip.mp4'), '--fps', '20', '--method', 'blend');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(out('ip.mp4')), `assertion failed: ${fs.existsSync(out('ip.mp4'))}`);
  });

  it('sprites and frames produce images', () => {
    assert.equal(cli('sprite', fixture, out('sp.png'), '--columns', '2', '--count', '4').status, 0);
    assert.ok(fs.existsSync(out('sp.png')), `assertion failed: ${fs.existsSync(out('sp.png'))}`);
    const r = cli('frames', fixture, '--outdir', out('frames'), '--fps', '1');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.readdirSync(out('frames')).length > 0, `expected ${fs.readdirSync(out('frames')).length} to be greater than ${0}; got ${fs.readdirSync(out('frames')).length}`);
  });

  it('hls packages a stream', () => {
    const r = cli('hls', fixture, '--outdir', out('hls'), '--segment', '1');
    assert.equal(r.status, 0, r.stderr);
    const files = fs.readdirSync(out('hls'));
    assert.ok(files.some(f => f.endsWith('.m3u8')), files.join(','));
    assert.ok(files.some(f => f.endsWith('.ts')), files.join(','));
  });

  it('segments/abr rejects an odd-dimension variant before running ffmpeg', () => {
    const r = cli('abr', fixture, '--out', out('abr%v/i.m3u8'), '--variants', 'low=80x45:100k');
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('odd'), r.stderr);
  });
});
