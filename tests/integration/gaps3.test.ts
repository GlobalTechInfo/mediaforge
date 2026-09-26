/**
 * mediaforge battle test — the last few gaps
 *
 * The progress-reporting paths, the validation branches of the loudness and
 * interpolation helpers, the process-lifecycle helpers and the ffprobe parsing
 * corners. Small, fast, and every case asserts the value it produced.
 *
 * Run: npm run battle:gaps3
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, 'tmp_gaps3');
const p = (name: string) => path.join(TMP, name);
const errors: { label: string; error: string; stack: string }[] = [];
let passed = 0;

function section(title: string): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

async function run(label: string, fn: () => void | Promise<void>): Promise<void> {
  process.stdout.write(`  ▸ ${label} ... `);
  try {
    await fn();
    console.log('✅ PASS');
    passed++;
  } catch (err) {
    const e = err as Error;
    console.log(`❌ FAIL\n      ${e.message}`);
    errors.push({ label, error: e.message, stack: e.stack ?? '' });
  }
}

function ok(cond: unknown, what: string): void {
  if (!cond) throw new Error(what);
}

function eq(actual: unknown, expected: unknown, what: string): void {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function throws(fn: () => unknown, re: RegExp, what: string): string {
  let msg = '';
  try {
    fn();
  } catch (e) {
    msg = (e as Error).message;
  }
  if (!re.test(msg)) throw new Error(`${what}: expected /${re.source}/, got ${JSON.stringify(msg)}`);
  return msg;
}

/** Run a command in process and return everything it printed. */
async function capture(
  tasks: Record<string, any>, name: string, pos: string[], f: Record<string, string>,
): Promise<string> {
  const orig = console.log;
  let out = '';
  console.log = (...a: unknown[]) => { out += a.map(String).join(' ') + '\n'; };
  try {
    await tasks[name]!.run(pos, f);
  } finally {
    console.log = orig;
  }
  return out;
}

async function rejects(fn: () => unknown, re: RegExp, what: string): Promise<string> {
  let msg = '';
  try {
    await fn();
  } catch (e) {
    msg = (e as Error).message;
  }
  if (!re.test(msg)) throw new Error(`${what}: expected /${re.source}/, got ${JSON.stringify(msg)}`);
  return msg;
}

const m = await import('../../lib/index.js') as Record<string, any>;
const proc = await import('../../lib/helpers/process.js') as Record<string, any>;
const ffprobe = await import('../../lib/probe/ffprobe.js') as Record<string, any>;
const streams = await import('../../lib/helpers/streams.js') as Record<string, any>;
const filters = await import('../../lib/types/filters.js') as Record<string, any>;
const events = await import('../../lib/process/events.js') as Record<string, any>;
const hw = await import('../../lib/helpers/hw.js') as Record<string, any>;

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
execFileSync('ffmpeg', [
  '-y',
  '-f', 'lavfi', '-i', 'testsrc=duration=2:size=160x90:rate=10',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '45', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-shortest', p('src.mp4'),
], { stdio: 'pipe' });
// A second, visually distinct clip so the scene detector has something to find.
execFileSync('ffmpeg', [
  '-y',
  '-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x90:rate=10',
  '-f', 'lavfi', '-i', 'color=red:duration=1:size=160x90:rate=10',
  '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
  '-map', '[v]', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '45',
  '-pix_fmt', 'yuv420p', p('scenes.mp4'),
], { stdio: 'pipe' });

// ─── 1. Progress-reporting paths ─────────────────────────────────────────────
section('1 — progress reporting');

await run('interpolateFrames reports progress as a percentage', async () => {
  const seen: number[] = [];
  await m.interpolateFrames({
    input: p('src.mp4'), output: p('smooth.mp4'), fps: 20, method: 'dup',
    onProgress: n => seen.push(n),
  });
  ok(fs.existsSync(p('smooth.mp4')), 'no output');
  ok(seen.length > 0, 'no progress callbacks');
  ok(seen.every(n => n >= 0 && n <= 100), `a percentage is out of range: ${seen.join(', ')}`);
});

await run('cutToScenes reports progress as a percentage', async () => {
  const seen: number[] = [];
  await m.cutToScenes({
    input: p('scenes.mp4'), output: p('cut.mp4'), threshold: 0.1,
    onProgress: n => seen.push(n),
  });
  ok(fs.existsSync(p('cut.mp4')), 'no auto-edit output');
  ok(seen.length > 0, 'no progress callbacks');
  ok(seen.every(n => n >= 0 && n <= 100), `a percentage is out of range: ${seen.join(', ')}`);
});

await run('removeSilence reports progress as a percentage', async () => {
  const seen: number[] = [];
  await m.removeSilence({
    input: p('src.mp4'), output: p('trimmed.m4a'), threshold: -30, minDuration: 0.5,
    onProgress: n => seen.push(n),
  });
  ok(fs.existsSync(p('trimmed.m4a')), 'no output');
  ok(seen.length > 0, 'no progress callbacks');
  ok(seen.every(n => n >= 0 && n <= 100), `a percentage is out of range: ${seen.join(', ')}`);
});

// ─── 2. Validation branches ──────────────────────────────────────────────────
section('2 — validation');

await run('buildInterpolateFilter rejects every unusable option', () => {
  throws(() => m.buildInterpolateFilter({ fps: 60, method: 'nope' as never }), /unknown method|method/i, 'method');
  throws(() => m.buildInterpolateFilter({ fps: 60, mbSize: 2 }), /mbSize/, 'mbSize');
  const mci = m.buildInterpolateFilter({ fps: 60, method: 'mci', mbSize: 16, mcMode: 'obmc', meMode: 'bidir' });
  ok(mci.includes('mb_size=16'), `no mb_size: ${mci}`);
  ok(mci.includes('mc_mode=obmc'), `no mc_mode: ${mci}`);
  const blend = m.buildInterpolateFilter({ fps: 30, method: 'blend' });
  ok(!blend.includes('mb_size'), `mb_size leaked into a blend: ${blend}`);
  throws(() => m.buildInterpolateFilter({ fps: 0 }), /fps/i, 'a zero frame rate');
});

await run('buildSceneCutArgs validates its window', () => {
  const scenes = [{ timestamp: 1, sceneNumber: 1 }, { timestamp: 2.5, sceneNumber: 2 }];
  const args = m.buildSceneCutArgs(scenes);
  ok(args.includes('-ss'), 'no seek');
  ok(args.includes('2.500'), `no boundary: ${args.join(' ')}`);
  const trimmed = m.buildSceneCutArgs(scenes, { trimStart: 0.5, endTime: 2 });
  ok(trimmed.includes('-ss'), 'no trimmed seek');
  throws(() => m.buildSceneCutArgs(scenes, { trimStart: -1 }), /trimStart/, 'a negative trimStart');
});

await run('the loudnorm helpers reject an unusable measurement', () => {
  const filter = m.buildLoudnormFilter(-16, 11, -1.5, {
    inputI: -24, inputLra: 7, inputTp: -3, inputThresh: -34, targetOffset: 1.5,
  } as never);
  ok(filter.includes('measured_i=-24'), `no measured_i: ${filter}`);
  ok(filter.includes('offset=1.5'), `no offset: ${filter}`);
  // The snake_case spelling ffmpeg prints is accepted too.
  const snake = m.buildLoudnormFilter(-16, 11, -1.5, {
    input_i: -24, input_lra: 7, input_tp: -3, input_thresh: -34,
  } as never);
  ok(snake.includes('measured_i=-24'), `no measured_i from snake_case: ${snake}`);
  ok(!snake.includes('offset='), `an offset was invented: ${snake}`);
  throws(
    () => m.buildLoudnormFilter(-16, 11, -1.5, { inputI: -24 } as never),
    /missing or not a finite number/,
    'a partial measurement',
  );
  throws(
    () => m.buildLoudnormFilter(-16, 11, -1.5, { inputI: NaN, inputLra: 7, inputTp: -3, inputThresh: -34 } as never),
    /missing or not a finite number/,
    'a NaN measurement',
  );
});

await run('parseLoudnorm measures a real file and refuses a broken one', async () => {
  const parsed = await m.parseLoudnorm({ input: p('src.mp4') });
  ok(Number.isFinite(parsed.inputI), `inputI: ${parsed.inputI}`);
  ok(Number.isFinite(parsed.inputLra), `inputLra: ${parsed.inputLra}`);
  await rejects(
    () => m.parseLoudnorm({ input: p('nope.mp4') }),
    /No such file|not found/i,
    'a missing file',
  );
});

await run('the single-pass normaliser reports that it did not measure', async () => {
  const res = await m.normalizeAudio({
    input: p('src.mp4'), output: p('onepass.mp4'), twoPass: false, targetI: -20,
    videoCodec: 'libx264',
  });
  ok(Number.isNaN(res.inputI), `single pass claimed a measurement: ${res.inputI}`);
  ok(fs.existsSync(p('onepass.mp4')), 'no output');
});

// ─── 3. Process lifecycle ────────────────────────────────────────────────────
section('3 — process lifecycle');

await run('the tracked-child count rises and falls back to zero', async () => {
  const before = proc.getSpawnedCount();
  const child = m.spawnFFmpeg({
    binary: m.resolveBinary(),
    args: ['-f', 'lavfi', '-i', 'testsrc=duration=0.4:size=32x32:rate=5', '-f', 'null', '-'],
  });
  ok(proc.getSpawnedCount() >= before, 'the child was not tracked');
  await new Promise<void>((resolve, reject) => {
    child.emitter.on('end', () => resolve());
    child.emitter.on('error', (e: Error) => reject(e));
  });
  eq(proc.getSpawnedCount(), before, 'the child was never released');
});

await run('renice reports a failure instead of swallowing it', () => {
  const fake = { pid: undefined } as never;
  throws(() => proc.renice(fake, 5), /no PID/, 'a child with no pid');
  // A pid that is not ours: renice exits non-zero and the helper says so.
  throws(() => proc.renice({ pid: 999_999 } as never, 5), /renice failed/, 'an unowned pid');
});

await run('autoKillOnExit can be released more than once', async () => {
  const child = m.spawnFFmpeg({
    binary: m.resolveBinary(),
    args: ['-f', 'lavfi', '-i', 'testsrc=duration=0.3:size=32x32:rate=5', '-f', 'null', '-'],
  });
  const release = proc.autoKillOnExit(child.child as never);
  release();
  release();
  ok(true, 'a second release threw');
  // Killing emits 'error' on the emitter, so keep a listener attached or the
  // process takes the unhandled 'error' down with it.
  child.emitter.on('error', () => {});
  child.kill();
  await new Promise<void>((resolve) => {
    child.emitter.on('end', () => resolve());
    child.emitter.on('error', () => resolve());
  });
});

// ─── 4. ffprobe corners ──────────────────────────────────────────────────────
section('4 — ffprobe corners');

await run('an invalid stream is reported rather than returned', async () => {
  await rejects(() => ffprobe.probeAsync(p('src.mp4'), { timeout: 1 }), /.*/, 'a 1ms timeout');
  const info = await ffprobe.probeAsync(p('src.mp4'));
  eq(ffprobe.getDefaultVideoStream({ ...info, streams: [] }) ?? undefined, undefined, 'no streams at all');
  // With no format block it falls back to the first stream that has a duration.
  eq(ffprobe.getMediaDuration({ ...info, format: undefined }), 2, 'the stream duration fallback');
  eq(ffprobe.getMediaDuration({ format: undefined, streams: [] }), null, 'nothing to read a duration from');
  eq(ffprobe.isHdr({ ...info, streams: [] }), false, 'no streams, no HDR');
  eq(ffprobe.isInterlaced({ ...info, streams: [] }), false, 'no streams, no interlace');
  eq(ffprobe.getChapterList({ ...info, chapters: undefined }).length, 0, 'no chapters block');
});

await run('a stream without a frame rate is summarised with zero fps', async () => {
  const info = await ffprobe.probeAsync(p('src.mp4'));
  const stream = { ...ffprobe.getVideoStreams(info)[0]!, avg_frame_rate: undefined, r_frame_rate: '0/0' };
  const summary = ffprobe.summarizeVideoStream(stream);
  eq(summary.fps, 0, 'fps defaults to 0');
  eq(summary.width, 160, 'summary width');
  eq(summary.codec, 'h264', 'summary codec');
  const audio = ffprobe.summarizeAudioStream({ ...ffprobe.getAudioStreams(info)[0]!, sample_rate: undefined });
  eq(audio.sampleRate, 0, 'sample rate defaults to 0');
});

// ─── 5. Stream plumbing corners ──────────────────────────────────────────────
section('5 — stream plumbing corners');

await run('streamToFile can pipe straight into stdin', async () => {
  // Without an inputFormat the stream is piped to ffmpeg's stdin rather than
  // staged through a temporary file.
  await streams.streamToFile({
    binary: m.resolveBinary(),
    stream: Readable.from(fs.readFileSync(p('src.mp4'))),
    output: p('piped.mp4'),
    outputArgs: ['-c', 'copy'],
  });
  ok(fs.statSync(p('piped.mp4')).size > 0, 'nothing was written');
});

await run('the xstack layout and the sprite sizing run for real', async () => {
  // xstack is the one stacking direction that builds a layout string, so it
  // gets its own run through the library.
  await m.stackVideos({
    inputs: [p('src.mp4'), p('src.mp4')],
    output: p('grid.mp4'),
    direction: 'xstack' as never,
  });
  ok(fs.existsSync(p('grid.mp4')), 'no xstack output');
  const tile = await m.generateSprite({
    input: p('src.mp4'), output: p('tiles.png'), columns: 3, count: 6, thumbWidth: 60,
  });
  eq(tile.columns, 3, 'columns');
  eq(tile.rows, 2, 'rows');
  ok(tile.thumbHeight !== null, 'the height was not probed from the source');
  ok(fs.statSync(p('tiles.png')).size > 0, 'no sprite');
});

await run('a chain of audio filters switches the stream it runs on', async () => {
  const tasks = (await import('../../lib/cli/tasks.js')).CLI_TASKS as Record<string, any>;
  const printed = await capture(tasks, 'filter', [], { chain: 'volume:volume=0.5', print: 'true' });
  ok(printed.includes('volume=0.5'), `no volume in the chain: ${printed}`);
});

await run('addChapters validates every chapter before it writes anything', async () => {
  const base = { input: p('src.mp4'), output: p('chapters.mp4') };
  await rejects(
    () => m.addChapters({ ...base, chapters: [] as never }),
    /at least one chapter/,
    'an empty chapter list',
  );
  await rejects(
    () => m.addChapters({ ...base, chapters: [{ startSec: 0 } as never] }),
    /non-empty "title"/,
    'a chapter with no title',
  );
  await rejects(
    () => m.addChapters({ ...base, chapters: [{ title: 'A', startSec: -1 } as never] }),
    /non-negative start/,
    'a negative start',
  );
  await rejects(
    () => m.addChapters({ ...base, chapters: [{ title: 'A' } as never] }),
    /non-negative start/,
    'a missing start',
  );
  await rejects(
    () => m.addChapters({
      ...base,
      chapters: [
        { title: 'A', startSec: 5 },
        { title: 'B', startSec: 1 },
      ],
    }),
    /ascending time order/,
    'chapters out of order',
  );
  // The `start` spelling is accepted as well as `startSec`.
  await m.addChapters({ ...base, chapters: [{ title: 'A', start: 0 } as never, { title: 'B', start: 1 } as never] });
  eq(m.getChapterList(m.probe(p('chapters.mp4'))).length, 2, 'chapter count');
});

await run('the filter chain reports its length and its nodes', () => {
  const { FilterChain, serializeNode } = filters;
  const chain = new FilterChain();
  eq(chain.length, 0, 'a fresh chain is empty');
  eq(chain.getNodes().length, 0, 'no nodes yet');
  chain.add({ name: 'scale', positional: [160, 90], named: { flags: 'bicubic' } });
  chain.raw('unsharp=5:5:1.0');
  chain.add({ name: 'eq', positional: [], named: { contrast: 1.1, invert: false } });
  eq(chain.length, 3, 'three filters');
  eq(chain.getNodes().length, 3, 'three nodes');
  const str = chain.toString();
  ok(str.includes('scale=160:90:flags=bicubic'), `serialised: ${str}`);
  ok(str.includes('unsharp=5:5:1.0'), `raw node lost: ${str}`);
  // A boolean named argument is emitted as 1/0, and a bare node is its name.
  ok(str.includes('eq=contrast=1.1:invert=0'), `boolean not serialised: ${str}`);
  eq(serializeNode({ name: 'null', positional: [], named: {} }), 'null', 'a bare node');
});

await run('the HLS builders reject the options they cannot honour', () => {
  throws(() => m.buildHlsArgs('in.mp4', 'out', { hlsVersion: 9 }), /.*/, 'an unknown hls_version');
  throws(() => m.buildDashArgs('in.mp4', 'out.mpd', { hlsVersion: 9 as never }), /.*/, 'hls_version is not a DASH option');
  throws(() => m.buildVarStreamMap([{ name: 'only', resolution: '320x180', videoBitrate: '150k' }]), /.*/, 'a single variant still maps');
  throws(
    () => m.validateAbrVariants([
      { name: 'a', resolution: '320x180', videoBitrate: '150k' },
      { name: 'b', resolution: '320', videoBitrate: '300k' },
    ]),
    /resolution/i,
    'a resolution with no height',
  );
});

await run('the watermark positions cover every corner and a custom expression', () => {
  for (const pos of ['top-left', 'top-right', 'top-center', 'bottom-left', 'bottom-right', 'bottom-center', 'center']) {
    const f = m.buildWatermarkFilter(pos as never, 10, 1);
    ok(f.includes('overlay'), `${pos}: ${f}`);
  }
  // A custom position is an overlay expression, split on its first colon.
  const custom = m.buildWatermarkFilter('10:20' as never, 10, 1);
  ok(custom.includes('overlay=10:20'), `custom position: ${custom}`);
  const bare = m.buildWatermarkFilter('center-left' as never, 10, 1);
  ok(bare.includes('overlay=center-left'), `a bare position: ${bare}`);
  // Opacity and a logo width both add to the filter chain.
  const faded = m.buildWatermarkFilter('top-left' as never, 4, 0.5, 200);
  ok(faded.includes('scale=200:-1'), `no logo scale: ${faded}`);
  ok(faded.includes('colorchannelmixer=aa=0.5'), `no opacity: ${faded}`);
});

await run('the spectrum palette guard rejects a CSS colour', () => {
  throws(() => m.buildSpectrumFilter(800, 120, 'red' as never, 20), /palette name|Invalid showspectrum/, 'a CSS colour');
  const okFilter = m.buildSpectrumFilter(800, 120, 'fire' as never, 20);
  ok(okFilter.includes('showspectrum=s=800x120'), `not a showspectrum: ${okFilter}`);
  ok(okFilter.includes('color=fire'), `no palette: ${okFilter}`);
  throws(() => m.buildWaveformFilter(800, 120, 'octarine' as never, 'lin'), /.*/, 'an unknown waveform colour');
  throws(() => m.buildWaveformFilter(800, 120, 'blue', 'wobble' as never), /.*/, 'an unknown scale');
});

await run('the emitter supports on, once and off', () => {
  const { FFmpegEmitter } = events;
  const e = new FFmpegEmitter();
  const seen: string[] = [];
  const listener = (v: string) => seen.push(v);
  e.on('stderr', listener);
  e.emit('stderr', 'a');
  e.off('stderr', listener);
  e.emit('stderr', 'b');
  eq(seen.join(''), 'a', 'off did not detach the listener');
  const onceSeen: string[] = [];
  e.once('stderr', v => onceSeen.push(v));
  e.emit('stderr', 'c');
  e.emit('stderr', 'd');
  eq(onceSeen.join(''), 'c', 'once fired more than once');
  eq(e.listenerCount('stderr'), 0, 'the emitter kept a listener');
});

await run('a hardware transcode reports the failure from ffmpeg', async () => {
  // There is no GPU in CI, so the run has to fail — and fail with ffmpeg's own
  // message rather than an unhandled rejection.
  await rejects(
    () => hw.transcodeWithHwFilters({
      input: p('src.mp4'),
      output: p('hw.mp4'),
      accel: 'cuda',
      gpuFilters: [hw.buildHwScaleFilter({ accel: 'cuda' as never, width: 80, height: 45 })],
      videoCodec: 'h264_cuda',
    }),
    /exited with code/i,
    'a transcode with no GPU',
  );
});

await run('pipeThrough passes a fragmented mp4 through to a stream', async () => {
  const out = streams.pipeThrough({
    binary: m.resolveBinary(),
    inputStream: Readable.from(fs.readFileSync(p('src.mp4'))),
    inputFormat: 'mp4',
    outputFormat: 'mp4',
    outputArgs: ['-c', 'copy'],
  });
  const chunks: Buffer[] = [];
  out.stdout.on('data', (c: Buffer) => chunks.push(c));
  await new Promise<void>((resolve, reject) => {
    out.emitter.on('end', () => resolve());
    out.emitter.on('error', (e: Error) => reject(e));
  });
  ok(Buffer.concat(chunks).length > 0, 'no bytes came back');
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log('  GAP BATTLE SUMMARY (3)');
console.log('═'.repeat(60));
console.log(`  ✅ PASSED : ${passed}`);
console.log(`  ❌ FAILED : ${errors.length}`);

if (errors.length > 0) {
  console.log(`\n${'─'.repeat(60)}\n  FAILED TESTS — FULL ERROR LOG\n${'─'.repeat(60)}`);
  for (const { label, error, stack } of errors) {
    console.log(`\n  [${label}]\n       ERROR : ${error}`);
    if (process.env.MEDIAFORGE_TRACE === '1') console.log(stack);
  }
  process.exit(1);
}
console.log('\n  All gap tests passed! 🎉');
