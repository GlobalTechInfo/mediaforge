/**
 * Regression tests for the findings of the second full-codebase audit.
 *
 * Each block corresponds to a real defect that shipped: several of these were
 * only reproducible because the audit installed a real ffmpeg and inspected the
 * emitted argument vectors rather than trusting the happy-path battle tests.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { hlsPackage, adaptiveHls, dashPackage } from '../../dist/esm/helpers/hls.js';
import { buildSpectrumFilter, generateSpectrum, SPECTRUM_COLORS } from '../../dist/esm/helpers/waveform.js';
import { buildLoudnormFilter } from '../../dist/esm/helpers/normalize.js';
import { addChapters } from '../../dist/esm/helpers/metadata.js';
import { buildHlsArgs } from '../../dist/esm/helpers/hls.js';
import { parseDuration, parseFrameRate, formatDuration, getChapterList, probe } from '../../dist/esm/probe/ffprobe.js';

const TMP = path.join(process.cwd(), 'tmp', 'scanfix');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const FFMPEG = hasFfmpeg();

/** Tiny generated clip, used by the tests that need a real encoder run. */
const FIXTURE = path.join(TMP, 'fixture.mp4');
if (FFMPEG) {
  execFileSync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=160x90:rate=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-pix_fmt', 'yuv420p',
    FIXTURE,
  ], { stdio: 'pipe' });
}

// ─── F1: the build's global `sed` used to rewrite every string ending in `.ts` ──
describe('build pipeline does not corrupt .ts string literals', () => {
  it('emits the documented .ts HLS segment defaults (not .js)', () => {
    const args = (hlsPackage({ input: 'in.mp4', outputDir: 'out' }) as unknown as { buildArgs(): string[] }).buildArgs();
    const seg = args.find(a => a.includes('segment%'));
    assert.ok(seg !== undefined, `no segment filename emitted: ${args.join(' ')}`);
    assert.ok(seg.endsWith('.ts'), `expected .ts segments, got: ${seg}`);
  });

  it('import specifiers in dist are rewritten to .js', () => {
    const src = fs.readFileSync('dist/esm/helpers/concat.js', 'utf8');
    assert.ok(src.includes("../process/spawn.js"), 'relative import must be rewritten to .js');
    assert.ok(!/from ['"][^'"]+\.ts['"]/.test(src), 'no import specifier may still end in .ts');
  });
});

// ─── F2/F3: packaging helpers must create their output directories ────────────
describe('packaging helpers create their output directories', () => {
  it('buildHlsArgs puts -f hls before the private hls_* options', () => {
    const args = buildHlsArgs('in.mp4', 'out', { hlsFlags: 'independent_segments' });
    assert.ok(args.indexOf('-f') < args.indexOf('-hls_time'), 'output format must precede output-private options');
  });

  it('hlsPackage emits -hls_version only when asked, and validates it', () => {
    const withV = hlsPackage({ input: 'a.mp4', outputDir: 'o', hlsVersion: 6 });
    assert.ok(JSON.stringify((withV as unknown as { buildArgs(): string[] }).buildArgs()).includes('-hls_version'), `expected ${JSON.stringify((withV as unknown as { buildArgs(): string[] }).buildArgs())} to include ${'-hls_version'}; got ${JSON.stringify((withV as unknown as { buildArgs(): string[] }).buildArgs())}`);
    assert.throws(() => hlsPackage({ input: 'a.mp4', outputDir: 'o', hlsVersion: 2 }), /between 3 and 8/);
    assert.throws(() => hlsPackage({ input: 'a.mp4', outputDir: 'o', hlsVersion: 99 }), /between 3 and 8/);
  });

  it('hlsPackage creates outputDir instead of silently writing nothing', { skip: !FFMPEG }, async () => {
    const dir = path.join(TMP, 'hls_new_dir');
    assert.ok(!fs.existsSync(dir), 'precondition: dir must not exist yet');
    await hlsPackage({ input: FIXTURE, outputDir: dir, videoCodec: 'libx264', audioCodec: 'aac', videoBitrate: '200k', audioBitrate: '64k' }).run();
    const files = fs.readdirSync(dir);
    assert.ok(files.some(f => f.endsWith('.m3u8')), 'playlist was not written');
    assert.ok(files.some(f => f.endsWith('.ts')), `expected .ts segments, got ${files.join(', ')}`);
  });

  it('dashPackage creates the parent dir of the manifest', { skip: !FFMPEG }, async () => {
    const dir = path.join(TMP, 'dash_new_dir');
    assert.ok(!fs.existsSync(dir), `assertion failed: ${!fs.existsSync(dir)}`);
    await dashPackage({ input: FIXTURE, output: path.join(dir, 'out.mpd'), videoCodec: 'libx264', audioCodec: 'aac', videoBitrate: '200k', audioBitrate: '64k' }).run();
    assert.ok(fs.existsSync(path.join(dir, 'out.mpd')), `assertion failed: ${fs.existsSync(path.join(dir, 'out.mpd'))}`);
  });
});

// ─── F4: showspectrum's color is a palette enum, not a CSS colour ─────────────
describe('showspectrum color is validated as a palette name', () => {
  it('accepts the documented palettes', () => {
    for (const c of SPECTRUM_COLORS) {
      assert.ok(buildSpectrumFilter(320, 180, c, 25).includes(`color=${c}`), `expected ${buildSpectrumFilter(320, 180, c, 25)} to include ${`color=${c}`}; got ${buildSpectrumFilter(320, 180, c, 25)}`);
    }
  });

  it('rejects CSS colours that lookspectrum cannot parse', () => {
    for (const bad of ['red', '#ff0000', 'rgb(255,0,0)']) {
      assert.throws(() => buildSpectrumFilter(320, 180, bad as never, 25), /palette name, not a CSS colour/);
    }
  });

  it('"green" is a palette while "red" is not — the trap the enum creates', () => {
    assert.ok(SPECTRUM_COLORS.includes('green' as never), `expected ${SPECTRUM_COLORS} to include ${'green' as never}; got ${SPECTRUM_COLORS}`);
    assert.ok(!SPECTRUM_COLORS.includes('red' as never), `expected ${!SPECTRUM_COLORS} to include ${'red' as never}; got ${!SPECTRUM_COLORS}`);
  });
});

// ─── F5: buildLoudnormFilter must never emit `offset=undefined` ────────────────
describe('buildLoudnormFilter measured handling', () => {
  it('accepts the camelCase parseLoudnorm() result', () => {
    const f = buildLoudnormFilter(-16, 11, -1, { inputI: -20, inputLra: 8, inputTp: -3, inputThresh: -30 });
    assert.ok(f.includes('measured_i=-20'), `expected ${f} to include ${'measured_i=-20'}; got ${f}`);
    assert.ok(f.includes('measured_thresh=-30'), `expected ${f} to include ${'measured_thresh=-30'}; got ${f}`);
    assert.ok(!f.includes('undefined'), f);
  });

  it('accepts the snake_case spelling ffmpeg prints', () => {
    const f = buildLoudnormFilter(-16, 11, -1, { input_i: -20, input_lra: 8, input_tp: -3, input_thresh: -30 });
    assert.ok(f.includes('measured_i=-20'), `expected ${f} to include ${'measured_i=-20'}; got ${f}`);
    assert.ok(f.includes('measured_thresh=-30'), `expected ${f} to include ${'measured_thresh=-30'}; got ${f}`);
    assert.ok(!f.includes('undefined'), f);
  });

  it('omits offset entirely when targetOffset is absent', () => {
    const f = buildLoudnormFilter(-16, 11, -1, { inputI: -20, inputLra: 8, inputTp: -3, inputThresh: -30 });
    assert.ok(!f.includes('offset='), f);
    assert.ok(f.includes('linear=true'), `expected ${f} to include ${'linear=true'}; got ${f}`);
  });

  it('emits offset when supplied', () => {
    const f = buildLoudnormFilter(-16, 11, -1, { inputI: -20, inputLra: 8, inputTp: -3, inputThresh: -30, targetOffset: 0.3 });
    assert.ok(f.includes('offset=0.3'), f);
  });

  it('rejects a measured object with unusable values', () => {
    assert.throws(
      () => buildLoudnormFilter(-16, 11, -1, { inputI: NaN, inputLra: 8, inputTp: -3, inputThresh: -30 }),
      /missing or not a finite number/,
    );
  });
});

// ─── F6: adaptiveHls must fail with a readable message, not a TypeError ────────
describe('adaptiveHls validates variants', () => {
  it('rejects a missing resolution with a helpful message', () => {
    assert.throws(
      () => adaptiveHls({ input: 'a.mp4', outputDir: TMP, variants: [{ label: 'a', videoBitrate: '1M' } as never] }),
      /missing a "resolution"/,
    );
  });

  it('rejects a missing label with a helpful message', () => {
    assert.throws(
      () => adaptiveHls({ input: 'a.mp4', outputDir: TMP, variants: [{ resolution: '320x180', videoBitrate: '1M' } as never] }),
      /missing a non-empty "label"/,
    );
  });

  it('rejects a partial resolution like "1920x"', () => {
    assert.throws(
      () => adaptiveHls({ input: 'a.mp4', outputDir: TMP, variants: [{ label: 'a', resolution: '1920x', videoBitrate: '1M' }] }),
      /Invalid resolution/,
    );
  });

  it('rejects an empty variant list', () => {
    assert.throws(() => adaptiveHls({ input: 'a.mp4', outputDir: TMP, variants: [] }), /at least one variant/);
  });
});

// ─── F7: addChapters must not silently write START=NaN ────────────────────────
describe('addChapters validates chapter definitions', () => {
  it('rejects a chapter with no usable start time', async () => {
    await assert.rejects(
      () => addChapters({ input: 'a.mp4', output: path.join(TMP, 'x.mp4'), chapters: [{ title: 'A' }] }),
      /needs a finite, non-negative start time/,
    );
  });

  it('rejects chapters that are not in ascending time order', async () => {
    await assert.rejects(
      () => addChapters({
        input: 'a.mp4', output: path.join(TMP, 'x.mp4'),
        chapters: [{ title: 'A', start: 2 }, { title: 'B', start: 1 }],
      }),
      /ascending time order/,
    );
  });

  it('rejects an empty chapter list', async () => {
    await assert.rejects(
      () => addChapters({ input: 'a.mp4', output: path.join(TMP, 'x.mp4'), chapters: [] }),
      /at least one chapter/,
    );
  });
});

// ─── F8/F9: parser hardening ─────────────────────────────────────────────────
describe('parseDuration handles both ffmpeg duration forms', () => {
  it('parses plain seconds (ffprobe json)', () => {
    assert.equal(parseDuration('120.042000'), 120.042);
    assert.equal(parseDuration('3'), 3);
  });

  it('parses clock notation (ffprobe text output)', () => {
    assert.equal(parseDuration('00:01:30.5'), 90.5);
    assert.equal(parseDuration('1:30'), 90);
    assert.equal(parseDuration('00:00:10'), 10);
    assert.equal(parseDuration('2:00:00'), 7200);
  });

  it('parses negative and rejects junk', () => {
    assert.equal(parseDuration('-5'), -5);
    assert.equal(parseDuration('abc'), null);
    assert.equal(parseDuration(''), null);
    assert.equal(parseDuration('N/A'), null);
    assert.equal(parseDuration('1:2:3:4'), null);
    assert.equal(parseDuration(undefined), null);
  });
});

describe('parseFrameRate rejects impossible values', () => {
  it('rejects negative numerators', () => {
    assert.equal(parseFrameRate('-30/1'), null);
  });
  it('still parses valid rates', () => {
    assert.equal(parseFrameRate('30/1')?.value, 30);
    assert.equal(parseFrameRate('30000/1001')?.value, 30000 / 1001);
  });
});

describe('formatDuration refuses to emit garbage', () => {
  it('formats valid durations', () => {
    assert.equal(formatDuration(0), '00:00:00.000');
    assert.equal(formatDuration(3661.5), '01:01:01.500');
  });
  it('throws on negative, NaN and Infinity', () => {
    assert.throws(() => formatDuration(-5), RangeError);
    assert.throws(() => formatDuration(NaN), RangeError);
    assert.throws(() => formatDuration(Infinity), RangeError);
  });
});

// Cleaned up in an `after` hook — a top-level rm would delete the fixture while
// the async encoder tests above are still pending.
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
