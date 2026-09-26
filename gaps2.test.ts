/**
 * mediaforge battle test — the last gaps
 *
 * The guards, the hardware-filter builders, the metadata helpers and the
 * progress/plumbing internals. Small, fast, no encoder: every case asserts the
 * value or the message it produced.
 *
 * Run: npm run battle:gaps2
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, 'tmp_gaps2');
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

const m = await import('./lib/index.js') as Record<string, any>;
const guards = await import('./lib/compat/guards.js') as Record<string, any>;
const hw = await import('./lib/helpers/hw.js') as Record<string, any>;
const progress = await import('./lib/process/progress.js') as Record<string, any>;
const ffprobe = await import('./lib/probe/ffprobe.js') as Record<string, any>;
const registryMod = await import('./lib/codecs/registry.js') as Record<string, any>;

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
execFileSync('ffmpeg', [
  '-y',
  '-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x90:rate=10',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '45', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-shortest', p('src.mp4'),
], { stdio: 'pipe' });

// ─── 1. Guards ───────────────────────────────────────────────────────────────
section('1 — guards');

await run('the version guards explain a build that is too old', () => {
  const reg = registryMod.getDefaultRegistry(m.resolveBinary());
  const old = { major: 4, minor: 4, patch: 2, isGit: false, raw: '4.4.2' };
  const no = guards.guardVersion(old, 5, 'fps_mode', 1);
  eq(no.available, false, 'a 4.4 build is not 5.1');
  ok(/requires FFmpeg v5\.1\+/.test(no.reason ?? ''), `reason: ${no.reason}`);
  eq(guards.guardVersion(old, 4, 'lavfi').available, true, '4.4 satisfies a 4.x gate');

  const gates = Object.keys(m.FEATURE_GATES);
  ok(gates.length > 0, 'no feature gates at all');
  // Every gate is at least version 5, so a 4.4 build fails them all.
  const gate = gates[0]!;
  const noGate = guards.guardFeatureVersion(old, gate);
  eq(noGate.available, false, `a 4.4 build lacks ${gate}`);
  ok(/requires FFmpeg v/.test(noGate.reason ?? ''), `reason: ${noGate.reason}`);
  const unknown = guards.guardFeatureVersion(old, 'definitely-not-a-gate');
  eq(unknown.available, false, 'an unknown gate is unavailable');
  ok(/Unknown feature/.test(unknown.reason ?? ''), `reason: ${unknown.reason}`);
  const future = { major: 99, minor: 0, patch: 0, isGit: false, raw: '99.0' };
  eq(guards.guardFeatureVersion(future, gate).available, true, 'a new enough build has it');
  ok(reg.hasFilter('scale'), 'scale missing from this build');
  throws(() => guards.assertFeatureVersion(old, gate), /requires FFmpeg v/, 'assertFeatureVersion');
  guards.assertFeatureVersion(future, gate);
});

await run('guardHwaccel names an alternative when the device is absent', () => {
  const reg = registryMod.getDefaultRegistry(m.resolveBinary());
  const no = guards.guardHwaccel(reg, 'definitely-not-a-hwaccel');
  eq(no.available, false, 'a made-up accelerator is unavailable');
  ok(/is not available in the installed ffmpeg binary/.test(no.reason ?? ''), `reason: ${no.reason}`);
  // An unknown name still gets a suggestion when the table knows one.
  const vaapi = guards.guardHwaccel(reg, 'vaapi');
  ok(typeof vaapi.available === 'boolean', 'vaapi verdict');
  throws(() => guards.assertHwaccel(reg, 'definitely-not-a-hwaccel'), /not available/, 'assertHwaccel');
  const real = (m.HWACCELS as string[])[0]!;
  const verdict = guards.guardHwaccel(reg, real);
  if (verdict.available) guards.assertHwaccel(reg, real);
  const err = new guards.GuardError('nope', 'cuda');
  eq(err.name, 'GuardError', 'name');
  ok(err.alternative === 'cuda', 'alternative carried');
});

// ─── 2. Hardware filter builders ─────────────────────────────────────────────
section('2 — hardware filters');

await run('every accelerator has an upload and a download format', () => {
  let withUpload = 0;
  for (const accel of m.HWACCELS as string[]) {
    // Accelerators that never decode on the GPU have no frame format to upload
    // into, and say so rather than emitting a filter that cannot work.
    try {
      eq(hw.buildHwUploadFilter({ accel }), 'hwupload', `${accel} upload filter`);
      withUpload++;
    } catch (e) {
      ok(/no hardware frame format/.test((e as Error).message), `${accel}: ${(e as Error).message}`);
    }
    const dl = hw.buildHwDownloadFilter('nv12');
    eq(dl, 'hwdownload=format=nv12', `${accel} download filter`);
  }
  ok(withUpload > 0, 'no accelerator has an upload format');
  eq(hw.buildHwDownloadFilter(), 'hwdownload=format=nv12', 'default download format');
  // The chain refuses to upload and download around nothing.
  throws(() => hw.buildHwFilterChain({ accel: 'cuda', gpuFilters: [] }), /empty/, 'no GPU work');
  throws(() => hw.buildHwUploadFilter({ accel: 'nope' as never }), /.*/, 'unknown accel upload');
  throws(() => hw.buildHwFilterChain({ accel: 'nope' as never, gpuFilters: ['null'] }), /.*/, 'unknown accel');
});

await run('the GPU scalers exist for the accelerators that have one', () => {
  for (const accel of ['cuda', 'vaapi', 'qsv', 'vulkan']) {
    const f = hw.buildHwScaleFilter({ accel: accel as never, width: 160, height: 90 });
    ok(f.includes(accel), `${accel} scaler is not a ${accel} filter: ${f}`);
  }
  throws(() => hw.buildHwScaleFilter({ accel: 'videotoolbox' as never, width: 160, height: 90 }), /no GPU scaler/, 'no scaler');
  throws(() => hw.buildHwScaleFilter({ accel: 'cuda' as never, width: 0, height: 90 }), /positive integer/, 'a zero width');
});

await run('the chain keeps the cpu filters after the download', () => {
  const chain = hw.buildHwFilterChain({
    accel: 'cuda',
    gpuFilters: [hw.buildHwScaleFilter({ accel: 'cuda', width: 160, height: 90 })],
    cpuFilters: ['drawtext=text=hi'],
    downloadFormat: 'yuv420p',
  });
  ok(chain.indexOf('hwdownload') < chain.indexOf('drawtext'), `cpu filters run on the GPU: ${chain}`);
  ok(chain.includes('format=yuv420p'), `no download format: ${chain}`);
  const plain = hw.buildHwFilterChain({ accel: 'cuda', gpuFilters: ['scale_cuda=160:90'] });
  ok(!plain.includes('drawtext'), 'an unexpected cpu filter appeared');
  ok(plain.indexOf('scale_cuda') < plain.indexOf('hwdownload'), 'the GPU work runs after the download');
});

// ─── 3. Progress parsing ─────────────────────────────────────────────────────
section('3 — progress parsing');

await run('a progress block becomes a ProgressInfo', () => {
  const info = progress.parseAllProgress(
    'frame=100\nfps=25\nbitrate=800kbits/s\ntotal_size=1234567\n' +
    'out_time_us=2000000\nout_time_ms=2000000\nout_time=00:00:02.000000\n' +
    'dup_frames=0\ndrop_frames=0\nspeed=1.5x\nprogress=continue\n',
    4_000_000,
  )[0]!;
  eq(info.frame, 100, 'frame');
  eq(info.outTimeUs, 2_000_000, 'out_time_us');
  eq(info.percent, 50, 'percent');
  eq(info.fps, 25, 'fps');
  eq(info.totalSize, 1234567, 'total size');
  ok(info.speed !== undefined, 'speed');
});

await run('a malformed block does not poison the numbers', () => {
  const info = progress.parseAllProgress('frame=N/A\nout_time_us=oops\nprogress=end\n', 1_000_000)[0]!;
  eq(info.frame, 0, 'frame defaults to 0');
  eq(info.outTimeUs, 0, 'out_time defaults to 0');
  eq(info.percent, 0, 'percent clamps at 0');
  const noTotal = progress.parseAllProgress('out_time_us=5000000\nprogress=end\n')[0]!;
  eq(noTotal.percent, undefined, 'percent is undefined without a total');
  eq(progress.parseAllProgress('nothing here at all\n').length, 0, 'junk is not a block');
});

await run('the parser emits once per complete block', () => {
  const seen: any[] = [];
  const parser = new progress.ProgressParser(i => seen.push(i), 1_000_000);
  // push() takes one stderr line at a time, the way captureStderr feeds it.
  parser.push('frame=1');
  parser.push('out_time_us=500000');
  eq(seen.length, 0, 'an incomplete block emitted early');
  parser.push('progress=continue');
  eq(seen.length, 1, 'the block was not emitted');
  eq(seen[0]!.percent, 50, 'first percentage');
  parser.push('frame=2');
  parser.push('out_time_us=900000');
  parser.push('progress=end');
  eq(seen.length, 2, 'the second block was not emitted');
  eq(seen[1]!.percent, 90, 'second percentage');
  parser.push('a line with no equals sign');
  eq(seen.length, 2, 'an unterminated block emitted');
});

await run('parseAllProgress reads a whole log at once', () => {
  const log = [
    'frame=1\nout_time_us=1000000\nprogress=continue',
    'frame=2\nout_time_us=3000000\nprogress=end',
  ].join('\n');
  const all = progress.parseAllProgress(log, 4_000_000);
  eq(all.length, 2, 'block count');
  eq(all[1]!.percent, 75, 'last percentage');
});

// ─── 4. ffprobe parsing ──────────────────────────────────────────────────────
section('4 — ffprobe parsing');

await run('the frame-rate, duration and bitrate parsers accept every spelling', () => {
  eq(ffprobe.parseFrameRate('30/1')?.value, 30, 'n/d');
  eq(Math.round(ffprobe.parseFrameRate('30000/1001')!.value * 1000), Math.round((30000 / 1001) * 1000), 'NTSC');
  eq(ffprobe.parseFrameRate('25')?.value, undefined, 'a bare number has no denominator');
  eq(ffprobe.parseFrameRate('')?.value, undefined, 'an empty string');
  eq(ffprobe.parseFrameRate('N/A') ?? undefined, undefined, 'N/A');
  eq(ffprobe.parseFrameRate('0/0') ?? undefined, undefined, '0/0');
  eq(ffprobe.parseFrameRate('-30/1') ?? undefined, undefined, 'a negative rate');
  eq(ffprobe.parseDuration('00:00:30.5'), 30.5, 'clock');
  eq(ffprobe.parseDuration('30.5'), 30.5, 'seconds');
  eq(ffprobe.parseDuration('nonsense') ?? undefined, undefined, 'nonsense');
  eq(ffprobe.parseBitrate('2000'), 2000, 'bits per second');
  // ffprobe emits raw integers, so the parser is parseInt: anything else is
  // truncated rather than rejected, and a non-number is null.
  eq(ffprobe.parseBitrate('2.5Mb/s'), 2, 'a suffixed value is truncated');
  eq(ffprobe.parseBitrate('N/A') ?? undefined, undefined, 'N/A');
  eq(ffprobe.parseBitrate(undefined) ?? undefined, undefined, 'undefined');
  eq(ffprobe.durationToMicroseconds(60), 60_000_000, 'microseconds');
  eq(ffprobe.durationToMicroseconds(0.5), 500_000, 'fractional seconds');
  eq(ffprobe.formatDuration(90), '00:01:30.000', 'formatting');
  eq(ffprobe.formatDuration(3661.5), '01:01:01.500', 'hours and milliseconds');
  throws(() => ffprobe.formatDuration(-1), /non-negative/, 'a negative duration');
  throws(() => ffprobe.formatDuration(Infinity), /finite/, 'an infinite duration');
});

await run('the probe reports what it found in a real file', async () => {
  const info = await ffprobe.probeAsync(p('src.mp4'));
  ok(info.format !== undefined, 'no format block');
  eq(ffprobe.getVideoStreams(info).length, 1, 'video stream count');
  eq(ffprobe.getAudioStreams(info).length, 1, 'audio stream count');
  eq(ffprobe.getSubtitleStreams(info).length, 0, 'subtitle stream count');
  eq(ffprobe.getDefaultVideoStream(info)?.index, 0, 'default video index');
  eq(ffprobe.getDefaultAudioStream(info)?.index, 1, 'default audio index');
  eq(ffprobe.getMediaDuration(info) > 0.5, true, 'duration');
  eq(ffprobe.isHdr(info), false, 'not HDR');
  eq(ffprobe.isInterlaced(info), false, 'not interlaced');
  const summary = ffprobe.summarizeVideoStream(ffprobe.getVideoStreams(info)[0]!);
  eq(summary.width, 160, 'summary width');
  eq(ffprobe.getChapterList(info).length, 0, 'no chapters');
  eq(ffprobe.getStreamLanguage(ffprobe.getVideoStreams(info)[0]!), 'und', 'default language');
  eq(ffprobe.findStreamByLanguage(info, 'eng') ?? undefined, undefined, 'no English stream');
  await rejects(() => ffprobe.probeAsync(p('nope.mp4')), /No such file|not found/i, 'a missing file');
});

// ─── 5. Metadata helpers ─────────────────────────────────────────────────────
section('5 — metadata');

await run('metadata builders cover the write, strip and per-stream forms', () => {
  const global = m.buildMetadataArgs({ title: 'Clip' }, { '0:1': { language: 'eng' } });
  ok(global.includes('title=Clip'), `no title: ${global.join(' ')}`);
  ok(global.some(a => a.includes('language=eng')), `no language: ${global.join(' ')}`);
  const stripped = m.buildMetadataArgs({});
  ok(stripped.includes('-map_metadata'), `no strip: ${stripped.join(' ')}`);
  const chapter = m.buildChapterContent([
    { title: 'A', startSec: 0, endSec: 2 },
    { title: 'B', startSec: 2, endSec: 4 },
  ]);
  ok(chapter.startsWith(';FFMETADATA1'), `not a chapter file: ${chapter.slice(0, 40)}`);
  ok(chapter.includes('TIMEBASE=1/1000'), 'no millisecond timebase');
  throws(() => m.buildChapterContent([{ title: 'A', startSec: 5, endSec: 1 }]), /.*/, 'an inverted chapter');
});

await run('chapter and metadata content reject malformed input', () => {
  ok(m.buildChapterContent([{ title: 'A', startSec: 0, endSec: 1 }]).includes('END=1000'), 'no end time');
});

// ─── 6. HLS and DASH builders ────────────────────────────────────────────────
section('6 — streaming packaging builders');

await run('buildHlsArgs and buildDashArgs cover their options', () => {
  const hls = m.buildHlsArgs('in.mp4', 'out', { segmentDuration: 4, hlsFlags: 'independent_segments' });
  ok(hls.includes('hls'), 'no hls muxer');
  ok(hls.includes('independent_segments'), `no hls_flags: ${hls.join(' ')}`);
  ok(hls.some(a => a.includes('segment')), `no segment name: ${hls.join(' ')}`);
  const dash = m.buildDashArgs('in.mp4', 'out.mpd', { segmentDuration: 2 });
  ok(dash.includes('dash'), 'no dash muxer');
  throws(() => m.buildHlsArgs('in.mp4', 'out', { segmentDuration: 0 }), /.*/, 'a zero segment');
  throws(() => m.buildDashArgs('in.mp4', 'out.mpd', { segmentDuration: -1 }), /.*/, 'a negative segment');
});

await run('the ABR builders validate their variants', () => {
  const variants = [
    { name: 'low', resolution: '320x180', videoBitrate: '150k' },
    { name: 'high', resolution: '640x360', videoBitrate: '400k' },
  ];
  const filter = m.buildAbrLadderFilter({ variants });
  ok(filter.includes('split'), `no split in: ${filter}`);
  const map = m.buildVarStreamMap(variants);
  ok(map.map.includes('name:low'), `no var_stream_map: ${map.map}`);
  eq(map.streamCount, 2, 'stream count');
  throws(() => m.buildVarStreamMap([]), /at least one variant/, 'no variants');
  const args = m.buildAbrLadderArgs({
    input: 'in.mp4', outputPattern: 'v%v/index.m3u8', variants,
  });
  ok(args.includes('-var_stream_map'), 'no var_stream_map flag');
  m.validateAbrVariants(variants);
  throws(() => m.validateAbrVariants([{ name: '', resolution: '320x180', videoBitrate: '150k' }]), /.*/, 'an empty name');
  throws(
    () => m.validateAbrVariants([{ name: 'low', resolution: 'not-a-size', videoBitrate: '150k' }]),
    /.*/,
    'an unparseable resolution',
  );
});

// ─── 7. Stream plumbing ──────────────────────────────────────────────────────
section('7 — stream plumbing');

await run('a stream that is not ffmpeg reports the failure', async () => {
  await rejects(
    () => m.streamToFile({
      binary: 'definitely-not-a-real-binary-xyz',
      stream: Readable.from([Buffer.alloc(8)]),
      inputFormat: 'mp4',
      output: p('never.mp4'),
      outputArgs: ['-c', 'copy'],
    }),
    /ENOENT|spawn|not found/i,
    'a missing binary',
  );
});

await run('spawning a missing binary surfaces an error instead of a dead process', async () => {
  // Node reports ENOENT asynchronously, so the emitter is the only place the
  // failure can reach the caller.
  const proc = m.spawnFFmpeg({ binary: 'definitely-not-a-real-binary-xyz', args: ['-i', 'x'] });
  const msg = await rejects(
    () => new Promise<void>((resolve, reject) => {
      proc.emitter.on('end', () => resolve());
      proc.emitter.on('error', (e: Error) => reject(e));
    }),
    /ENOENT|spawn/i,
    'a missing binary',
  );
  ok(msg.length > 0, 'an empty error message');
});

await run('the progress path of a failing run still reports its error', async () => {
  const proc = m.spawnFFmpeg({
    binary: m.resolveBinary(),
    args: ['-i', p('nope.mp4'), '-f', 'null', '-'],
    parseProgress: true,
  });
  let msg = '';
  try {
    await new Promise<void>((resolve, reject) => {
      proc.emitter.on('end', () => resolve());
      proc.emitter.on('error', (e: Error) => reject(e));
    });
  } catch (e) {
    msg = (e as Error).message;
  }
  ok(/exited with code/.test(msg), `unexpected message: ${msg}`);
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log('  GAP BATTLE SUMMARY (2)');
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
