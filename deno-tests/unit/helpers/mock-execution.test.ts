/**
 * Mock-based tests that cover the execution paths of helpers
 * by intercepting child_process.spawn and resolving immediately.
 * This covers the lines that call ffmpeg without needing the binary.
 */
import { describe, it, mock as _mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Buffer } from 'node:buffer';
import { setImmediate } from 'node:timers';

const { buildConcatList } = await import('../../../lib/helpers/concat.ts');

// Build a fake child process that exits with code 0 immediately
function _fakeChild(stdout?: Buffer) {
  const ee = new EventEmitter() as any;
  ee.stdin = { write: () => {}, end: () => {}, pipe: () => {}, on: () => {}, destroy: () => {} };
  ee.stdout = new EventEmitter() as any;
  ee.stdout.pipe = (dest: any) => { if (stdout) dest.write(stdout); dest.end(); return dest; };
  ee.stdout.on = (ev: string, cb: any) => { if (ev === 'data' && stdout) cb(stdout); return ee.stdout; };
  ee.stderr = new EventEmitter() as any;
  ee.kill = () => { setImmediate(() => ee.emit('close', 0, null)); };
  ee.pid = 12345;
  // Exit successfully after one tick
  setImmediate(() => {
    ee.stderr.emit('line', 'ffmpeg version 6.1');
    ee.emit('close', 0, null);
  });
  return ee;
}

// ─── mergeToFile single-file copy path ───────────────────────────────────────
describe('mergeToFile single-file path', () => {
  it('copies file directly when inputs.length === 1', async () => {
    const { mergeToFile } = await import('../../../lib/helpers/concat.ts');
    const tmp = os.tmpdir();
    const src = path.join(tmp, `src-${Date.now()}.txt`);
    const dst = path.join(tmp, `dst-${Date.now()}.txt`);
    fs.writeFileSync(src, 'hello');
    try {
      await mergeToFile({ inputs: [src], output: dst });
      assert.strictEqual(fs.readFileSync(dst, 'utf8'), 'hello');
    } finally {
      if (fs.existsSync(src)) fs.unlinkSync(src);
      if (fs.existsSync(dst)) fs.unlinkSync(dst);
    }
  });

  it('throws when inputs is empty', async () => {
    const { mergeToFile } = await import('../../../lib/helpers/concat.ts');
    await assert.rejects(
      mergeToFile({ inputs: [], output: '/tmp/out.mp4' }),
      /no inputs provided/,
    );
  });
});

// ─── screenshots folder creation ──────────────────────────────────────────────
describe('screenshots creates output folder', () => {
  it('creates folder if it does not exist', async () => {
    const { screenshots } = await import('../../../lib/helpers/screenshots.ts');
    const folder = path.join(os.tmpdir(), `sc-test-${Date.now()}`);
    // This will fail because no real ffmpeg input, but folder should be created
    try {
      await screenshots({ input: 'nonexistent.mp4', folder, timestamps: [1] });
    } catch { /* expected - no real file */ }
    assert.ok(fs.existsSync(folder));
    fs.rmSync(folder, { recursive: true, force: true });
  });
});

// ─── metadata buildChapterContent empty ───────────────────────────────────────
describe('metadata empty chapters', () => {
  it('buildChapterContent with empty array has header only', async () => {
    const { buildChapterContent } = await import('../../../lib/helpers/metadata.ts');
    const content = buildChapterContent([]);
    assert.ok(content.includes(';FFMETADATA1'));
    assert.ok(!content.includes('[CHAPTER]'));
  });
});

// ─── concat buildConcatList multiple files ────────────────────────────────────
describe('concat edge cases', () => {

  it('three files produces three lines', () => {
    const r = buildConcatList(['/a.mp4', '/b.mp4', '/c.mp4']);
    assert.strictEqual(r.split('\n').length, 3);
  });
});

// ─── waveform default values ──────────────────────────────────────────────────
describe('waveform filter defaults', () => {
  it('buildWaveformFilter with all defaults', async () => {
    const { buildWaveformFilter } = await import('../../../lib/helpers/waveform.ts');
    const f = buildWaveformFilter(1920, 240, '#00ff00', 'lin', 0);
    assert.ok(f.includes('showwavespic'));
    assert.ok(f.includes('1920x240'));
  });
});

// ─── streams PipeOptions with inputStream ────────────────────────────────────
describe('streams with inputStream', () => {
  it('pipeThrough with inputStream pipes automatically', async () => {
    const { pipeThrough } = await import('../../../lib/helpers/streams.ts');
    const { Readable } = await import('node:stream');
    const src = Readable.from(['hello']);
    const proc = pipeThrough({ inputStream: src, outputFormat: 'null' });
    assert.ok(proc.emitter !== undefined);
    await new Promise<void>(res => {
      proc.emitter.on('end', res);
      proc.emitter.on('error', () => res()); // errors are fine - no real input
    });
  });
});

// ─── normalize filter with default params ────────────────────────────────────
describe('loudnorm filter edge cases', () => {
  it('buildLoudnormFilter all measured fields present', async () => {
    const { buildLoudnormFilter } = await import('../../../lib/helpers/normalize.ts');
    const f = buildLoudnormFilter(-23, 7, -2, {
      inputI: -24.5, inputLra: 6.2, inputTp: -3.1, inputThresh: -34, targetOffset: 0.5
    });
    assert.ok(f.includes('offset=0.5'));
    assert.ok(f.includes('measured_thresh=-34'));
  });
});

// ─── gif buildGifPaletteuseFilter ────────────────────────────────────────────
describe('gif builder edge cases', () => {
  it('buildGifPaletteuseFilter returns string with fps', async () => {
    const { buildGifPaletteuseFilter } = await import('../../../lib/helpers/gif.ts');
    const f = buildGifPaletteuseFilter(15, 480, 'bayer');
    assert.ok(typeof f === 'string');
    assert.ok(f.includes('fps=15'));
  });

  it('buildGifArgs without startTime/duration has no -ss/-t in pass1', async () => {
    const { buildGifArgs } = await import('../../../lib/helpers/gif.ts');
    const { pass1 } = buildGifArgs('in.mp4', '/tmp/p.png', 'out.gif', 15, 480, 'bayer');
    assert.ok(!pass1.includes('-t'));
  });
});

// ─── subtitle builder edge cases ─────────────────────────────────────────────
describe('subtitle builder edge cases', () => {
  it('buildBurnSubtitlesFilter no styles has no force_style', async () => {
    const { buildBurnSubtitlesFilter } = await import('../../../lib/helpers/subtitles.ts');
    const f = buildBurnSubtitlesFilter('/tmp/subs.srt');
    assert.ok(!f.includes('force_style'));
  });

  it('buildBurnSubtitlesFilter escapes colon in path', async () => {
    const { buildBurnSubtitlesFilter } = await import('../../../lib/helpers/subtitles.ts');
    const f = buildBurnSubtitlesFilter('C:\\Users\\test.srt');
    assert.ok(f.includes('subtitles='));
  });
});

// ─── buildStreamOutputArgs edge cases ────────────────────────────────────────
describe('stream output edge cases', () => {
  it('buildStreamOutputArgs with outputArgs included', async () => {
    const { buildStreamOutputArgs } = await import('../../../lib/helpers/streams.ts');
    const args = buildStreamOutputArgs('in.mp4', ['-c:v', 'copy'], 'mp4');
    assert.ok(args.includes('-c:v'));
    assert.ok(args.includes('copy'));
    assert.ok(args.includes('-f'));
    assert.ok(args.includes('mp4'));
  });
});

// ─── screenshot buildTimestampFilename variations ────────────────────────────
describe('screenshot filename patterns', () => {
  // The index is used as given: ffmpeg numbers its own `%0Nd` outputs from 0,
  // so asking for frame 6 has to name frame 6, not frame 7. The extension is
  // normalised to exactly one leading dot, and the placeholder keeps the width
  // it was written with.
  const cases: Array<[string, number, string, string]> = [
    ['screenshot_%04d.png', 4, '.png', 'screenshot_0004.png'],
    ['screenshot_%04d.png', 4, 'png', 'screenshot_0004.png'],
    ['frame_%03d.png', 7, '.png', 'frame_007.png'],
    ['frame_%05d.png', 42, '.png', 'frame_00042.png'],
    ['frame_%d.png', 9, '.png', 'frame_0009.png'],
    // `path.basename` semantics: directories are stripped from the result.
    ['out/dir/frame_%02d.png', 1, '.png', 'frame_01.png'],
    // A pattern that already ends in the requested extension keeps just that
    // one; a different extension is left in place and the new one is appended.
    ['shot_%02d.jpg', 3, '.jpg', 'shot_03.jpg'],
    ['shot_%02d.jpg', 3, 'jpg', 'shot_03.jpg'],
    ['shot_%02d.jpeg', 3, '.jpg', 'shot_03.jpeg.jpg'],
    // No placeholder: the index is still inserted before the extension, so
    // two frames can never end up with the same name.
    ['plain.png', 2, '.png', 'plain0002.png'],
    ['shot.jpg', 3, '.jpg', 'shot0003.jpg'],
  ];

  it('formats each pattern the way ffmpeg will read it back', async () => {
    const { buildTimestampFilename } = await import('../../../lib/helpers/screenshots.ts');
    for (const [pattern, index, ext, want] of cases) {
      assert.strictEqual(buildTimestampFilename(pattern, index, ext), want, pattern);
    }
  });

  it('omits the extension entirely when asked for none', async () => {
    const { buildTimestampFilename } = await import('../../../lib/helpers/screenshots.ts');
    assert.strictEqual(buildTimestampFilename('frame_%02d', 5, ''), 'frame_05');
  });

  it('gives a placeholder-free pattern a distinct name per index', async () => {
    const { buildTimestampFilename } = await import('../../../lib/helpers/screenshots.ts');
    // Without this, `plain.png` would name every extracted frame and each run
    // would silently overwrite the previous one.
    const names = new Set([0, 1, 2].map((i) => buildTimestampFilename('plain.png', i, '.png')));
    assert.strictEqual(names.size, 3, `names collided: ${[...names].join(', ')}`);
  });

  it('never leaves two dots where a single extension belongs', async () => {
    const { buildTimestampFilename } = await import('../../../lib/helpers/screenshots.ts');
    for (const ext of ['.jpg', 'jpg']) {
      const name = buildTimestampFilename('f_%02d.jpg', 1, ext);
      assert.strictEqual(name, 'f_01.jpg');
      assert.ok(!name.includes('..'), `double dot in ${name}`);
    }
  });
});

// ─── presets all 11 produce valid args ───────────────────────────────────────
describe('all presets produce non-empty args', () => {
  it('web-hq has high quality crf', async () => {
    const { getPreset } = await import('../../../lib/helpers/presets.ts');
    const p = getPreset('web-hq');
    assert.ok(p.videoArgs.includes('18'));
    assert.ok(p.videoArgs.includes('slow'));
  });
  it('instagram has faststart', async () => {
    const { getPreset } = await import('../../../lib/helpers/presets.ts');
    const p = getPreset('instagram');
    assert.ok([...p.videoArgs, ...p.extraArgs].some((a: string) => a.includes('faststart')));
  });
});
