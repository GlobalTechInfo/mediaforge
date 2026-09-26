/**
 * runtime-tests/battle.ts — runtime-portability battle test
 *
 * The same source runs on all three supported runtimes, because it imports
 * `./lib/index.ts` directly (which tsx resolves for Node, and Deno and Bun
 * resolve natively):
 *
 *   npm run battle:runtime        # Node
 *   deno task battle:runtime      # Deno
 *   bun run battle:runtime        # Bun
 *
 * The Node-specific suites (`battle.test.ts`, `battle.newfeatures.test.ts`,
 * `battle.cli.test.ts`) exercise much more surface; this suite is the one that
 * answers "does the library actually work on Deno and Bun", and it is kept
 * runtime-agnostic on purpose — no `process`, no `Deno`, no `Bun` globals
 * unless reached through the small adapter below.
 *
 * It covers the 2.1.0 feature set end to end against real ffmpeg: quality
 * metrics, tone mapping, frame interpolation, scene cutting, silence removal,
 * segmenting, subtitle conversion, ABR ladders, delogo, hardware filter
 * builders, the encode controls, and the whole CLI task table.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

import {
  CLI_TASKS, parseTaskArgs, taskHelpText, taskDetail,
  measureQuality, parseStatsFile, parseVmafLog,
  buildVmafFilter, buildSsimFilter, buildPsnrFilter,
  buildToneMapFilter, toneMapHdrToSdr,
  buildInterpolateFilter, interpolateFrames,
  detectScenes, cutToScenes, buildSceneCutArgs,
  buildSilenceRemoveFilter, removeSilence, buildSegmentArgs, writeSegments,
  buildHwUploadFilter, buildHwDownloadFilter, buildHwScaleFilter, buildHwFilterChain, HWACCELS,
  subtitleCodecFor, subtitleExtensionFor, convertSubtitles, fixSubtitleDuration,
  buildVarStreamMap, buildAbrLadderFilter, buildAbrLadderArgs, validateAbrVariants, abrLadder,
  delogo, ffmpeg as ffmpegBuilder, probe, isHdr,
  TONE_MAP_ALGORITHMS, FPS_MODES, COLOR_PROPERTY_KEYS,
} from '../lib/index.ts';

// ─── runtime adapter ────────────────────────────────────────────────────────
// Identical contract on all three runtimes; keeps the rest of the file free of
// runtime-specific globals.
const RUNTIME: 'node' | 'deno' | 'bun' =
  typeof (globalThis as { Deno?: unknown }).Deno === 'object' ? 'deno'
  : typeof (globalThis as { Bun?: unknown }).Bun === 'object' ? 'bun'
  : 'node';

function fail(message: string): never {
  throw new Error(message);
}

const exit: (code: number) => void =
  RUNTIME === 'deno'
    ? (code) => (globalThis as unknown as { Deno: { exit(c: number): void } }).Deno.exit(code)
    : (code) => process.exit(code);

// ─── tiny test harness ──────────────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), `mediaforge-runtime-${RUNTIME}-`));
const p = (name: string) => path.join(TMP, name);

const errors: { label: string; error: string; stack: string }[] = [];
let passed = 0;
let skipped = 0;

async function run(label: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✅ ${label}`);
    passed++;
  } catch (err) {
    const e = err as Error;
    console.log(`  ❌ ${label}\n       ${e?.message ?? String(err)}`);
    errors.push({ label, error: e?.message ?? String(err), stack: e?.stack ?? '' });
  }
}

function skip(label: string, reason: string): void {
  console.log(`  ⏭  ${label} (${reason})`);
  skipped++;
}

function section(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);
}

function ffmpegExec(args: string): void {
  const argv = args.trim().match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  execFileSync('ffmpeg', ['-y', ...argv.map(a => (a.startsWith('"') ? a.slice(1, -1) : a))], { stdio: 'pipe' });
}

function hasFilter(name: string): boolean {
  try {
    const out = execFileSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8', stdio: 'pipe' });
    return new RegExp(`\\b${name}\\b`).test(out);
  } catch {
    return false;
  }
}

const HAS_ZSCALE = hasFilter('zscale');
const HAS_TONEMAP = hasFilter('tonemap');
const HAS_LIBMETRIX = hasFilter('libvmaf');
const HAS_DRAW_TEXT = hasFilter('drawtext');

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) fail(message);
}

/** Assert that `fn` throws, optionally matching a message or error constructor. */
function throws(fn: () => unknown, expected: RegExp | (new (...a: never[]) => Error), what: string): void {
  let msg = '';
  let err: Error | null = null;
  try {
    fn();
  } catch (e) {
    err = e as Error;
    msg = err.message;
  }
  assert(err !== null, `${what}: expected a throw, got none`);
  if (expected === RangeError) {
    assert(err instanceof RangeError, `${what}: expected a RangeError, got ${err?.constructor.name} — ${msg}`);
    return;
  }
  if (typeof expected === 'function') {
    assert(err instanceof expected, `${what}: expected ${expected.name}, got ${err?.constructor.name} — ${msg}`);
    return;
  }
  assert(expected.test(msg), `${what}: unexpected message — ${msg}`);
}

const durationOf = (file: string): number => {
  const info = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file], { encoding: 'utf8' }),
  );
  return Number(info.format?.duration);
};

// ─── setup ──────────────────────────────────────────────────────────────────
section(`SETUP (${RUNTIME})`);

await run('generate src.mp4 (4s 320x180 video+audio)', () => {
  ffmpegExec(
    '-f lavfi -i testsrc=duration=4:size=320x180:rate=15 ' +
    '-f lavfi -i sine=frequency=440:duration=4 ' +
    '-c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -movflags +faststart ' + p('src.mp4'),
  );
});

await run('generate lossy.mp4 (crf 40 re-encode)', () => {
  ffmpegExec(
    `-i ${p('src.mp4')} -c:v libx264 -preset veryfast -crf 40 -pix_fmt yuv420p -c:a aac ${p('lossy.mp4')}`,
  );
});

await run('generate with_subs.mkv (video + audio + srt)', () => {
  fs.writeFileSync(
    p('subs.srt'),
    '1\n00:00:00,500 --> 00:00:02,000\nHello world\n\n2\n00:00:03,000 --> 00:00:04,000\nTest subtitle\n',
  );
  ffmpegExec(
    '-f lavfi -i testsrc=duration=4:size=320x180:rate=15 ' +
    '-f lavfi -i sine=frequency=440:duration=4 ' +
    `-i ${p('subs.srt')} -c:v libx264 -preset ultrafast -c:a aac -c:s srt ${p('with_subs.mkv')}`,
  );
});

await run('generate tone_gap.wav (tone, silence, tone)', () => {
  // Three separate inputs: a multi-source lavfi graph needs one -i per source.
  ffmpegExec(
    '-f lavfi -i "sine=frequency=440:duration=1" ' +
    '-f lavfi -i "sine=frequency=880:duration=1,volume=0.0001" ' +
    '-f lavfi -i "sine=frequency=440:duration=1" ' +
    '-filter_complex "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]" ' +
    '-map "[out]" -c:a pcm_s16le ' + p('tone_gap.wav'),
  );
});

await run('generate cut.mp4 (three hard-cut scenes)', () => {
  ffmpegExec(
    '-f lavfi -i testsrc=duration=1.5:size=160x90:rate=15 ' +
    '-f lavfi -i color=blue:duration=1.5:size=160x90:rate=15 ' +
    '-f lavfi -i color=green:duration=1.5:size=160x90:rate=15 ' +
    '-filter_complex "[0:v][1:v][2:v]concat=n=3:v=1:a=0[out]" -map "[out]" ' +
    '-c:v libx264 -preset ultrafast -pix_fmt yuv420p ' + p('cut.mp4'),
  );
});

await run('generate sdr10.mp4 and hdr.mp4 (10-bit BT.709 / BT.2020 PQ)', () => {
  ffmpegExec(
    '-f lavfi -i testsrc=duration=2:size=160x90:rate=15 ' +
    '-c:v libx264 -preset ultrafast -pix_fmt yuv420p10le ' +
    '-color_primaries bt709 -color_trc bt709 -colorspace bt709 ' + p('sdr10.mp4'),
  );
  ffmpegExec(
    '-f lavfi -i testsrc=duration=2:size=160x90:rate=15 ' +
    '-c:v libx264 -preset ultrafast -pix_fmt yuv420p10le ' +
    '-color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc ' + p('hdr.mp4'),
  );
});

// ─── 1. Pure builders (no ffmpeg needed) ───────────────────────────────────
section('Pure builders');

await run('quality filter builders produce real ffmpeg syntax', () => {
  assert(buildVmafFilter() === 'libvmaf=log_fmt=json', 'buildVmafFilter default');
  assert(buildVmafFilter({ target: 90 }).includes('target=90'), 'vmaf target');
  // "=" must not be escaped inside a single-quoted filtergraph value.
  const m = buildVmafFilter({ model: 'version=v0.6.1' });
  assert(!m.includes('\\='), `"=" was escaped: ${m}`);
  assert(buildSsimFilter() === 'ssim', 'ssim default');
  assert(buildPsnrFilter({ statsFile: '/tmp/a.log' }).includes("stats_file='/tmp/a.log'"), 'psnr stats');
});

await run('parseStatsFile accepts an infinite PSNR (identical frames)', () => {
  const s = parseStatsFile('n:1 mse_avg:0 psnr_avg:inf', 'psnr');
  assert(s.value === Number.POSITIVE_INFINITY, `expected Infinity, got ${s.value}`);
  assert(s.metric === 'psnr', 'metric');
});

await run('parseVmafLog rejects a log with no pooled score', () => {
  throws(() => parseVmafLog('{"version":"v3"}'), /pooled_metrics\.vmaf\.mean/, 'parseVmafLog');
});

await run('buildToneMapFilter uses zscale short option names', () => {
  const f = buildToneMapFilter();
  const parts = f.split(',');
  assert(parts.length === 3, `expected 3 stages: ${f}`);
  assert(parts[0]!.startsWith('zscale=t=linear'), `stage 1: ${parts[0]}`);
  assert(/zscale=t=linear[^,]*:p=bt2020/.test(f), `primaries via p=: ${f}`);
  assert(!/zscale=[^,]*\b(width|height)=/.test(f), `used pixel-size options: ${f}`);
  assert(Object.keys(TONE_MAP_ALGORITHMS).length === 6, 'TONE_MAP_ALGORITHMS');
});

await run('buildToneMapFilter rejects a parameter on a non-parametric algorithm', () => {
  throws(() => buildToneMapFilter({ algorithm: 'hable', parameter: 0.3 }), /parameter only applies/, 'hable');
  throws(() => buildToneMapFilter({ algorithm: 'bogus' as never }), /unknown algorithm/, 'bogus');
});

await run('buildInterpolateFilter omits mb_size/mc_mode for blend', () => {
  const r = buildInterpolateFilter({ fps: 30, method: 'blend' });
  assert(r.includes('mi_mode=blend'), r);
  // ffmpeg errors with "Error setting option mb_size" for dup/blend
  assert(!r.includes('mb_size='), `mb_size emitted for blend: ${r}`);
  assert(!r.includes('mc_mode='), `mc_mode emitted for blend: ${r}`);
});

await run('buildInterpolateFilter rejects invented option values', () => {
  throws(() => buildInterpolateFilter({ fps: 60, method: 'mi' as never }), /unknown method "mi"/, 'mi');
  throws(() => buildInterpolateFilter({ fps: 60, mcMode: 'mci' as never }), /unknown mcMode "mci"/, 'mci');
  throws(() => buildInterpolateFilter({ fps: 0 }), RangeError, 'fps 0');
});

await run('buildSceneCutArgs produces [0,s0],[s0,s1] windows', () => {
  const a = buildSceneCutArgs(
    [{ timestamp: 2, sceneNumber: 1 }, { timestamp: 4, sceneNumber: 2 }],
  );
  assert(a.join(' ') === '-ss 0.000 -to 2.000 -ss 2.000 -to 4.000', `got: ${a.join(' ')}`);
  assert(buildSceneCutArgs([]).length === 0, 'no boundaries → no windows');
});

await run('buildSceneCutArgs({trimStart}) shortens each window from its end', () => {
  const a = buildSceneCutArgs([{ timestamp: 2, sceneNumber: 1 }], { trimStart: 0.2 });
  assert(a[3] === '1.800', `window end: ${a[3]}`);
});

await run('buildSilenceRemoveFilter uses real silenceremove option names', () => {
  const r = buildSilenceRemoveFilter({ threshold: -35, minDuration: 0.4 });
  assert(!r.includes('threshold_n'), `invented option: ${r}`);
  assert(r.includes('start_threshold=-35dB'), r);
  assert(r.includes('stop_periods=-1'), r);
});

await run('buildSegmentArgs forces keyframes at the boundaries', () => {
  const a = buildSegmentArgs({ input: 'in.mp4', outputPattern: 'seg%03d.ts', segmentTime: 1 });
  const i = a.indexOf('-force_key_frames');
  assert(i !== -1, 'no -force_key_frames');
  assert(a[i + 1] === 'expr:gte(t,n_forced*1)', a[i + 1]);
  throws(() => buildSegmentArgs({ input: 'in.mp4', outputPattern: 'out.ts' }), /printf-style index/, 'no %d');
});

await run('hardware filter builders compose a valid chain', () => {
  const chain = buildHwFilterChain({
    accel: 'cuda',
    gpuFilters: [buildHwScaleFilter({ accel: 'cuda', width: 1280, height: 720 })],
    cpuFilters: ['drawtext=text=hi'],
  });
  assert(chain === 'hwupload,scale_cuda=w=1280:h=720,hwdownload=format=nv12,drawtext=text=hi', chain);
  assert(buildHwUploadFilter({ accel: 'cuda' }) === 'hwupload', 'hwupload');
  assert(buildHwDownloadFilter() === 'hwdownload=format=nv12', 'hwdownload');
  assert(HWACCELS.includes('cuda' as never), 'HWACCELS');
});

await run('hardware builders throw rather than silently degrading', () => {
  // videotoolbox has no GPU scaler — emitting a software `scale` would look accelerated
  throws(() => buildHwScaleFilter({ accel: 'videotoolbox', width: 640, height: 360 }), /no GPU scaler/, 'vtbox');
  throws(() => buildHwFilterChain({ accel: 'cuda', gpuFilters: [] }), /gpuFilters is empty/, 'empty');
  throws(() => buildHwUploadFilter({ accel: 'nope' as never }), /Unknown hwaccel/, 'unknown');
});

await run('subtitle codec/extension mapping matches ffmpeg', () => {
  assert(subtitleCodecFor('vtt') === 'webvtt', 'vtt → webvtt');
  assert(subtitleCodecFor('mov_text') === 'mov_text', 'mov_text');
  assert(subtitleExtensionFor('mov_text') === '.m4v', 'mov_text extension');
  assert(subtitleExtensionFor('vtt') === '.vtt', 'vtt extension');
  throws(() => subtitleCodecFor('bogus' as never), /Unknown subtitle format/, 'bogus');
});

await run('ABR variant validation rejects odd dimensions from every entry point', () => {
  throws(
    () => validateAbrVariants([{ name: 'odd', resolution: '1281x720', videoBitrate: '2M' }]),
    /width of variant "odd" is 1281, which is odd/,
    'validateAbrVariants',
  );
  throws(
    () => buildAbrLadderArgs({
      input: 'in.mp4', outputPattern: 'v%v/i.m3u8',
      variants: [{ name: 'odd', resolution: '641x361', videoBitrate: '1M' }],
    }),
    /is odd/,
    'buildAbrLadderArgs',
  );
});

await run('ABR ladder builders produce a correct single-pass arg list', () => {
  const map = buildVarStreamMap([
    { name: '720p', resolution: '1280x720', videoBitrate: '2.5M' },
    { name: '360p', resolution: '640x360', videoBitrate: '800k' },
  ]);
  assert(map.map === 'v:0,a:0,name:720p v:1,a:1,name:360p', map.map);
  assert(map.streamCount === 2, 'streamCount');

  const filter = buildAbrLadderFilter({
    variants: [
      { name: '720p', resolution: '1280x720', videoBitrate: '2.5M' },
      { name: '360p', resolution: '640x360', videoBitrate: '800k' },
    ],
  });
  assert(filter.includes('[0:v]split=2[v0][v1]'), filter);
  assert(!filter.endsWith(';'), `ffmpeg 4.x rejects a trailing ";": ${filter}`);

  const args = buildAbrLadderArgs({
    input: 'in.mp4', outputPattern: 'v%v/index.m3u8',
    variants: [{ name: 'x', resolution: '640x360', videoBitrate: '1M' }],
    masterPlaylist: 'master.m3u8',
  });
  const joined = args.join(' ');
  assert(joined.includes('-var_stream_map v:0,a:0,name:x'), joined);
  // ffmpeg resolves -master_pl_name against the output dir and prepends it
  // even to an absolute path, so it must be a bare filename.
  const mi = args.indexOf('-master_pl_name');
  assert(args[mi + 1] === 'master.m3u8' && !args[mi + 1]!.includes('/'), `master pl: ${args[mi + 1]}`);
});

await run('delogo validates its geometry', () => {
  assert(delogo({ x: 10, y: 20, width: 100, height: 50 }) === 'delogo=x=10:y=20:w=100:h=50', 'serialised');
  throws(() => delogo({ x: -1, y: 0, width: 10, height: 10 }), RangeError, 'negative x');
  throws(() => delogo({ x: 0, y: 0, width: 0, height: 10 }), RangeError, 'zero width');
});

await run('encode controls reach the command line with validated input', () => {
  const args = ffmpegBuilder(p('src.mp4')).output(p('ec.mp4'))
    .preset('ultrafast').profile('baseline').level('3.0').movflags('+faststart')
    .keyframeInterval(30).fpsMode('cfr')
    .rateControl({ min: '200k', max: '800k', bufferSize: '1600k' })
    .setColorProperties({ color_primaries: 'bt709', color_trc: 'bt709' })
    .buildArgs();
  const joined = args.join(' ');
  for (const expect of [
    '-preset ultrafast', '-profile:v baseline', '-level:v 3.0', '-movflags +faststart',
    '-g 30', '-minrate 200k', '-maxrate 800k', '-bufsize 1600k',
    '-color_primaries bt709', '-color_trc bt709',
  ]) {
    assert(joined.includes(expect), `missing ${expect}: ${joined}`);
  }
  // the frame-rate flag is version-dependent; either name is valid, a wrong one is not
  const mode = FPS_MODES.includes('cfr' as never) ? true : false;
  assert(mode, 'FPS_MODES should list cfr');
  assert(joined.includes('-fps_mode cfr') || joined.includes('-vsync cfr'), `no frame-rate flag: ${joined}`);
});

await run('encode controls reject invalid input instead of emitting garbage', () => {
  throws(() => ffmpegBuilder('in.mp4').output('o.mp4').fpsMode('bogus' as never), /unknown mode/, 'fpsMode');
  throws(() => ffmpegBuilder('in.mp4').output('o.mp4').rateControl({} as never), /max/, 'rateControl');
  throws(() => ffmpegBuilder('in.mp4').output('o.mp4').setColorProperties({}), /at least one of/, 'setColorProperties');
  throws(
    () => ffmpegBuilder('in.mp4').output('o.mp4').setColorProperties({ nope: 'x' } as never),
    /nope/,
    'unknown colour key',
  );
  assert(COLOR_PROPERTY_KEYS.length === 4, 'COLOR_PROPERTY_KEYS');
});

await run('CLI task table is complete and self-consistent', () => {
  assert(Object.keys(CLI_TASKS).length >= 50, `expected 50+ tasks, got ${Object.keys(CLI_TASKS).length}`);
  for (const [name, t] of Object.entries(CLI_TASKS)) {
    assert(typeof t.run === 'function', `${name} has no run()`);
    assert(t.usage.startsWith(`mediaforge ${name} `), `${name} usage: ${t.usage}`);
    // every declared flag must appear in the usage line
    for (const flag of Object.keys(t.flags)) {
      assert(t.usage.includes(`--${flag}`), `${name} declares --${flag} but usage omits it`);
    }
  }
  assert(taskHelpText().includes('TASK COMMANDS'), 'help text');
  assert(taskDetail('trim').includes('--start'), 'taskDetail');
  assert(taskDetail('nope').includes('mediaforge help'), 'taskDetail for an unknown task');
});

await run('parseTaskArgs handles flags, booleans and negative values', () => {
  const r = parseTaskArgs(['in.mp4', 'out.mp4', '--start', '1', '--end=9', '--burn']);
  assert(r.positional.join(',') === 'in.mp4,out.mp4', 'positionals');
  assert(r.flags['end'] === '9' && r.flags['burn'] === true, 'flags');
  assert(parseTaskArgs(['x', '--start', '-3.5']).flags['start'] === '-3.5', 'negative value');
});

await run('every CLI task refuses an empty argument list', async () => {
  // `features` is a listing command: it takes no positionals, so an empty
  // invocation legitimately prints its table instead of erroring.
  for (const [name, t] of Object.entries(CLI_TASKS)) {
    if (name === 'features') continue;
    let msg = '';
    try {
      await t.run([], {});
    } catch (e) { msg = (e as Error).message; }
    assert(msg !== '', `${name} accepted an empty argument list`);
    assert(msg.includes('Usage:') || /needs \d+ argument/.test(msg), `${name} gave no usage: ${msg}`);
  }
});

await run('the filter registry and the arg tables are available on every runtime', async () => {
  const reg = await import('../lib/cli/filter-registry.ts');
  const extra = await import('../lib/cli/tasks.extra.ts');
  assert(reg.filterNames().length === 77, `filter registry: ${reg.filterNames().length}`);
  assert(extra.argOpNames().length >= 55, `arg builders: ${extra.argOpNames().length}`);
  assert(extra.codecBuilderNames().length >= 35, `codec builders: ${extra.codecBuilderNames().length}`);
  // Spot-check that the accessors work without a build step.
  const printed = await reg.FILTER_REGISTRY['unsharp']!.apply(
    new (await import('../lib/types/filters.ts')).FilterChain(),
    { lx: 5 },
  ).toString();
  assert(printed === 'unsharp=lx=5', `unsharp via the registry: ${printed}`);
});

await run('every runtime export is reachable from the CLI or documented', async () => {
  const lib = await import('../lib/index.ts');
  const { LIBRARY_ONLY, INTERNAL_NOTES } = await import('../lib/cli/tasks.extra.ts');
  // Reading the CLI sources is the honest reachability check: an export counts
  // as reachable when the CLI names it, or when a reason is recorded.
  const files = [
    'lib/cli/tasks.ts', 'lib/cli/tasks.extra.ts', 'lib/cli/filter-registry.ts',
    'lib/cli/index.ts', 'lib/cli/flags.ts', 'lib/cli/types.ts',
  ];
  const src = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const named = new Set<string>();
  for (const mt of src.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) named.add(mt[1]!);
  const missing = Object.keys(lib).filter(
    (n) => !named.has(n) && !(n in LIBRARY_ONLY) && !/^[A-Z0-9_]+$/.test(n),
  );
  assert(missing.length === 0, `unreachable from the CLI: ${missing.join(', ')}`);
  for (const n of Object.keys(INTERNAL_NOTES)) {
    assert(!(n in lib), `${n} is a public export, so it belongs in LIBRARY_ONLY`);
  }
});

await run('graph, map and preset print their work without an encoder', async () => {
  // These are the library-surface commands whose output is text, so they can be
  // asserted identically on all three runtimes.
  const seen: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => { seen.push(a.map(String).join(' ')); };
  try {
    await CLI_TASKS['preset']!.run(['web', 'in.mp4', 'out.mp4'], { print: 'true' });
    await CLI_TASKS['map']!.run(['in.mp4', 'out.mp4'], { video: 'all', print: 'true' });
    await CLI_TASKS['graph']!.run(
      ['in.mp4', 'out.mp4'],
      { pipeline: '[{"from":"0:v","filter":"scale","args":["160","90"]}]', print: 'true' },
    );
  } finally {
    console.log = orig;
  }
  const out = seen.join('\n');
  assert(out.includes('-crf 23'), `preset: ${out}`);
  assert(out.includes('-map 0:v'), `map: ${out}`);
  assert(out.includes('scale=160:90'), `graph: ${out}`);
});

await run('the new commands reject unknown options and list the accepted ones', async () => {
  // These commands take their options as positional `key=value` tokens, so an
  // unknown key has to be named rather than silently ignored.
  for (const [name, pos] of [
    ['filter', ['unsharp', 'nope=1', 'in.mp4', 'out.mp4']],
    ['codec', ['x264', 'nope=1']],
    ['args', ['screenshot', 'nope=1']],
  ] as Array<[string, string[]]>) {
    let msg = '';
    try {
      await CLI_TASKS[name]!.run(pos, { print: 'true' });
    } catch (e) { msg = (e as Error).message; }
    assert(msg.includes('nope'), `${name} did not name the unknown option: ${msg}`);
    assert(msg.includes('Accepted:'), `${name} did not list the accepted options: ${msg}`);
  }
});

// ─── 2. Real encodes ───────────────────────────────────────────────────────
section('Real ffmpeg work');

await run('measureQuality(ssim) on identical files → 1.0', async () => {
  const s = await measureQuality({ reference: p('src.mp4'), distorted: p('src.mp4'), metric: 'ssim' });
  assert(s.value > 0.999, `expected ~1.0, got ${s.value}`);
  assert(s.frames !== undefined && s.frames > 0, 'frame count');
});

await run('measureQuality(psnr) on identical files → Infinity, clears any minimum', async () => {
  const s = await measureQuality({
    reference: p('src.mp4'), distorted: p('src.mp4'), metric: 'psnr', minScore: 0,
  });
  assert(s.value === Number.POSITIVE_INFINITY, `expected Infinity, got ${s.value}`);
});

await run('measureQuality(ssim) on a lossy encode → below the gate, message names both numbers', async () => {
  try {
    await measureQuality({ reference: p('src.mp4'), distorted: p('lossy.mp4'), metric: 'ssim', minScore: 0.99 });
    fail('expected a throw');
  } catch (e) {
    const msg = (e as Error).message;
    assert(/below the required minimum/.test(msg), `message: ${msg}`);
    assert(/0\.99/.test(msg), `should quote the minimum: ${msg}`);
  }
});

if (HAS_LIBMETRIX) {
  await run('measureQuality(vmaf) → 0-100 score', async () => {
    const s = await measureQuality({ reference: p('src.mp4'), distorted: p('lossy.mp4'), metric: 'vmaf' });
    assert(s.value >= 0 && s.value <= 100, `vmaf out of range: ${s.value}`);
  });
} else {
  skip('measureQuality(vmaf)', 'this ffmpeg build has no libvmaf');
  await run('measureQuality(vmaf) without libvmaf → a clear "not available" error', async () => {
    try {
      await measureQuality({ reference: p('src.mp4'), distorted: p('src.mp4'), metric: 'vmaf' });
      fail('expected a throw');
    } catch (e) {
      const msg = (e as Error).message;
      assert(/not available in this ffmpeg build/.test(msg), `message: ${msg}`);
      assert(/compiled with libvmaf/.test(msg), `should say what is missing: ${msg}`);
    }
  });
}

if (HAS_ZSCALE && HAS_TONEMAP) {
  await run('toneMapHdrToSdr on a real BT.2020/PQ file → tagged bt709', async () => {
    await toneMapHdrToSdr({ input: p('hdr.mp4'), output: p('tonemapped.mp4'), videoCodec: 'libx264' });
    const info = JSON.parse(
      execFileSync('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0', '-show_entries',
        'stream=color_space,color_transfer,color_primaries', '-of', 'json', p('tonemapped.mp4'),
      ], { encoding: 'utf8' }),
    );
    const s = info.streams?.[0] ?? {};
    assert(s.color_transfer === 'bt709', `color_transfer: ${s.color_transfer}`);
  });

  await run('toneMapHdrToSdr({requireHdrInput:false}) on SDR 10-bit → allowed', async () => {
    await toneMapHdrToSdr({
      input: p('sdr10.mp4'), output: p('tonemapped_sdr.mp4'),
      requireHdrInput: false, videoCodec: 'libx264',
    });
    assert(fs.existsSync(p('tonemapped_sdr.mp4')), 'output not created');
  });

  await run('toneMapHdrToSdr() on an SDR file → refuses with guidance', async () => {
    try {
      await toneMapHdrToSdr({ input: p('sdr10.mp4'), output: p('nope.mp4') });
      fail('expected a throw');
    } catch (e) {
      const msg = (e as Error).message;
      assert(/does not look like HDR/.test(msg), `message: ${msg}`);
      assert(/requireHdrInput: false/.test(msg), `should offer the escape hatch: ${msg}`);
    }
  });
} else {
  skip('toneMapHdrToSdr', 'ffmpeg build has no zscale/tonemap');
}

await run('isHdr() agrees with the fixture', () => {
  assert(isHdr(probe(p('hdr.mp4'))) === true, 'hdr.mp4 should be HDR');
  assert(isHdr(probe(p('sdr10.mp4'))) === false, 'sdr10.mp4 should not be HDR');
});

await run('interpolateFrames(dup) → a real 30fps file', async () => {
  await interpolateFrames({ input: p('src.mp4'), output: p('interp.mp4'), fps: 30, method: 'dup' });
  const info = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=avg_frame_rate', '-of', 'json', p('interp.mp4')], { encoding: 'utf8' }),
  );
  assert(String(info.streams?.[0]?.avg_frame_rate).startsWith('30/'), 'avg_frame_rate');
});

await run('detectScenes finds the hard cuts', async () => {
  const scenes = await detectScenes({ input: p('cut.mp4'), threshold: 0.1 });
  assert(Array.isArray(scenes), 'not an array');
  assert(scenes.length > 0, 'no scene changes detected');
  assert(typeof scenes[0]!.timestamp === 'number', 'timestamp');
});

await run('cutToScenes → an auto-edited file', async () => {
  await cutToScenes({ input: p('cut.mp4'), output: p('cut_out.mp4'), threshold: 0.1 });
  assert(fs.statSync(p('cut_out.mp4')).size > 0, 'output is empty');
});

await run('removeSilence → a shorter file', async () => {
  const before = durationOf(p('tone_gap.wav'));
  await removeSilence({ input: p('tone_gap.wav'), output: p('trimmed.wav'), threshold: -50, minDuration: 0.2 });
  const after = durationOf(p('trimmed.wav'));
  assert(after < before, `expected shorter: ${before} → ${after}`);
});

await run('writeSegments → one file per interval, output dir created', async () => {
  const dir = path.join(TMP, 'segs');
  await writeSegments({ input: p('src.mp4'), outputPattern: path.join(dir, 'seg%03d.ts'), segmentTime: 1 });
  const segs = fs.readdirSync(dir).filter(f => /^seg\d{3}\.ts$/.test(f));
  // the segment muxer can only cut on keyframes; forcing them is what makes this 4
  assert(segs.length >= 4, `expected ≥4 segments, got ${segs.length}: ${segs.join(', ')}`);
});

await run('convertSubtitles → a real sidecar with the cues', async () => {
  await convertSubtitles({ input: p('with_subs.mkv'), output: p('converted.srt'), format: 'srt' });
  const body = fs.readFileSync(p('converted.srt'), 'utf8');
  assert(body.includes('Hello world'), 'cues missing');
  assert(/-->/.test(body), 'no cue timings');
});

await run('convertSubtitles(vtt) → a WEBVTT file', async () => {
  await convertSubtitles({ input: p('with_subs.mkv'), output: p('converted.vtt'), format: 'webvtt' });
  assert(fs.readFileSync(p('converted.vtt'), 'utf8').startsWith('WEBVTT'), 'no WEBVTT header');
});

await run('convertSubtitles rejects two timing fixes at once', async () => {
  try {
    await convertSubtitles({ input: p('with_subs.mkv'), output: p('x.srt'), shiftSeconds: 1, fixDuration: true });
    fail('expected a throw');
  } catch (e) {
    assert(/cannot both be set/.test((e as Error).message), (e as Error).message);
  }
});

await run('fixSubtitleDuration → rewritten cue timings', async () => {
  await fixSubtitleDuration({ input: p('with_subs.mkv'), output: p('fixed.srt'), format: 'srt' });
  assert(/-->/.test(fs.readFileSync(p('fixed.srt'), 'utf8')), 'no cue timings');
});

await run('convertSubtitles({burn:true}) leaves no temp sidecar behind', async () => {
  if (!HAS_DRAW_TEXT) { skip('burn path', 'no drawtext filter'); return; }
  const before = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('mediaforge-subs-'));
  await convertSubtitles({ input: p('with_subs.mkv'), output: p('burned.mp4'), format: 'srt', burn: true });
  assert(fs.statSync(p('burned.mp4')).size > 0, 'output is empty');
  const after = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('mediaforge-subs-'));
  const leaked = after.filter(f => !before.includes(f));
  assert(leaked.length === 0, `temp dir leaked: ${leaked.join(', ')}`);
});

await run('abrLadder → two renditions plus a master playlist', async () => {
  const dir = path.join(TMP, 'abr');
  await abrLadder({
    input: p('src.mp4'),
    outputPattern: path.join(dir, 'v%v/index.m3u8'),
    variants: [
      { name: '720p', resolution: '320x180', videoBitrate: '400k' },
      { name: '360p', resolution: '160x90', videoBitrate: '150k' },
    ],
    segmentDuration: 1,
    videoCodec: 'libx264',
  }).run();
  const master = path.join(dir, 'master.m3u8');
  assert(fs.existsSync(master), `no master playlist: ${fs.readdirSync(dir).join(', ')}`);
  assert(fs.readFileSync(master, 'utf8').includes('#EXT-X-STREAM-INF'), 'no variant entries');
});

await run('delogo → a real, playable file', async () => {
  await ffmpegBuilder(p('src.mp4')).output(p('delogo.mp4'))
    .videoFilter(delogo({ x: 10, y: 10, width: 60, height: 40 }))
    .run();
  assert(fs.statSync(p('delogo.mp4')).size > 0, 'output is empty');
});

await run('encode controls together → a real file', async () => {
  await ffmpegBuilder(p('src.mp4')).output(p('controls.mp4'))
    .preset('ultrafast').profile('baseline').level('3.0').movflags('+faststart')
    .keyframeInterval(30).fpsMode('cfr')
    .setColorProperties({ color_primaries: 'bt709', color_trc: 'bt709' })
    .run();
  assert(fs.statSync(p('controls.mp4')).size > 0, 'output is empty');
});

await run('concatFiles(copy) joins two files', async () => {
  const { concatFiles } = await import('../lib/index.ts');
  await concatFiles({ inputs: [p('src.mp4'), p('src.mp4')], output: p('concat.mp4'), copy: true });
  assert(fs.statSync(p('concat.mp4')).size > 0, 'output is empty');
  assert(durationOf(p('concat.mp4')) > 6, 'expected ~8s from two 4s inputs');
});

// ─── 3. CLI end to end (Node/Bun only — Deno has no dist/ to execute) ──────
const CLI = path.resolve('dist/esm/cli/index.js');
if (RUNTIME === 'deno' || !fs.existsSync(CLI)) {
  skip('CLI end-to-end', RUNTIME === 'deno' ? 'Deno imports the TS source; the binary suite covers this' : 'run npm run build first');
} else {
  section(`CLI end to end (${RUNTIME})`);
  const cli = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 180_000 });
  const ok = (r: { status: number | null }, what: string) => assert(r.status === 0, `${what} exited ${r.status}`);

  await run('cli version', () => {
    const r = cli('version');
    ok(r, 'version');
    assert(/\d+\.\d+\.\d+/.test(r.stdout), `no version: ${r.stdout}`);
  });

  await run('cli help lists the task commands', () => {
    const r = cli('help');
    ok(r, 'help');
    assert(r.stdout.includes('TASK COMMANDS'), 'no task section');
    for (const n of Object.keys(CLI_TASKS)) assert(r.stdout.includes(n), `help omits ${n}`);
  });

  await run('cli unknown-command → actionable error', () => {
    const r = cli('not-a-command', 'x');
    assert(r.status !== 0, 'exited 0');
    assert(/unknown command/i.test(r.stdout + r.stderr), 'no unknown-command message');
  });

  await run('cli probe → JSON with all three stream types', () => {
    const r = cli('probe', p('with_subs.mkv'));
    ok(r, 'probe');
    const types = new Set(JSON.parse(r.stdout).streams.map((s: { codec_type?: string }) => s.codec_type));
    for (const t of ['video', 'audio', 'subtitle']) assert(types.has(t), `probe missed the ${t} stream`);
  });

  await run('cli trim --start 1 --end 2 → a ~1s clip', () => {
    const r = cli('trim', p('src.mp4'), p('cli_trim.mp4'), '--start', '1', '--end', '2');
    ok(r, 'trim');
    const d = durationOf(p('cli_trim.mp4'));
    assert(d > 0.4 && d < 1.6, `duration ${d}s, expected ~1s`);
  });

  await run('cli chapters --chapters "Intro:0,Outro:2" → chapters are muxed in', () => {
    const r = cli('chapters', p('src.mp4'), p('cli_ch.mp4'), '--chapters', 'Intro:0,Outro:2');
    ok(r, 'chapters');
    const info = JSON.parse(
      execFileSync('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', p('cli_ch.mp4')], { encoding: 'utf8' }),
    );
    assert((info.chapters ?? []).length >= 2, 'chapters not muxed');
  });

  await run('cli quality --metric ssim --min 0.99 on a lossy file → non-zero exit', () => {
    const r = cli('quality', p('src.mp4'), p('lossy.mp4'), '--metric', 'ssim', '--min', '0.99');
    assert(r.status !== 0, 'exited 0 despite failing the gate');
    assert(/below the required minimum/.test(r.stdout + r.stderr), 'unhelpful failure');
  });

  await run('cli interpolate --fps 30 --method dup', () => {
    const r = cli('interpolate', p('src.mp4'), p('cli_interp.mp4'), '--fps', '30', '--method', 'dup');
    ok(r, 'interpolate');
    assert(fs.statSync(p('cli_interp.mp4')).size > 0, 'empty output');
  });

  await run('cli silence --detect → report, no output file', () => {
    const r = cli('silence', p('tone_gap.wav'), p('unused.mp3'), '--threshold', '-50', '--min', '0.2', '--detect');
    ok(r, 'silence --detect');
    assert(/silent segment/.test(r.stdout), `no report: ${r.stdout.slice(-200)}`);
    assert(!fs.existsSync(p('unused.mp3')), '--detect wrote an output file');
  });

  await run('cli scenes without --cut → report, no output file', () => {
    const r = cli('scenes', p('cut.mp4'), p('unused_scenes.mp4'), '--threshold', '0.1');
    ok(r, 'scenes');
    assert(/scene change/.test(r.stdout), 'no report');
    assert(!fs.existsSync(p('unused_scenes.mp4')), 'wrote an output without --cut');
  });

  await run('cli delogo → a de-logoed file', () => {
    const r = cli('delogo', p('src.mp4'), p('cli_delogo.mp4'), '--x', '10', '--y', '10', '--width', '60', '--height', '40');
    ok(r, 'delogo');
    assert(fs.statSync(p('cli_delogo.mp4')).size > 0, 'empty output');
  });

  await run('cli thumbnail out.jpg really writes a JPEG', () => {
    const r = cli('thumbnail', p('src.mp4'), p('cli_thumb.jpg'), '--at', '1');
    ok(r, 'thumbnail');
    const head = fs.readFileSync(p('cli_thumb.jpg')).subarray(0, 3);
    assert(head[0] === 0xff && head[1] === 0xd8, 'not a JPEG');
  });

  await run('cli with a misspelled task flag → hard error, no output', () => {
    const r = cli('trim', p('src.mp4'), p('cli_typo.mp4'), '--star', '1');
    assert(r.status !== 0, 'a misspelled flag was silently ignored');
    assert(/unknown flag --star/.test(r.stdout + r.stderr), 'unhelpful error');
    assert(!fs.existsSync(p('cli_typo.mp4')), 'produced an output despite the bad flag');
  });

  await run('every task with too few positionals exits non-zero and shows usage', () => {
    for (const name of Object.keys(CLI_TASKS)) {
      // Listing-only commands take no positionals, so they print their table
      // and exit 0 instead of erroring.
      if (name === 'features') {
        const listed = cli(name);
        ok(listed, name);
        assert(listed.stdout.trim() !== '', `${name} printed nothing`);
        continue;
      }
      const r = cli(name);
      assert(r.status !== 0, `${name} exited 0 with no arguments`);
      assert(/Error:/.test(r.stdout + r.stderr), `${name} gave no Error line`);
      assert((r.stdout + r.stderr).includes(`mediaforge ${name}`), `${name} did not show its usage`);
    }
  });
}

// ─── summary ────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log(`  RUNTIME BATTLE — ${RUNTIME}`);
console.log('═'.repeat(60));
console.log(`  ✅ PASSED : ${passed}`);
console.log(`  ⏭  SKIPPED: ${skipped}`);
console.log(`  ❌ FAILED : ${errors.length}`);

if (errors.length > 0) {
  console.log(`\n${'─'.repeat(60)}`);
  for (let i = 0; i < errors.length; i++) {
    console.log(`\n  [${i + 1}] ${errors[i]!.label}`);
    console.log(`       ERROR : ${errors[i]!.error}`);
    const stack = errors[i]!.stack.split('\n').slice(1, 3).join('\n       ');
    if (stack) console.log(`       STACK : ${stack}`);
  }
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${errors.length} test(s) failed on ${RUNTIME}.`);
  console.log('─'.repeat(60));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
  exit(1);
} else {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
  console.log(`\n  All ${passed} runtime tests passed on ${RUNTIME}! 🎉`);
}
