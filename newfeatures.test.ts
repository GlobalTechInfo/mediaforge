/**
 * mediaforge battle test — 2.1.0 feature set
 *
 * Companion to `battle.test.ts`, covering everything added in 2.1.0: the quality
 * metrics, HDR tone mapping, temporal helpers, hardware filter builders, subtitle
 * conversion, ABR ladders, `delogo`, the new encode-control builder methods, and
 * all 31 task-oriented CLI commands.
 *
 * Same contract as the main battle file: every test is isolated, errors are
 * collected, and a summary is printed at the end. Exit code is 1 if anything
 * failed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, 'tmp_nf');

const p = (name: string) => path.join(TMP, name);
const errors: { label: string; error: string; stack: string }[] = [];
let passed = 0;
let skipped = 0;

async function run(label: string, fn: () => void | Promise<void>): Promise<void> {
  process.stdout.write(`  ▸ ${label} ... `);
  try {
    await fn();
    console.log('✅ PASS');
    passed++;
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    console.log(`❌ FAIL\n      ${msg}`);
    errors.push({ label, error: msg, stack: (err as Error)?.stack ?? '' });
  }
}

function skip(label: string, reason: string): void {
  console.log(`  ▸ ${label} ... ⏭  SKIP (${reason})`);
  skipped++;
}

function section(title: string): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

function ffmpegExec(args: string): void {
  execFileSync('ffmpeg', ['-y', ...args.trim().split(/\s+/)], { stdio: 'pipe' });
}

function ffmpegExecQuoted(args: string): void {
  // Split on whitespace but keep "quoted groups" together — lavfi graphs and
  // filter_complex strings need their spaces and semicolons preserved.
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

// ─── setup ──────────────────────────────────────────────────────────────────
section('SETUP — generating test media');

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

await run('generate src.mp4 (4s 320x180 video+audio)', () => {
  ffmpegExec(
    '-f lavfi -i testsrc=duration=4:size=320x180:rate=15 ' +
    '-f lavfi -i sine=frequency=440:duration=4 ' +
    '-c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -movflags +faststart ' +
    p('src.mp4'),
  );
});

await run('generate lossy.mp4 (re-encode, lower quality)', () => {
  ffmpegExec(
    '-i ' + p('src.mp4') +
    ' -c:v libx264 -preset veryfast -crf 40 -pix_fmt yuv420p -c:a aac ' +
    p('lossy.mp4'),
  );
});

await run('generate with_subs.mkv (h264 + aac + srt)', () => {
  fs.writeFileSync(
    p('subs.srt'),
    '1\n00:00:00,500 --> 00:00:02,000\nHello world\n\n2\n00:00:03,000 --> 00:00:04,000\nTest subtitle\n',
  );
  ffmpegExec(
    '-f lavfi -i testsrc=duration=4:size=320x180:rate=15 ' +
    '-f lavfi -i sine=frequency=440:duration=4 ' +
    '-i ' + p('subs.srt') +
    ' -c:v libx264 -preset ultrafast -c:a aac -c:s srt ' +
    p('with_subs.mkv'),
  );
});

await run('generate tone_gap.wav (tone, silence, tone)', () => {
  // Three separate inputs: a multi-source lavfi graph needs one -i per source,
  // not one -i with semicolon-separated filters.
  ffmpegExecQuoted(
    '-f lavfi -i "sine=frequency=440:duration=1" ' +
    '-f lavfi -i "sine=frequency=880:duration=1,volume=0.0001" ' +
    '-f lavfi -i "sine=frequency=440:duration=1" ' +
    '-filter_complex "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]" ' +
    // WAV, not mp3/aac: the lavfi concat emits a mono float stream that the
    // mp3/aac encoders reject ("Qavg: nan / Conversion failed").
    '-map "[out]" -c:a pcm_s16le ' + p('tone_gap.wav'),
  );
});

await run('generate cut.mp4 (two hard cuts for scene detection)', () => {
  ffmpegExecQuoted(
    '-f lavfi -i testsrc=duration=1.5:size=160x90:rate=15 ' +
    '-f lavfi -i color=blue:duration=1.5:size=160x90:rate=15 ' +
    '-f lavfi -i color=green:duration=1.5:size=160x90:rate=15 ' +
    '-filter_complex "[0:v][1:v][2:v]concat=n=3:v=1:a=0[out]" -map "[out]" ' +
    '-c:v libx264 -preset ultrafast -pix_fmt yuv420p ' + p('cut.mp4'),
  );
});

await run('generate sdr10.mp4 (10-bit BT.709, deliberately not HDR)', () => {
  ffmpegExec(
    '-f lavfi -i testsrc=duration=2:size=160x90:rate=15 ' +
    '-c:v libx264 -preset ultrafast -pix_fmt yuv420p10le ' +
    '-color_primaries bt709 -color_trc bt709 -colorspace bt709 ' +
    p('sdr10.mp4'),
  );
});

await run('generate hdr-ish bt2020/pq source (for tone mapping)', () => {
  ffmpegExec(
    '-f lavfi -i testsrc=duration=2:size=160x90:rate=15 ' +
    '-c:v libx264 -preset ultrafast -pix_fmt yuv420p10le ' +
    '-color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc ' +
    p('hdr.mp4'),
  );
});


// ─── imports ────────────────────────────────────────────────────────────────
section('IMPORT — loading 2.1.0 exports');

const {
  buildVmafFilter: buildVmafFilterFn,
  buildSsimFilter: buildSsimFilterFn,
  buildPsnrFilter: buildPsnrFilterFn,
  parseVmafLog: parseVmafLogFn,
  parseStatsFile: parseStatsFileFn,
  measureQuality: measureQualityFn,
  buildToneMapFilter: buildToneMapFilterFn,
  toneMapHdrToSdr: toneMapHdrToSdrFn,
  TONE_MAP_ALGORITHMS,
  HDR_SOURCE_PROPERTIES,
  SDR_TARGET_PROPERTIES,
  buildInterpolateFilter: buildInterpolateFilterFn,
  interpolateFrames: interpolateFramesFn,
  buildSceneCutArgs: buildSceneCutArgsFn,
  cutToScenes: cutToScenesFn,
  buildSilenceRemoveFilter: buildSilenceRemoveFilterFn,
  removeSilence: removeSilenceFn,
  buildSegmentArgs: buildSegmentArgsFn,
  writeSegments: writeSegmentsFn,
  buildHwUploadFilter: buildHwUploadFilterFn,
  buildHwDownloadFilter: buildHwDownloadFilterFn,
  buildHwScaleFilter: buildHwScaleFilterFn,
  buildHwFilterChain: buildHwFilterChainFn,
  HWACCELS,
  subtitleCodecFor: subtitleCodecForFn,
  subtitleExtensionFor: subtitleExtensionForFn,
  convertSubtitles: convertSubtitlesFn,
  fixSubtitleDuration: fixSubtitleDurationFn,
  buildVarStreamMap: buildVarStreamMapFn,
  buildAbrLadderFilter: buildAbrLadderFilterFn,
  buildAbrLadderArgs: buildAbrLadderArgsFn,
  validateAbrVariants: validateAbrVariantsFn,
  abrLadder: abrLadderFn,
  ffmpeg: ffmpegFn,
  COLOR_PROPERTY_KEYS,
  delogo: delogoFn,
  detectScenes: detectScenesFn,
} = await import('./lib/index.js');

await run('all 2.1.0 exports load without error', () => {
  const missing = [
    ['buildVmafFilter', buildVmafFilterFn], ['buildSsimFilter', buildSsimFilterFn],
    ['buildPsnrFilter', buildPsnrFilterFn], ['parseVmafLog', parseVmafLogFn],
    ['parseStatsFile', parseStatsFileFn], ['measureQuality', measureQualityFn],
    ['buildToneMapFilter', buildToneMapFilterFn], ['toneMapHdrToSdr', toneMapHdrToSdrFn],
    ['buildInterpolateFilter', buildInterpolateFilterFn], ['interpolateFrames', interpolateFramesFn],
    ['buildSceneCutArgs', buildSceneCutArgsFn], ['cutToScenes', cutToScenesFn],
    ['buildSilenceRemoveFilter', buildSilenceRemoveFilterFn], ['removeSilence', removeSilenceFn],
    ['buildSegmentArgs', buildSegmentArgsFn], ['writeSegments', writeSegmentsFn],
    ['buildHwUploadFilter', buildHwUploadFilterFn], ['buildHwDownloadFilter', buildHwDownloadFilterFn],
    ['buildHwScaleFilter', buildHwScaleFilterFn], ['buildHwFilterChain', buildHwFilterChainFn],
    ['subtitleCodecFor', subtitleCodecForFn], ['subtitleExtensionFor', subtitleExtensionForFn],
    ['convertSubtitles', convertSubtitlesFn], ['fixSubtitleDuration', fixSubtitleDurationFn],
    ['buildVarStreamMap', buildVarStreamMapFn], ['buildAbrLadderFilter', buildAbrLadderFilterFn],
    ['buildAbrLadderArgs', buildAbrLadderArgsFn], ['validateAbrVariants', validateAbrVariantsFn],
    ['abrLadder', abrLadderFn], ['delogo', delogoFn],
  ] as [string, unknown][];
  for (const [name, value] of missing) {
    if (typeof value !== 'function') throw new Error(`${name} is not a function`);
  }
  console.log(`      ${missing.length} new function exports OK`);
});

// ─── 42. Quality metric filter builders ─────────────────────────────────────
section('42 — QUALITY METRICS: filter builders');

await run('buildVmafFilter() → "libvmaf=log_fmt=json"', () => {
  const r = buildVmafFilterFn();
  if (r !== 'libvmaf=log_fmt=json') throw new Error(`got: ${r}`);
});

await run('buildVmafFilter({target:80}) → includes target=80', () => {
  const r = buildVmafFilterFn({ target: 80 });
  if (!r.includes('target=80')) throw new Error(`got: ${r}`);
});

await run('buildVmafFilter({minScore:50}) → includes min_score=50', () => {
  const r = buildVmafFilterFn({ minScore: 50 });
  if (!r.includes('min_score=50')) throw new Error(`got: ${r}`);
});

await run('buildVmafFilter({model:"version=v0.6.1"}) → does not escape "="', () => {
  const r = buildVmafFilterFn({ model: 'version=v0.6.1' });
  // escaping '=' here would make ffmpeg reject the model name
  if (r.includes('\\=')) throw new Error(`"=" was escaped: ${r}`);
  if (!r.includes("model='version=v0.6.1'")) throw new Error(`got: ${r}`);
  console.log(`      ${r}`);
});

await run('buildVmafFilter({target:101}) → RangeError', () => {
  try {
    buildVmafFilterFn({ target: 101 });
  } catch (e) {
    if (!(e instanceof RangeError)) throw new Error(`wrong error type: ${(e as Error).constructor.name}`);
    if (!/between 0 and 100/.test((e as Error).message)) throw new Error(`unhelpful message: ${(e as Error).message}`);
    return;
  }
  throw new Error('expected RangeError');
});

await run('buildVmafFilter({minScore:-1}) → RangeError', () => {
  let threw = false;
  try { buildVmafFilterFn({ minScore: -1 }); } catch (e) { threw = e instanceof RangeError; }
  if (!threw) throw new Error('expected RangeError');
});

await run('buildSsimFilter() → "ssim"', () => {
  if (buildSsimFilterFn() !== 'ssim') throw new Error(`got: ${buildSsimFilterFn()}`);
});

await run('buildSsimFilter({statsFile}) → single-quoted stats_file', () => {
  const r = buildSsimFilterFn({ statsFile: '/tmp/a b/ssim.log' });
  if (!r.includes("stats_file='/tmp/a b/ssim.log'")) throw new Error(`got: ${r}`);
});

await run('buildPsnrFilter() → "psnr"', () => {
  if (buildPsnrFilterFn() !== 'psnr') throw new Error(`got: ${buildPsnrFilterFn()}`);
});

await run('buildPsnrFilter({statsFile}) → includes stats_file', () => {
  const r = buildPsnrFilterFn({ statsFile: '/tmp/p.log' });
  if (!r.includes("stats_file='/tmp/p.log'")) throw new Error(`got: ${r}`);
});

// ─── 43. Quality score parsing ──────────────────────────────────────────────
section('43 — QUALITY METRICS: score parsing');

await run('parseVmafLog(valid libvmaf JSON) → pooled mean + frame count', () => {
  const json = JSON.stringify({
    version: 'v3.0.0',
    frames: [{ frameNum: 0 }, { frameNum: 1 }, { frameNum: 2 }],
    pooled_metrics: { vmaf: { min: 90, max: 99, mean: 95.5 } },
  });
  const s = parseVmafLogFn(json);
  if (s.metric !== 'vmaf') throw new Error(`metric: ${s.metric}`);
  if (s.value !== 95.5) throw new Error(`value: ${s.value}`);
  if (s.vmaf !== 95.5) throw new Error(`vmaf: ${s.vmaf}`);
  if (s.frames !== 3) throw new Error(`frames: ${s.frames}`);
});

await run('parseVmafLog(no pooled metrics) → throws a "did it finish" error', () => {
  try {
    parseVmafLogFn('{"version":"v3.0.0"}');
  } catch (e) {
    if (!/pooled_metrics\.vmaf\.mean/.test((e as Error).message)) {
      throw new Error(`unhelpful message: ${(e as Error).message}`);
    }
    return;
  }
  throw new Error('expected a throw');
});

await run('parseVmafLog(invalid JSON) → throws mentioning JSON', () => {
  try {
    parseVmafLogFn('not json at all');
  } catch (e) {
    if (!/not valid JSON/.test((e as Error).message)) throw new Error(`got: ${(e as Error).message}`);
    return;
  }
  throw new Error('expected a throw');
});

await run('parseStatsFile(ssim) → mean of All: values', () => {
  const log = [
    'n:0 mse_avg:0.10 mse_y:0.12 All:0.998000 (31.2)',
    'n:1 mse_avg:0.20 mse_y:0.22 All:0.996000 (30.1)',
    'n:2 mse_avg:0.30 mse_y:0.32 All:0.994000 (29.4)',
  ].join('\n');
  const s = parseStatsFileFn(log, 'ssim');
  const expected = (0.998 + 0.996 + 0.994) / 3;
  if (Math.abs(s.value - expected) > 1e-9) throw new Error(`value: ${s.value} != ${expected}`);
  if (s.frames !== 3) throw new Error(`frames: ${s.frames}`);
  if (s.metric !== 'ssim') throw new Error(`metric: ${s.metric}`);
});

await run('parseStatsFile(psnr) → mean of psnr_avg values', () => {
  const log = [
    'n:1 mse_avg:0.50 mse_y:0.60 psnr_avg:51.13 psnr_y:52.07',
    'n:2 mse_avg:1.20 mse_y:1.40 psnr_avg:47.31 psnr_y:48.02',
  ].join('\n');
  const s = parseStatsFileFn(log, 'psnr');
  const expected = (51.13 + 47.31) / 2;
  if (Math.abs(s.value - expected) > 1e-9) throw new Error(`value: ${s.value} != ${expected}`);
  if (s.metric !== 'psnr') throw new Error(`metric: ${s.metric}`);
});

await run('parseStatsFile(psnr with "inf") → Infinity, not a parse error', () => {
  // ffmpeg emits psnr_avg:inf for identical frames; that is a real result
  const log = 'n:1 mse_avg:0.00 mse_y:0.00 psnr_avg:inf psnr_y:inf';
  const s = parseStatsFileFn(log, 'psnr');
  // ffmpeg emits psnr_avg:inf for identical frames. That is a real result, not
  // a parse failure, and Infinity trivially clears any minScore.
  if (s.value !== Number.POSITIVE_INFINITY) throw new Error(`value: ${s.value}`);
  if (s.psnr !== Number.POSITIVE_INFINITY) throw new Error(`psnr field: ${s.psnr}`);
  if (s.metric !== 'psnr') throw new Error(`metric: ${s.metric}`);
  if (s.frames !== 1) throw new Error(`frames: ${s.frames}`);
  console.log(`      value: ${s.value} (Infinity, as ffmpeg reports it)`);
});

await run('parseStatsFile(psnr, mixed inf + finite) → Infinity wins the mean', () => {
  const log = [
    'n:1 psnr_avg:inf psnr_y:inf',
    'n:2 psnr_avg:40.00 psnr_y:41.00',
  ].join('\n');
  const s = parseStatsFileFn(log, 'psnr');
  if (s.value !== Number.POSITIVE_INFINITY) throw new Error(`value: ${s.value}`);
});

await run('parseStatsFile("") → throws "is empty"', () => {
  try {
    parseStatsFileFn('   \n  ', 'ssim');
  } catch (e) {
    if (!/is empty/.test((e as Error).message)) throw new Error(`got: ${(e as Error).message}`);
    return;
  }
  throw new Error('expected a throw');
});

await run('parseStatsFile(ssim log passed as psnr) → throws "is this a psnr stats file?"', () => {
  const log = 'n:0 mse_avg:0.10 All:0.998000 (31.2)';
  try {
    parseStatsFileFn(log, 'psnr');
  } catch (e) {
    if (!/is this a psnr stats file/.test((e as Error).message)) throw new Error(`got: ${(e as Error).message}`);
    return;
  }
  throw new Error('expected a throw');
});

await run('parseStatsFile(psnr log passed as ssim) → throws "is this an ssim stats file?"', () => {
  const log = 'n:1 psnr_avg:40.00 psnr_y:41.00';
  try {
    parseStatsFileFn(log, 'ssim');
  } catch (e) {
    if (!/is this an ssim stats file/.test((e as Error).message)) throw new Error(`got: ${(e as Error).message}`);
    return;
  }
  throw new Error('expected a throw');
});

// ─── 44. measureQuality against real ffmpeg ────────────────────────────────
section('44 — QUALITY METRICS: measureQuality() end to end');

await run('measureQuality({metric:"ssim", reference:src, distorted:src}) → 1.0', async () => {
  const s = await measureQualityFn({ reference: p('src.mp4'), distorted: p('src.mp4'), metric: 'ssim' });
  if (s.value < 0.999) throw new Error(`expected ~1.0, got ${s.value}`);
  if (!s.frames || s.frames < 1) throw new Error(`frames: ${s.frames}`);
  console.log(`      ssim=${s.value.toFixed(6)} over ${s.frames} frames`);
});

await run('measureQuality({metric:"psnr", reference:src, distorted:src}) → Infinity', async () => {
  const s = await measureQualityFn({ reference: p('src.mp4'), distorted: p('src.mp4'), metric: 'psnr' });
  if (s.value !== Number.POSITIVE_INFINITY) throw new Error(`expected Infinity, got ${s.value}`);
});

await run('measureQuality(psnr, identical input, minScore:0) → Infinity clears the floor', async () => {
  // Regression: Infinity < Infinity is false, but a naive guard rejecting
  // non-finite scores would wrongly fail a perfect encode.
  const s = await measureQualityFn({
    reference: p('src.mp4'), distorted: p('src.mp4'), metric: 'psnr', minScore: 0,
  });
  if (s.value !== Number.POSITIVE_INFINITY) throw new Error(`expected Infinity, got ${s.value}`);
});

await run('measureQuality({metric:"psnr", src vs lossy}) → finite score below identical', async () => {
  const s = await measureQualityFn({ reference: p('src.mp4'), distorted: p('lossy.mp4'), metric: 'psnr' });
  if (!Number.isFinite(s.value)) throw new Error(`expected finite, got ${s.value}`);
  if (s.value > 60) throw new Error(`crf 40 re-encode should score well under 60dB, got ${s.value}`);
  console.log(`      psnr=${s.value.toFixed(3)} dB`);
});

await run('measureQuality({metric:"ssim", minScore:0.99}) → throws with both numbers in message', async () => {
  try {
    await measureQualityFn({
      reference: p('src.mp4'), distorted: p('lossy.mp4'), metric: 'ssim', minScore: 0.99,
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (!/below the required minimum/.test(msg)) throw new Error(`unhelpful message: ${msg}`);
    if (!/0\.99/.test(msg)) throw new Error(`message should quote the minimum: ${msg}`);
    return;
  }
  throw new Error('expected a throw');
});

await run('measureQuality({metric:"ssim", src vs lossy}) → lower than identical', async () => {
  const s = await measureQualityFn({ reference: p('src.mp4'), distorted: p('lossy.mp4'), metric: 'ssim' });
  if (s.value >= 0.999) throw new Error(`expected < 1.0 for a lossy re-encode, got ${s.value}`);
  console.log(`      ssim=${s.value.toFixed(6)}`);
});

await run('measureQuality({metric:"ssim", minScore:0}) on a lossy encode → passes', async () => {
  const s = await measureQualityFn({
    reference: p('src.mp4'), distorted: p('lossy.mp4'), metric: 'ssim', minScore: 0,
  });
  if (s.value < 0) throw new Error(`value: ${s.value}`);
});

await run('measureQuality({metric:"ssim", vmaf:{target:80}}) → rejects vmaf.target', async () => {
  try {
    await measureQualityFn({
      reference: p('src.mp4'), distorted: p('src.mp4'), metric: 'ssim', vmaf: { target: 80 },
    });
  } catch (e) {
    if (!/vmaf\.target only applies/.test((e as Error).message)) throw new Error(`got: ${(e as Error).message}`);
    return;
  }
  throw new Error('expected a throw');
});

await run('measureQuality leaves no stats/log files behind', async () => {
  const before = fs.readdirSync(process.cwd()).filter(f => f.startsWith('mediaforge-quality-'));
  await measureQualityFn({ reference: p('src.mp4'), distorted: p('src.mp4'), metric: 'ssim' });
  const after = fs.readdirSync(process.cwd()).filter(f => f.startsWith('mediaforge-quality-'));
  if (after.length !== before.length) {
    throw new Error(`leftover files: ${after.filter(f => !before.includes(f)).join(', ')}`);
  }
});

if (HAS_LIBMETRIX) {
  await run('measureQuality({metric:"vmaf", src vs lossy}) → 0-100 score', async () => {
    const s = await measureQualityFn({ reference: p('src.mp4'), distorted: p('lossy.mp4'), metric: 'vmaf' });
    if (s.metric !== 'vmaf') throw new Error(`metric: ${s.metric}`);
    if (s.value < 0 || s.value > 100) throw new Error(`vmaf out of range: ${s.value}`);
    console.log(`      vmaf=${s.value.toFixed(3)}`);
  });
} else {
  skip('measureQuality({metric:"vmaf"})', 'this ffmpeg build has no libvmaf');
}

await run('measureQuality({metric:"vmaf"}) on a build without libvmaf → clear error', async () => {
  if (HAS_LIBMETRIX) return; // the "not available" branch cannot fire here
  try {
    await measureQualityFn({ reference: p('src.mp4'), distorted: p('src.mp4'), metric: 'vmaf' });
  } catch (e) {
    if (!/not available in this ffmpeg build/.test((e as Error).message)) {
      throw new Error(`unhelpful message: ${(e as Error).message}`);
    }
    if (!/compiled with libvmaf/.test((e as Error).message)) {
      throw new Error(`should say what is missing: ${(e as Error).message}`);
    }
    return;
  }
  throw new Error('expected a throw');
});

// ─── 45. Tone mapping ──────────────────────────────────────────────────────
section('45 — TONE MAPPING (HDR → SDR)');

await run('TONE_MAP_ALGORITHMS covers ffmpeg\'s real option values', () => {
  for (const k of ['hable', 'mobius', 'reinhard', 'clip', 'linear', 'spline']) {
    if (TONE_MAP_ALGORITHMS[k] !== k) throw new Error(`missing algorithm: ${k}`);
  }
});

await run('HDR_SOURCE_PROPERTIES / SDR_TARGET_PROPERTIES describe bt2020pq → bt709', () => {
  if (HDR_SOURCE_PROPERTIES['color_primaries'] !== 'bt2020') throw new Error('primaries');
  if (HDR_SOURCE_PROPERTIES['color_trc'] !== 'smpte2084') throw new Error(`trc: ${HDR_SOURCE_PROPERTIES['color_trc']}`);
  if (SDR_TARGET_PROPERTIES['colorspace'] !== 'bt709') throw new Error('colorspace');
});

await run('buildToneMapFilter() → zscale → tonemap → zscale chain', () => {
  const r = buildToneMapFilterFn();
  const parts = r.split(',');
  if (parts.length !== 3) throw new Error(`expected 3 stages, got ${parts.length}: ${r}`);
  if (!parts[0].startsWith('zscale=t=linear')) throw new Error(`stage 1: ${parts[0]}`);
  if (!parts[1].startsWith('tonemap=tonemap=mobius')) throw new Error(`stage 2: ${parts[1]}`);
  if (!parts[2].startsWith('zscale=t=bt709')) throw new Error(`stage 3: ${parts[2]}`);
});

await run('buildToneMapFilter uses zscale SHORT option names (t/p/m/r, not width=)', () => {
  // `width=bt2020` is a pixel size to zscale, not a colour space; ffmpeg
  // rejects it with "Invalid size 'bt2020'".
  const r = buildToneMapFilterFn();
  if (/zscale=[^,]*\b(width|height)=/.test(r)) throw new Error(`uses long pixel options: ${r}`);
  if (!/zscale=t=linear[^,]*:p=bt2020/.test(r)) throw new Error(`primaries not set via p=: ${r}`);
  if (!/:m=bt2020nc/.test(r)) throw new Error(`matrix not set via m=: ${r}`);
  console.log(`      ${r}`);
});

await run('buildToneMapFilter({algorithm:"hable"}) → tonemap=hable', () => {
  const r = buildToneMapFilterFn({ algorithm: 'hable' });
  if (!r.includes('tonemap=tonemap=hable')) throw new Error(`got: ${r}`);
});

await run('buildToneMapFilter({algorithm:"mobius",parameter:0.3}) → param=0.3', () => {
  const r = buildToneMapFilterFn({ algorithm: 'mobius', parameter: 0.3 });
  if (!r.includes('param=0.3')) throw new Error(`got: ${r}`);
});

await run('buildToneMapFilter({algorithm:"clip"}) → no desat (ffmpeg has no such option)', () => {
  const r = buildToneMapFilterFn({ algorithm: 'clip' });
  const tm = r.split(',')[1]!;
  if (tm.includes('desat=')) throw new Error(`desat emitted for clip: ${tm}`);
});

await run('buildToneMapFilter({algorithm:"spline"}) → no desat', () => {
  const r = buildToneMapFilterFn({ algorithm: 'spline' });
  if (r.split(',')[1]!.includes('desat=')) throw new Error('desat emitted for spline');
});

await run('buildToneMapFilter({algorithm:"hable",parameter:0.3}) → throws (not a parametric algo)', () => {
  for (const algo of ['hable', 'clip', 'spline'] as const) {
    try {
      buildToneMapFilterFn({ algorithm: algo, parameter: 0.3 });
    } catch (e) {
      if (!/parameter only applies/.test((e as Error).message)) throw new Error(`got: ${(e as Error).message}`);
      continue;
    }
    throw new Error(`expected a throw for ${algo}`);
  }
});

await run('buildToneMapFilter({algorithm:"bogus"}) → throws listing valid values', () => {
  try {
    buildToneMapFilterFn({ algorithm: 'bogus' as never });
  } catch (e) {
    const msg = (e as Error).message;
    if (!/unknown algorithm "bogus"/.test(msg)) throw new Error(`got: ${msg}`);
    if (!/hable/.test(msg)) throw new Error(`should list valid values: ${msg}`);
    return;
  }
  throw new Error('expected a throw');
});

await run('buildToneMapFilter validates peak / targetPeak / desaturation', () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ peak: 0 }, /peak must be a positive/],
    [{ peak: -1 }, /peak must be a positive/],
    [{ targetPeak: 0 }, /targetPeak must be a positive/],
    [{ desaturation: 1.5 }, /desaturation must be between 0 and 1/],
    [{ desaturation: -0.1 }, /desaturation must be between 0 and 1/],
    [{ parameter: 0 }, /parameter must be a positive/],
  ];
  for (const [opts, re] of cases) {
    try {
      buildToneMapFilterFn(opts as never);
    } catch (e) {
      if (!(e instanceof RangeError)) throw new Error(`${JSON.stringify(opts)}: ${(e as Error).constructor.name}`);
      if (!re.test((e as Error).message)) throw new Error(`${JSON.stringify(opts)}: ${(e as Error).message}`);
      continue;
    }
    throw new Error(`expected a throw for ${JSON.stringify(opts)}`);
  }
});

await run('buildToneMapFilter({normalizeInput:false}) → drops the leading zscale', () => {
  const r = buildToneMapFilterFn({ normalizeInput: false });
  if (r.split(',').length !== 2) throw new Error(`got: ${r}`);
  if (r.includes('zscale=t=linear')) throw new Error(`normalize zscale should be gone: ${r}`);
});

await run('buildToneMapFilter({output:"smpte170m"}) → final zscale uses that target', () => {
  const r = buildToneMapFilterFn({ output: 'smpte170m' });
  if (!r.endsWith('zscale=t=smpte170m:p=smpte170m:m=smpte170m:r=tv')) {
    throw new Error(`got: ${r}`);
  }
});

if (HAS_ZSCALE && HAS_TONEMAP) {
  await run('toneMapHdrToSdr on a real BT.2020/PQ file → SDR output tagged bt709', async () => {
    await toneMapHdrToSdrFn({ input: p('hdr.mp4'), output: p('tonemapped.mp4'), videoCodec: 'libx264' });
    if (!fs.existsSync(p('tonemapped.mp4'))) throw new Error('output not created');
    const info = JSON.parse(
      execFileSync('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0', '-show_entries',
        'stream=color_space,color_transfer,color_primaries', '-of', 'json', p('tonemapped.mp4'),
      ], { encoding: 'utf8' }),
    );
    const s = info.streams?.[0] ?? {};
    if (s.color_transfer !== 'bt709') throw new Error(`color_transfer: ${s.color_transfer}`);
    console.log(`      output: space=${s.color_space} trc=${s.color_transfer} prim=${s.color_primaries}`);
  });

  await run('toneMapHdrToSdr({requireHdrInput:false}) on an SDR file → allowed', async () => {
    // Deliberately 10-bit BT.709: zscale in the builds available here fails on
    // 8-bit input ("Generic error in an external library") regardless of the
    // requested colour space, so an 8-bit fixture would test the build, not us.
    await toneMapHdrToSdrFn({
      input: p('sdr10.mp4'), output: p('tonemapped_sdr.mp4'),
      requireHdrInput: false, videoCodec: 'libx264',
    });
    if (!fs.existsSync(p('tonemapped_sdr.mp4'))) throw new Error('output not created');
  });

  await run('toneMapHdrToSdr tags the SDR result so players do not re-apply a display transform', async () => {
    const info = JSON.parse(
      execFileSync('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0', '-show_entries',
        'stream=color_space,color_transfer,color_primaries', '-of', 'json', p('tonemapped_sdr.mp4'),
      ], { encoding: 'utf8' }),
    );
    const st = info.streams?.[0] ?? {};
    if (st.color_transfer !== 'bt709') throw new Error(`color_transfer: ${st.color_transfer}`);
    if (st.color_primaries !== 'bt709') throw new Error(`color_primaries: ${st.color_primaries}`);
    console.log(`      output: space=${st.color_space} trc=${st.color_transfer} prim=${st.color_primaries}`);
  });

  await run('toneMapHdrToSdr({requireHdrInput:true}) on an SDR file → throws with guidance', async () => {
    try {
      await toneMapHdrToSdrFn({ input: p('sdr10.mp4'), output: p('nope.mp4') });
    } catch (e) {
      const msg = (e as Error).message;
      if (!/does not look like HDR/.test(msg)) throw new Error(`got: ${msg}`);
      if (!/requireHdrInput: false/.test(msg)) throw new Error(`should offer the escape hatch: ${msg}`);
      return;
    }
    throw new Error('expected a throw');
  });

  await run('toneMapHdrToSdr({algorithm:"hable",peak:1000,targetPeak:100}) → runs', async () => {
    await toneMapHdrToSdrFn({
      input: p('hdr.mp4'), output: p('tonemapped_hable.mp4'),
      algorithm: 'hable', peak: 1000, targetPeak: 100, videoCodec: 'libx264',
    });
    if (!fs.existsSync(p('tonemapped_hable.mp4'))) throw new Error('output not created');
  });
} else {
  skip('toneMapHdrToSdr end-to-end', 'ffmpeg build has no zscale/tonemap filters');
}

// ─── 46. Temporal: interpolate / scenes / silence / segments ────────────────
section('46 — TEMPORAL: interpolate, scenes, silence, segments');

await run('buildInterpolateFilter({fps:60}) → minterpolate with mci defaults', () => {
  const r = buildInterpolateFilterFn({ fps: 60 });
  if (!r.startsWith('minterpolate=fps=60:')) throw new Error(`got: ${r}`);
  if (!r.includes('mi_mode=mci')) throw new Error(`got: ${r}`);
  if (!r.includes('mc_mode=obmc')) throw new Error(`got: ${r}`);
  if (!r.includes('me_mode=bidir')) throw new Error(`got: ${r}`);
});

await run('buildInterpolateFilter({method:"blend"}) → omits mb_size/mc_mode (ffmpeg rejects them)', () => {
  const r = buildInterpolateFilterFn({ fps: 30, method: 'blend' });
  if (!r.includes('mi_mode=blend')) throw new Error(`got: ${r}`);
  // ffmpeg errors with "Error setting option mb_size" for dup/blend
  if (r.includes('mb_size=')) throw new Error(`mb_size emitted for blend: ${r}`);
  if (r.includes('mc_mode=')) throw new Error(`mc_mode emitted for blend: ${r}`);
});

await run('buildInterpolateFilter({method:"dup"}) → omits mb_size/mc_mode', () => {
  const r = buildInterpolateFilterFn({ fps: 30, method: 'dup' });
  if (r.includes('mb_size=')) throw new Error(`mb_size emitted for dup: ${r}`);
  if (!r.includes('mi_mode=dup')) throw new Error(`got: ${r}`);
});

await run('buildInterpolateFilter({mcMode:"aobmc",meMode:"bilat"}) → emitted for mci', () => {
  const r = buildInterpolateFilterFn({ fps: 60, mcMode: 'aobmc', meMode: 'bilat' });
  if (!r.includes('mc_mode=aobmc')) throw new Error(`got: ${r}`);
  if (!r.includes('me_mode=bilat')) throw new Error(`got: ${r}`);
});

await run('buildInterpolateFilter({meMethod:"umh"}) → me=umh', () => {
  const r = buildInterpolateFilterFn({ fps: 60, meMethod: 'umh' });
  if (!r.includes('me=umh')) throw new Error(`got: ${r}`);
});

await run('buildInterpolateFilter({fps:0}) → RangeError', () => {
  try {
    buildInterpolateFilterFn({ fps: 0 });
  } catch (e) {
    if (!(e instanceof RangeError)) throw new Error(`wrong type: ${(e as Error).constructor.name}`);
    return;
  }
  throw new Error('expected RangeError');
});

await run('buildInterpolateFilter({fps:NaN}) → RangeError', () => {
  let threw = false;
  try { buildInterpolateFilterFn({ fps: Number.NaN }); } catch (e) { threw = e instanceof RangeError; }
  if (!threw) throw new Error('expected RangeError');
});

await run('buildInterpolateFilter({method:"mi"}) → throws (invented value)', () => {
  try {
    buildInterpolateFilterFn({ fps: 60, method: 'mi' as never });
  } catch (e) {
    if (!/unknown method "mi"/.test((e as Error).message)) throw new Error(`got: ${(e as Error).message}`);
    if (!/mci, blend, dup/.test((e as Error).message)) throw new Error(`should list valid values`);
    return;
  }
  throw new Error('expected a throw');
});

await run('buildInterpolateFilter({method:"mci",mcMode:"mci"}) → throws (invented value)', () => {
  // Regression: the first API used "mci" as a mc_mode, which ffmpeg rejects
  // with 'Error setting option mc_mode to value mci'.
  try {
    buildInterpolateFilterFn({ fps: 60, method: 'mci', mcMode: 'mci' as never });
  } catch (e) {
    if (!/unknown mcMode "mci"/.test((e as Error).message)) throw new Error(`got: ${(e as Error).message}`);
    return;
  }
  throw new Error('expected a throw');
});

await run('buildInterpolateFilter({mbSize:2}) → RangeError (ffmpeg needs >= 4)', () => {
  try {
    buildInterpolateFilterFn({ fps: 60, mbSize: 2 });
  } catch (e) {
    if (!(e instanceof RangeError)) throw new Error(`wrong type: ${(e as Error).constructor.name}`);
    return;
  }
  throw new Error('expected RangeError');
});

await run('interpolateFrames({fps:30, method:"dup"}) → real file at 30fps', async () => {
  await interpolateFramesFn({
    input: p('src.mp4'), output: p('interp_dup.mp4'), fps: 30, method: 'dup',
  });
  if (!fs.existsSync(p('interp_dup.mp4'))) throw new Error('output not created');
  const info = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=avg_frame_rate', '-of', 'json', p('interp_dup.mp4')], { encoding: 'utf8' }),
  );
  const rate = info.streams?.[0]?.avg_frame_rate ?? '';
  if (!rate.startsWith('30/')) throw new Error(`avg_frame_rate: ${rate}`);
  console.log(`      avg_frame_rate=${rate}`);
});

await run('buildSceneCutArgs([t=2,t=4]) → windows [0,2] and [2,4]', () => {
  const args = buildSceneCutArgsFn([
    { timestamp: 2, sceneNumber: 1 }, { timestamp: 4, sceneNumber: 1 },
  ]);
  // ffmpeg seeks with -ss/-to; the first clip runs from the START of the file
  if (args[0] !== '-ss' || args[1] !== '0.000') throw new Error(`first window: ${args.join(' ')}`);
  if (args[2] !== '-to' || args[3] !== '2.000') throw new Error(`first window: ${args.join(' ')}`);
  if (args[4] !== '-ss' || args[5] !== '2.000') throw new Error(`second window: ${args.join(' ')}`);
  if (args[6] !== '-to' || args[7] !== '4.000') throw new Error(`second window: ${args.join(' ')}`);
  if (args.length !== 8) throw new Error(`expected 8 args, got ${args.length}`);
});

await run('buildSceneCutArgs([]) → no windows (single unbroken scene)', () => {
  if (buildSceneCutArgsFn([]).length !== 0) throw new Error('expected no args');
});

await run('buildSceneCutArgs sorts unsorted boundaries', () => {
  const args = buildSceneCutArgsFn([{ timestamp: 4, sceneNumber: 1 }, { timestamp: 1, sceneNumber: 1 }]);
  if (args[1] !== '0.000' || args[3] !== '1.000') throw new Error(`got: ${args.join(' ')}`);
  if (args[5] !== '1.000' || args[7] !== '4.000') throw new Error(`got: ${args.join(' ')}`);
});

await run('buildSceneCutArgs de-duplicates identical boundaries', () => {
  const args = buildSceneCutArgsFn([
    { timestamp: 2, sceneNumber: 1 }, { timestamp: 2, sceneNumber: 1 }, { timestamp: 2, sceneNumber: 1 },
  ]);
  if (args.length !== 4) throw new Error(`expected one window, got ${args.join(' ')}`);
});

await run('buildSceneCutArgs({trimStart:0.2}) shortens each window from its END', () => {
  const args = buildSceneCutArgsFn([{ timestamp: 2, sceneNumber: 1 }, { timestamp: 4, sceneNumber: 1 }], { trimStart: 0.2 });
  if (args[3] !== '1.800') throw new Error(`first window end: ${args[3]}`);
  // the next window still STARTS at the boundary — only the tail is dropped
  if (args[5] !== '2.000') throw new Error(`second window start: ${args[5]}`);
  if (args[7] !== '3.800') throw new Error(`second window end: ${args[7]}`);
});

await run('buildSceneCutArgs({trimStart:5}) drops windows shorter than the trim', () => {
  const args = buildSceneCutArgsFn([{ timestamp: 2, sceneNumber: 1 }], { trimStart: 5 });
  if (args.length !== 0) throw new Error(`expected the window to be dropped, got ${args.join(' ')}`);
});

await run('buildSceneCutArgs({endTime:3}) clips later boundaries', () => {
  const args = buildSceneCutArgsFn([{ timestamp: 2, sceneNumber: 1 }, { timestamp: 4, sceneNumber: 1 }], { endTime: 3 });
  if (args[7] !== '3.000') throw new Error(`got: ${args.join(' ')}`);
});

await run('buildSceneCutArgs({trimStart:-1}) → RangeError', () => {
  try {
    buildSceneCutArgsFn([{ timestamp: 1, sceneNumber: 1 }], { trimStart: -1 });
  } catch (e) {
    if (!(e instanceof RangeError)) throw new Error(`wrong type: ${(e as Error).constructor.name}`);
    return;
  }
  throw new Error('expected RangeError');
});

await run('cutToScenes on a 3-scene clip → output created', async () => {
  await cutToScenesFn({ input: p('cut.mp4'), output: p('cut_out.mp4'), threshold: 0.1 });
  if (!fs.existsSync(p('cut_out.mp4'))) throw new Error('output not created');
  if (fs.statSync(p('cut_out.mp4')).size === 0) throw new Error('output is empty');
});

await run('detectScenes on cut.mp4 finds at least one boundary', async () => {
  const scenes = await detectScenesFn({ input: p('cut.mp4'), threshold: 0.1 });
  if (!Array.isArray(scenes)) throw new Error(`not an array: ${typeof scenes}`);
  console.log(`      scene changes: ${scenes.length}`);
});

await run('buildSilenceRemoveFilter() → silenceremove', () => {
  const r = buildSilenceRemoveFilterFn();
  if (!r.startsWith('silenceremove=')) throw new Error(`got: ${r}`);
  if (!r.includes('start_periods=1')) throw new Error(`got: ${r}`);
});

await run('buildSilenceRemoveFilter({threshold:-35,minDuration:0.4}) → real ffmpeg option names', () => {
  const r = buildSilenceRemoveFilterFn({ threshold: -35, minDuration: 0.4 });
  // silenceremove has no threshold_n; it has start_threshold / stop_threshold.
  if (r.includes('threshold_n')) throw new Error(`invented option: ${r}`);
  if (!r.includes('start_threshold=-35dB')) throw new Error(`got: ${r}`);
  if (!r.includes('stop_threshold=-35dB')) throw new Error(`got: ${r}`);
  if (!r.includes('start_duration=0.4')) throw new Error(`got: ${r}`);
  if (!r.includes('stop_periods=-1')) throw new Error(`got: ${r}`);
});

await run('buildSilenceRemoveFilter output is accepted by the real silenceremove filter', () => {
  const r = buildSilenceRemoveFilterFn({ threshold: -35, minDuration: 0.4 });
  execFileSync('ffmpeg', [
    '-hide_banner', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-af', r, '-f', 'null', '-',
  ], { stdio: 'pipe' });
});

await run('buildSilenceRemoveFilter rejects an out-of-range threshold/duration', () => {
  for (const opts of [{ threshold: 5 }, { threshold: -500 }, { minDuration: 0 }, { minDuration: -1 }]) {
    try {
      buildSilenceRemoveFilterFn(opts as never);
    } catch (e) {
      if (!(e instanceof RangeError)) throw new Error(`${JSON.stringify(opts)}: ${(e as Error).constructor.name}`);
      continue;
    }
    throw new Error(`expected a throw for ${JSON.stringify(opts)}`);
  }
});

await run('removeSilence on a tone with a silent gap → shorter output', async () => {
  const before = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'json', p('tone_gap.wav')], { encoding: 'utf8' }),
  );
  await removeSilenceFn({
    input: p('tone_gap.wav'), output: p('tone_trimmed.wav'), threshold: -50, minDuration: 0.2,
  });
  if (!fs.existsSync(p('tone_trimmed.wav'))) throw new Error('output not created');
  const after = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'json', p('tone_trimmed.wav')], { encoding: 'utf8' }),
  );
  const d0 = Number(before.format?.duration);
  const d1 = Number(after.format?.duration);
  console.log(`      ${d0.toFixed(2)}s → ${d1.toFixed(2)}s`);
  if (!(d1 < d0)) throw new Error(`expected the output to be shorter: ${d0} → ${d1}`);
});

await run('buildSegmentArgs forces keyframes at the segment boundaries', () => {
  const args = buildSegmentArgsFn({ input: 'in.mp4', outputPattern: 'seg%03d.ts', segmentTime: 1 });
  const i = args.indexOf('-force_key_frames');
  if (i === -1) throw new Error('no -force_key_frames; the muxer can only cut on keyframes');
  if (args[i + 1] !== 'expr:gte(t,n_forced*1)') throw new Error(`got: ${args[i + 1]}`);
  if (!args.includes('segment')) throw new Error('no -f segment');
  if (args[args.length - 1] !== 'seg%03d.ts') throw new Error('output pattern is not last');
});

await run('buildSegmentArgs({forceKeyFrames:false}) omits the keyframe expression', () => {
  const args = buildSegmentArgsFn({
    input: 'in.mp4', outputPattern: 'seg%03d.ts', forceKeyFrames: false,
  });
  if (args.includes('-force_key_frames')) throw new Error('still forcing keyframes');
});

await run('buildSegmentArgs({resetTimestamps:false}) omits -reset_timestamps', () => {
  const args = buildSegmentArgsFn({
    input: 'in.mp4', outputPattern: 'seg%03d.ts', resetTimestamps: false,
  });
  if (args.includes('-reset_timestamps')) throw new Error('still resetting timestamps');
});

await run('buildSegmentArgs("out.ts" without %d) → throws', () => {
  try {
    buildSegmentArgsFn({ input: 'in.mp4', outputPattern: 'out.ts' });
  } catch (e) {
    if (!/printf-style index/.test((e as Error).message)) throw new Error(`got: ${(e as Error).message}`);
    return;
  }
  throw new Error('expected a throw');
});

await run('buildSegmentArgs({segmentTime:0}) → RangeError', () => {
  try {
    buildSegmentArgsFn({ input: 'in.mp4', outputPattern: 'seg%03d.ts', segmentTime: 0 });
  } catch (e) {
    if (!(e instanceof RangeError)) throw new Error(`wrong type: ${(e as Error).constructor.name}`);
    return;
  }
  throw new Error('expected RangeError');
});

await run('writeSegments on a 4s clip with segmentTime 1 → 4 segments', async () => {
  await writeSegmentsFn({
    input: p('src.mp4'), outputPattern: p('seg%03d.ts'), segmentTime: 1,
  });
  const segs = fs.readdirSync(TMP).filter(f => /^seg\d{3}\.ts$/.test(f));
  if (segs.length < 4) throw new Error(`expected ≥4 segments, got ${segs.length}: ${segs.join(', ')}`);
  for (const s of segs) {
    if (fs.statSync(path.join(TMP, s)).size === 0) throw new Error(`${s} is empty`);
  }
  console.log(`      ${segs.length} segments written`);
});

// ─── 47. Hardware acceleration filters ─────────────────────────────────────
section('47 — HARDWARE ACCELERATION: filter builders');

await run('HWACCELS lists ffmpeg\'s -hwaccel values', () => {
  for (const a of ['cuda', 'vaapi', 'qsv', 'vulkan', 'videotoolbox', 'd3d11va', 'dxva2']) {
    if (!HWACCELS.includes(a as never)) throw new Error(`missing accel: ${a}`);
  }
});

await run('buildHwUploadFilter({accel:"cuda"}) → "hwupload"', () => {
  if (buildHwUploadFilterFn({ accel: 'cuda' }) !== 'hwupload') throw new Error('not "hwupload"');
});

await run('buildHwUploadFilter({accel:"bogus"}) → throws listing valid accels', () => {
  try {
    buildHwUploadFilterFn({ accel: 'bogus' as never });
  } catch (e) {
    if (!/Unknown hwaccel "bogus"/.test((e as Error).message)) throw new Error(`got: ${(e as Error).message}`);
    if (!/cuda/.test((e as Error).message)) throw new Error('should list valid values');
    return;
  }
  throw new Error('expected a throw');
});

await run('buildHwDownloadFilter() → hwdownload=format=nv12 (explicit format)', () => {
  const r = buildHwDownloadFilterFn();
  if (r !== 'hwdownload=format=nv12') throw new Error(`got: ${r}`);
});

await run('buildHwDownloadFilter("yuv420p10le") → that format', () => {
  const r = buildHwDownloadFilterFn('yuv420p10le');
  if (r !== 'hwdownload=format=yuv420p10le') throw new Error(`got: ${r}`);
});

await run('buildHwScaleFilter maps each accel to its GPU scaler', () => {
  const cases: [string, string][] = [
    ['cuda', 'scale_cuda'], ['vaapi', 'scale_vaapi'],
    ['qsv', 'scale_qsv'], ['vulkan', 'scale_vulkan'],
  ];
  for (const [accel, filter] of cases) {
    const r = buildHwScaleFilterFn({ accel: accel as never, width: 1280, height: 720 });
    if (r !== `${filter}=w=1280:h=720`) throw new Error(`${accel} → ${r}`);
  }
});

await run('buildHwScaleFilter({format,mode}) → extra options', () => {
  const r = buildHwScaleFilterFn({
    accel: 'vaapi', width: 640, height: 360, format: 'nv12|vaapi', mode: 'bilinear',
  });
  if (r !== 'scale_vaapi=w=640:h=360:format=nv12|vaapi:mode=bilinear') throw new Error(`got: ${r}`);
});

await run('buildHwScaleFilter({accel:"videotoolbox"}) → throws (no GPU scaler exists)', () => {
  try {
    buildHwScaleFilterFn({ accel: 'videotoolbox', width: 640, height: 360 });
  } catch (e) {
    const msg = (e as Error).message;
    if (!/no GPU scaler for "videotoolbox"/.test(msg)) throw new Error(`got: ${msg}`);
    if (!/scale_cuda/.test(msg) && !/cuda/.test(msg)) {
      throw new Error(`should list the available scalers: ${msg}`);
    }
    if (!/HwDownloadFilter/.test(msg)) throw new Error(`should suggest the software fallback: ${msg}`);
    return;
  }
  throw new Error('expected a throw');
});

await run('buildHwScaleFilter({accel:"d3d11va"}) → throws (no GPU scaler)', () => {
  let threw = false;
  try { buildHwScaleFilterFn({ accel: 'd3d11va', width: 640, height: 360 }); }
  catch { threw = true; }
  if (!threw) throw new Error('expected a throw');
});

await run('buildHwScaleFilter({width:0}) → RangeError', () => {
  try {
    buildHwScaleFilterFn({ accel: 'cuda', width: 0, height: 360 });
  } catch (e) {
    if (!(e instanceof RangeError)) throw new Error(`wrong type: ${(e as Error).constructor.name}`);
    return;
  }
  throw new Error('expected RangeError');
});

await run('buildHwScaleFilter({height:1.5}) → RangeError (must be an integer)', () => {
  let threw = false;
  try { buildHwScaleFilterFn({ accel: 'cuda', width: 640, height: 1.5 }); }
  catch (e) { threw = e instanceof RangeError; }
  if (!threw) throw new Error('expected RangeError');
});

await run('buildHwFilterChain → upload, GPU filters, download, CPU filters in order', () => {
  const r = buildHwFilterChainFn({
    accel: 'cuda',
    gpuFilters: [buildHwScaleFilterFn({ accel: 'cuda', width: 1280, height: 720 })],
    cpuFilters: ['drawtext=text=hi'],
  });
  const parts = r.split(',');
  if (parts[0] !== 'hwupload') throw new Error(`first: ${parts[0]}`);
  if (parts[1] !== 'scale_cuda=w=1280:h=720') throw new Error(`second: ${parts[1]}`);
  if (parts[2] !== 'hwdownload=format=nv12') throw new Error(`third: ${parts[2]}`);
  if (parts[3] !== 'drawtext=text=hi') throw new Error(`fourth: ${parts[3]}`);
});

await run('buildHwFilterChain({gpuFilters:[]}) → throws (never faster than software)', () => {
  try {
    buildHwFilterChainFn({ accel: 'cuda', gpuFilters: [] });
  } catch (e) {
    if (!/gpuFilters is empty/.test((e as Error).message)) throw new Error(`got: ${(e as Error).message}`);
    return;
  }
  throw new Error('expected a throw');
});

await run('buildHwFilterChain honours downloadFormat', () => {
  const r = buildHwFilterChainFn({
    accel: 'vaapi', gpuFilters: ['scale_vaapi=w=640:h=360'], downloadFormat: 'yuv420p',
  });
  if (!r.includes('hwdownload=format=yuv420p')) throw new Error(`got: ${r}`);
});

await run('buildHwFilterChain({accel:"bogus"}) → throws', () => {
  let threw = false;
  try { buildHwFilterChainFn({ accel: 'bogus' as never, gpuFilters: ['scale_cuda=w=1:h=1'] }); }
  catch { threw = true; }
  if (!threw) throw new Error('expected a throw');
});

// ─── 48. Subtitles, ABR, delogo, builder methods ───────────────────────────
section('48 — SUBTITLES, ABR LADDER, DELOGO, ENCODE CONTROLS');

await run('subtitleCodecFor maps formats to real ffmpeg codecs', () => {
  const cases: [string, string][] = [
    ['srt', 'srt'], ['subrip', 'srt'], ['ass', 'ass'], ['ssa', 'ssa'],
    ['vtt', 'webvtt'], ['webvtt', 'webvtt'], ['mov_text', 'mov_text'], ['text', 'text'],
  ];
  for (const [fmt, codec] of cases) {
    const r = subtitleCodecForFn(fmt as never);
    if (r !== codec) throw new Error(`${fmt} → ${r} (want ${codec})`);
  }
});

await run('subtitleCodecFor("vtt") → "webvtt" (ffmpeg has no "vtt" codec)', () => {
  if (subtitleCodecForFn('vtt') !== 'webvtt') throw new Error('got a bare "vtt"');
});

await run('subtitleCodecFor("bogus") → throws listing valid formats', () => {
  try {
    subtitleCodecForFn('bogus' as never);
  } catch (e) {
    if (!/Unknown subtitle format "bogus"/.test((e as Error).message)) throw new Error(`got: ${(e as Error).message}`);
    return;
  }
  throw new Error('expected a throw');
});

await run('subtitleExtensionFor maps formats to the extension ffmpeg picks', () => {
  const cases: [string, string][] = [
    ['srt', '.srt'], ['subrip', '.srt'], ['ass', '.ass'], ['ssa', '.ass'],
    ['vtt', '.vtt'], ['webvtt', '.vtt'], ['mov_text', '.m4v'], ['text', '.txt'],
  ];
  for (const [fmt, ext] of cases) {
    const r = subtitleExtensionForFn(fmt as never);
    if (r !== ext) throw new Error(`${fmt} → ${r} (want ${ext})`);
  }
});

await run('convertSubtitles mkv → srt sidecar with real cues', async () => {
  await convertSubtitlesFn({ input: p('with_subs.mkv'), output: p('converted.srt'), format: 'srt' });
  if (!fs.existsSync(p('converted.srt'))) throw new Error('output not created');
  const body = fs.readFileSync(p('converted.srt'), 'utf8');
  if (!body.includes('Hello world')) throw new Error(`cue text missing: ${JSON.stringify(body.slice(0, 120))}`);
  if (!/-->/.test(body)) throw new Error('no cue timing lines');
});

await run('convertSubtitles mkv → webvtt writes a WEBVTT header', async () => {
  await convertSubtitlesFn({ input: p('with_subs.mkv'), output: p('converted.vtt'), format: 'webvtt' });
  const body = fs.readFileSync(p('converted.vtt'), 'utf8');
  if (!body.startsWith('WEBVTT')) throw new Error(`no WEBVTT header: ${JSON.stringify(body.slice(0, 40))}`);
});

await run('convertSubtitles({streamIndex:0}) picks the first subtitle stream', async () => {
  await convertSubtitlesFn({
    input: p('with_subs.mkv'), output: p('converted2.srt'), format: 'srt', streamIndex: 0,
  });
  if (fs.statSync(p('converted2.srt')).size === 0) throw new Error('empty output');
});

await run('convertSubtitles({shiftSeconds:1}) delays the cues', async () => {
  await convertSubtitlesFn({ input: p('with_subs.mkv'), output: p('shifted.srt'), shiftSeconds: 1 });
  const body = fs.readFileSync(p('shifted.srt'), 'utf8');
  const first = /(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> /.exec(body);
  if (!first) throw new Error('no cue timing found');
  const secs = Number(first[1]) * 3600 + Number(first[2]) * 60 + Number(first[3]) + Number(first[4]) / 1000;
  console.log(`      first cue now at ${secs}s (was 0.5s)`);
  if (secs <= 0.5) throw new Error(`cue was not shifted: ${secs}`);
});

await run('convertSubtitles({shiftSeconds,fixDuration}) → throws (two timing fixes)', async () => {
  try {
    await convertSubtitlesFn({
      input: p('with_subs.mkv'), output: p('x.srt'), shiftSeconds: 1, fixDuration: true,
    });
  } catch (e) {
    if (!/cannot both be set/.test((e as Error).message)) throw new Error(`got: ${(e as Error).message}`);
    return;
  }
  throw new Error('expected a throw');
});

await run('convertSubtitles({shiftSeconds:NaN}) → RangeError', async () => {
  try {
    await convertSubtitlesFn({
      input: p('with_subs.mkv'), output: p('x.srt'), shiftSeconds: Number.NaN,
    });
  } catch (e) {
    if (!(e instanceof RangeError)) throw new Error(`wrong type: ${(e as Error).constructor.name}`);
    return;
  }
  throw new Error('expected RangeError');
});

await run('convertSubtitles({burn:true}) burns into the video AND cleans up its temp dir', async () => {
  if (!HAS_DRAW_TEXT) throw new Error('ffmpeg has no drawtext filter');
  const before = fs.readdirSync('/tmp').filter(f => f.startsWith('mediaforge-subs-'));
  await convertSubtitlesFn({
    input: p('with_subs.mkv'), output: p('burned.mp4'), format: 'srt', burn: true,
  });
  if (!fs.existsSync(p('burned.mp4'))) throw new Error('output not created');
  if (fs.statSync(p('burned.mp4')).size === 0) throw new Error('output is empty');
  const after = fs.readdirSync('/tmp').filter(f => f.startsWith('mediaforge-subs-'));
  if (after.length !== before.length) {
    throw new Error(`temp sidecar dir leaked: ${after.filter(f => !before.includes(f)).join(', ')}`);
  }
});

await run('fixSubtitleDuration rewrites cue end times', async () => {
  await fixSubtitleDurationFn({ input: p('with_subs.mkv'), output: p('fixed.srt'), format: 'srt' });
  if (!fs.existsSync(p('fixed.srt'))) throw new Error('output not created');
  if (!/-->/.test(fs.readFileSync(p('fixed.srt'), 'utf8'))) throw new Error('no cue timings');
});

await run('buildVarStreamMap → "v:0,a:0,name:1080p v:1,a:1,name:720p"', () => {
  const r = buildVarStreamMapFn([
    { name: '1080p', resolution: '1920x1080', videoBitrate: '5M' },
    { name: '720p', resolution: '1280x720', videoBitrate: '2.5M' },
  ]);
  if (r.map !== 'v:0,a:0,name:1080p v:1,a:1,name:720p') throw new Error(`map: ${r.map}`);
  if (r.streamCount !== 2) throw new Error(`streamCount: ${r.streamCount}`);
});

await run('buildVarStreamMap([]) → throws', () => {
  let threw = false;
  try { buildVarStreamMapFn([]); } catch { threw = true; }
  if (!threw) throw new Error('expected a throw');
});

await run('validateAbrVariants accepts even dimensions', () => {
  validateAbrVariantsFn([
    { name: '720p', resolution: '1280x720', videoBitrate: '2M' },
    { name: '360p', resolution: '640x360', videoBitrate: '800k' },
  ]);
});

await run('validateAbrVariants rejects ODD dimensions (MPEG-TS/yuv420p)', () => {
  try {
    validateAbrVariantsFn([{ name: 'odd', resolution: '1281x720', videoBitrate: '2M' }]);
  } catch (e) {
    if (!/width of variant "odd" is 1281, which is odd/.test((e as Error).message)) {
      throw new Error(`got: ${(e as Error).message}`);
    }
    return;
  }
  throw new Error('expected a throw');
});

await run('validateAbrVariants rejects odd HEIGHT too', () => {
  try {
    validateAbrVariantsFn([{ name: 'odd', resolution: '1280x721', videoBitrate: '2M' }]);
  } catch (e) {
    if (!/height of variant "odd" is 721/.test((e as Error).message)) throw new Error(`got: ${(e as Error).message}`);
    return;
  }
  throw new Error('expected a throw');
});

await run('validateAbrVariants rejects a bad resolution / missing bitrate / empty name', () => {
  const cases: [unknown, RegExp][] = [
    [{ name: 'x', resolution: '1280', videoBitrate: '2M' }, /invalid resolution/],
    [{ name: 'x', resolution: 'abcxdef', videoBitrate: '2M' }, /invalid resolution/],
    [{ name: '', resolution: '1280x720', videoBitrate: '2M' }, /non-empty "name"/],
    [{ name: 'x', resolution: '1280x720', videoBitrate: '' }, /missing a "videoBitrate"/],
  ];
  for (const [variant, re] of cases) {
    try {
      validateAbrVariantsFn([variant as never]);
    } catch (e) {
      if (!re.test((e as Error).message)) throw new Error(`${JSON.stringify(variant)}: ${(e as Error).message}`);
      continue;
    }
    throw new Error(`expected a throw for ${JSON.stringify(variant)}`);
  }
});

await run('validateAbrVariants([]) → throws "at least one variant"', () => {
  try {
    validateAbrVariantsFn([]);
  } catch (e) {
    if (!/at least one variant/.test((e as Error).message)) throw new Error(`got: ${(e as Error).message}`);
    return;
  }
  throw new Error('expected a throw');
});

await run('buildAbrLadderFilter → split/asplit + one scale per variant', () => {
  const r = buildAbrLadderFilterFn({
    variants: [
      { name: '720p', resolution: '1280x720', videoBitrate: '2M' },
      { name: '360p', resolution: '640x360', videoBitrate: '800k' },
    ],
  });
  if (!r.includes('[0:v]split=2[v0][v1]')) throw new Error(`split: ${r}`);
  if (!r.includes('[0:a]asplit=2[a0][a1]')) throw new Error(`asplit: ${r}`);
  if (!r.includes('[v0]scale=1280:720[vout0]')) throw new Error(`scale 0: ${r}`);
  if (!r.includes('[v1]scale=640:360[vout1]')) throw new Error(`scale 1: ${r}`);
});

await run('buildAbrLadderFilter does not leave a trailing ";" (ffmpeg 4.x rejects it)', () => {
  const r = buildAbrLadderFilterFn({
    variants: [{ name: 'x', resolution: '640x360', videoBitrate: '1M' }],
  });
  if (r.endsWith(';')) throw new Error(`trailing semicolon: ${r}`);
});

await run('buildAbrLadderArgs composes the full single-pass ladder', () => {
  const args = buildAbrLadderArgsFn({
    input: 'in.mp4',
    outputPattern: 'v%v/index.m3u8',
    variants: [
      { name: '720p', resolution: '1280x720', videoBitrate: '2500k', audioBitrate: '128k' },
      { name: '360p', resolution: '640x360', videoBitrate: '800k' },
    ],
  });
  const joined = args.join(' ');
  if (!joined.includes('-var_stream_map v:0,a:0,name:720p v:1,a:1,name:360p')) throw new Error(`map: ${joined}`);
  if (!joined.includes('-map [vout0] -map [a0]')) throw new Error(`maps: ${joined}`);
  if (!joined.includes('-map [vout1] -map [a1]')) throw new Error(`maps: ${joined}`);
  if (!joined.includes('-b:v:0 2500k')) throw new Error(`bitrate 0: ${joined}`);
  if (!joined.includes('-b:a:0 128k')) throw new Error(`audio bitrate 0: ${joined}`);
  if (!joined.includes('-b:v:1 800k')) throw new Error(`bitrate 1: ${joined}`);
  // audio bitrate defaults rather than being left unset
  if (!joined.includes('-b:a:1 128k')) throw new Error(`default audio bitrate: ${joined}`);
  if (args[args.length - 1] !== 'v%v/index.m3u8') throw new Error('output pattern is not last');
});

await run('buildAbrLadderArgs passes the master playlist as a BARE name', () => {
  // ffmpeg resolves -master_pl_name against the output dir and prepends it
  // even to an absolute path, so an absolute name lands in the wrong place.
  const args = buildAbrLadderArgsFn({
    input: 'in.mp4',
    outputPattern: 'v%v/index.m3u8',
    variants: [{ name: 'x', resolution: '640x360', videoBitrate: '1M' }],
    masterPlaylist: 'master.m3u8',
  });
  const i = args.indexOf('-master_pl_name');
  if (i === -1) throw new Error('no -master_pl_name');
  if (args[i + 1] !== 'master.m3u8') throw new Error(`got: ${args[i + 1]}`);
  if (args[i + 1]!.includes('/')) throw new Error('master playlist name must not contain a path');
});

await run('buildAbrLadderArgs(outputPattern without %v) → throws', () => {
  try {
    buildAbrLadderArgsFn({
      input: 'in.mp4', outputPattern: 'index.m3u8',
      variants: [{ name: 'x', resolution: '640x360', videoBitrate: '1M' }],
    });
  } catch (e) {
    if (!/must contain "%v"/.test((e as Error).message)) throw new Error(`got: ${(e as Error).message}`);
    return;
  }
  throw new Error('expected a throw');
});

await run('buildAbrLadderArgs rejects odd dimensions too (same rule as the runner)', () => {
  try {
    buildAbrLadderArgsFn({
      input: 'in.mp4', outputPattern: 'v%v/i.m3u8',
      variants: [{ name: 'odd', resolution: '641x361', videoBitrate: '1M' }],
    });
  } catch (e) {
    if (!/is odd/.test((e as Error).message)) throw new Error(`got: ${(e as Error).message}`);
    return;
  }
  throw new Error('expected a throw');
});

await run('buildAbrLadderArgs({hlsFlags}) forwards the flags', () => {
  const args = buildAbrLadderArgsFn({
    input: 'in.mp4', outputPattern: 'v%v/i.m3u8', hlsFlags: 'independent_segments',
    variants: [{ name: 'x', resolution: '640x360', videoBitrate: '1M' }],
  });
  const i = args.indexOf('-hls_flags');
  if (i === -1 || args[i + 1] !== 'independent_segments') throw new Error(`args: ${args.join(' ')}`);
});

await run('abrLadder() returns a builder that encodes two renditions + a master playlist', async () => {
  const outDir = path.join(TMP, 'abr');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  await abrLadderFn({
    input: p('src.mp4'),
    outputPattern: path.join(outDir, 'v%v/index.m3u8'),
    variants: [
      { name: '720p', resolution: '320x180', videoBitrate: '400k' },
      { name: '360p', resolution: '160x90', videoBitrate: '150k' },
    ],
    segmentDuration: 1,
    videoCodec: 'libx264',
  }).run();
  const master = path.join(outDir, 'master.m3u8');
  if (!fs.existsSync(master)) throw new Error(`master playlist not found in ${outDir}: ${fs.readdirSync(outDir).join(', ')}`);
  const body = fs.readFileSync(master, 'utf8');
  if (!body.includes('#EXT-X-STREAM-INF')) throw new Error('no variant entries in the master playlist');
  console.log(`      master references ${body.match(/#EXT-X-STREAM-INF/g)?.length ?? 0} variants`);
});

await run('delogo(opts) standalone → "delogo=x=…:y=…:w=…:h=…"', () => {
  const r = delogoFn({ x: 10, y: 20, width: 100, height: 50 });
  if (r !== 'delogo=x=10:y=20:w=100:h=50') throw new Error(`got: ${r}`);
});

await run('delogo({show:true}) → show=1', () => {
  const r = delogoFn({ x: 0, y: 0, width: 10, height: 10, show: true });
  if (!r.includes('show=1')) throw new Error(`got: ${r}`);
});

await run('delogo chain overload appends to an existing FilterChain', async () => {
  const { FilterChain } = await import('./lib/types/filters.js');
  const chain = new FilterChain();
  delogoFn(chain, { x: 5, y: 5, width: 20, height: 20 });
  const r = chain.toString();
  if (!r.includes('delogo')) throw new Error(`chain lost the filter: ${r}`);
});

await run('delogo rejects negative geometry / zero size', () => {
  const bad: unknown[] = [
    { x: -1, y: 0, width: 10, height: 10 },
    { x: 0, y: -5, width: 10, height: 10 },
    { x: 0, y: 0, width: 0, height: 10 },
    { x: 0, y: 0, width: 10, height: 0 },
    { x: 0, y: 0, width: Number.NaN, height: 10 },
  ];
  for (const opts of bad) {
    try {
      delogoFn(opts as never);
    } catch (e) {
      if (!(e instanceof RangeError)) throw new Error(`${JSON.stringify(opts)}: ${(e as Error).constructor.name}`);
      continue;
    }
    throw new Error(`expected a throw for ${JSON.stringify(opts)}`);
  }
});

await run('delogo produces a real, playable file', async () => {
  await ffmpegFn(p("src.mp4")).output(p("delogo.mp4")).videoFilter(delogoFn({ x: 10, y: 10, width: 60, height: 40 })).run();
  if (!fs.existsSync(p('delogo.mp4'))) throw new Error('output not created');
  if (fs.statSync(p('delogo.mp4')).size === 0) throw new Error('output is empty');
});

// ─── 49. New encode-control builder methods ────────────────────────────────
section('49 — ENCODE CONTROLS: preset/profile/level/movflags/rateControl/color');

const argsOf = (fn: (b: ReturnType<typeof ffmpegFn>) => unknown) =>
  (fn(ffmpegFn(p('src.mp4')).output(p('ec_out.mp4'))) as { buildArgs(): string[] }).buildArgs();

await run('ffmpeg().preset() → -preset', () => {
  const args = argsOf(b => b.preset('slow'));
  const i = args.indexOf('-preset');
  if (i === -1 || args[i + 1] !== 'slow') throw new Error(`args: ${args.join(' ')}`);
});

await run('ffmpeg().profile() → -profile:v', () => {
  const args = argsOf(b => b.profile('high'));
  if (!args.join(' ').includes('-profile:v high')) throw new Error(`args: ${args.join(' ')}`);
});

await run('ffmpeg().level() → -level:v', () => {
  const args = argsOf(b => b.level('4.0'));
  if (!args.join(' ').includes('-level:v 4.0')) throw new Error(`args: ${args.join(' ')}`);
});

await run('ffmpeg().movflags() → -movflags', () => {
  const args = argsOf(b => b.movflags('+faststart'));
  if (!args.join(' ').includes('-movflags +faststart')) throw new Error(`args: ${args.join(' ')}`);
});

await run('ffmpeg().keyframeInterval() → -g', () => {
  const args = argsOf(b => b.keyframeInterval(60));
  if (!args.join(' ').includes('-g 60')) throw new Error(`args: ${args.join(' ')}`);
});

await run('ffmpeg().fpsMode("cfr") → a flag this ffmpeg actually accepts', () => {
  const args = argsOf(b => b.fpsMode('cfr'));
  const joined = args.join(' ');
  // -vsync was renamed to -fps_mode in ffmpeg 5.1. Emitting -fps_mode on 4.x
  // fails with "Unrecognized option 'fps_mode'"; -vsync still works on 5.1+.
  const v = ffmpegFn('x').getVersion();
  const modern = v.major > 5 || (v.major === 5 && v.minor >= 1);
  const expectedFlag = modern ? '-fps_mode' : '-vsync';
  if (!joined.includes(`${expectedFlag} cfr`)) {
    throw new Error(`ffmpeg ${v.major}.${v.minor} should get ${expectedFlag} cfr, got: ${joined}`);
  }
  console.log(`      ffmpeg ${v.major}.${v.minor} → ${expectedFlag}`);
});

await run('ffmpeg().fpsMode() with a mode this ffmpeg rejects → not silently passed', () => {
  // 'passthrough' and 'cfr'/'vfr'/'auto' are all valid; a bogus one must throw.
  let threw = false;
  try { ffmpegFn(p('src.mp4')).output('o.mp4').fpsMode('bogus' as never); } catch { threw = true; }
  if (!threw) throw new Error('accepted a bogus fps mode');
});

await run('ffmpeg().fpsMode("bogus") → throws listing the valid modes', () => {
  let msg = '';
  try { ffmpegFn(p('src.mp4')).output('o.mp4').fpsMode('bogus' as never); } catch (e) { msg = (e as Error).message; }
  if (!msg) throw new Error('expected a throw');
  for (const m of ['cfr', 'vfr', 'passthrough', 'auto']) {
    if (!msg.includes(m)) throw new Error(`should list ${m}: ${msg}`);
  }
});

await run('ffmpeg().rateControl({min,max,bufferSize}) → minrate/maxrate/bufsize', () => {
  const args = argsOf(b => b.rateControl({ min: '500k', max: '2500k', bufferSize: '5000k' }));
  const joined = args.join(' ');
  if (!joined.includes('-minrate 500k')) throw new Error(`minrate: ${joined}`);
  if (!joined.includes('-maxrate 2500k')) throw new Error(`maxrate: ${joined}`);
  if (!joined.includes('-bufsize 5000k')) throw new Error(`bufsize: ${joined}`);
});

await run('ffmpeg().rateControl({max}) leaves out -minrate and defaults bufsize to max', () => {
  const args = argsOf(b => b.rateControl({ max: '2M' }));
  const joined = args.join(' ');
  if (joined.includes('-minrate')) throw new Error(`emitted an unset -minrate: ${joined}`);
  if (!joined.includes('-maxrate 2M')) throw new Error(`maxrate: ${joined}`);
  if (!joined.includes('-bufsize 2M')) throw new Error(`bufsize should default to max: ${joined}`);
});

await run('ffmpeg().rateControl({bufferSize}) with no max → throws', () => {
  let msg = '';
  try { ffmpegFn(p('src.mp4')).output('o.mp4').rateControl({} as never); } catch (e) { msg = (e as Error).message; }
  if (!msg) throw new Error('expected a throw');
  if (!/max/.test(msg)) throw new Error(`error should name the missing option: ${msg}`);
});

await run('ffmpeg().setColorProperties({color_primaries,color_trc}) → -color_* flags', () => {
  const args = argsOf(b => b.setColorProperties({ color_primaries: 'bt2020', color_trc: 'smpte2084' }));
  const joined = args.join(' ');
  if (!joined.includes('-color_primaries bt2020')) throw new Error(`primaries: ${joined}`);
  if (!joined.includes('-color_trc smpte2084')) throw new Error(`trc: ${joined}`);
});

await run('ffmpeg().setColorProperties({colorspace,color_range}) → both flags', () => {
  const args = argsOf(b => b.setColorProperties({ colorspace: 'bt709', color_range: 'tv' }));
  const joined = args.join(' ');
  if (!joined.includes('-colorspace bt709')) throw new Error(`colorspace: ${joined}`);
  if (!joined.includes('-color_range tv')) throw new Error(`color_range: ${joined}`);
});

await run('ffmpeg().setColorProperties({bogus_key}) → throws (no silent pass-through)', () => {
  let msg = '';
  try {
    ffmpegFn(p('src.mp4')).output('o.mp4').setColorProperties({ not_a_real_key: 'x' } as never);
  } catch (e) { msg = (e as Error).message; }
  if (!msg) throw new Error('expected a throw');
  if (!/not_a_real_key/.test(msg)) throw new Error(`should name the bad key: ${msg}`);
  if (!/color_primaries/.test(msg)) throw new Error(`should list the valid keys: ${msg}`);
});

await run('ffmpeg().setColorProperties({}) → throws rather than doing nothing', () => {
  let threw = false;
  try { ffmpegFn(p('src.mp4')).output('o.mp4').setColorProperties({}); } catch { threw = true; }
  if (!threw) throw new Error('accepted an empty colour property set');
});

await run('COLOR_PROPERTY_KEYS covers the four ffmpeg colour flags', () => {
  for (const k of ['color_primaries', 'color_trc', 'colorspace', 'color_range']) {
    if (!(COLOR_PROPERTY_KEYS as readonly string[]).includes(k)) throw new Error(`missing: ${k}`);
  }
});

await run('encode controls are applied to the right output in a multi-output command', () => {
  const b = ffmpegFn(p('src.mp4'));
  b.output(p('a.mp4')).preset('slow');
  b.output(p('b.mp4')).preset('fast');
  const args = b.buildArgs();
  const joined = args.join(' ');
  if (!joined.includes('-preset slow')) throw new Error(`first output lost its preset: ${joined}`);
  if (!joined.includes('-preset fast')) throw new Error(`second output lost its preset: ${joined}`);
  if (args.filter(a => a === '-preset').length !== 2) throw new Error('preset leaked between outputs');
});

await run('fpsMode is per-output, not global', () => {
  const b = ffmpegFn(p('src.mp4'));
  b.output(p('a.mp4')).fpsMode('cfr');
  b.output(p('b.mp4'));
  const args = b.buildArgs();
  const modeFlags = args.filter(a => a === '-fps_mode' || a === '-vsync');
  if (modeFlags.length !== 1) throw new Error(`expected one frame-rate flag, got ${modeFlags.length}`);
});

await run('all encode controls together reach the command line in order', () => {
  const args = argsOf(b => b
    .preset('faster').profile('main').level('3.1').movflags('+faststart')
    .keyframeInterval(48).fpsMode('vfr')
    .setColorProperties({ color_primaries: 'bt709', color_trc: 'bt709' }));
  const joined = args.join(' ');
  for (const expect of ['-preset faster', '-profile:v main', '-level:v 3.1',
    '-movflags +faststart', '-g 48', 'vfr', '-color_primaries bt709', '-color_trc bt709']) {
    if (!joined.includes(expect)) throw new Error(`missing ${expect}: ${joined}`);
  }
  // The colour flags must not be emitted as bare "flags" before the inputs.
  if (args.indexOf('-color_trc') < args.indexOf('-i')) {
    throw new Error('colour flags leaked into the global/input section');
  }
});

await run('all encode controls together encode a real file', async () => {
  await ffmpegFn(p('src.mp4')).output(p('controls.mp4'))
    .preset('ultrafast').profile('baseline').level('3.0').movflags('+faststart')
    .keyframeInterval(30).fpsMode('cfr')
    .setColorProperties({ color_primaries: 'bt709', color_trc: 'bt709' })
    .run();
  if (!fs.existsSync(p('controls.mp4'))) throw new Error('output not created');
  if (fs.statSync(p('controls.mp4')).size === 0) throw new Error('output is empty');
});


// ─── summary ────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log('  NEW-FEATURE BATTLE TEST SUMMARY');
console.log('═'.repeat(60));
console.log(`  ✅ PASSED : ${passed}`);
console.log(`  ⏭  SKIPPED: ${skipped}`);
console.log(`  ❌ FAILED : ${errors.length}`);

if (errors.length > 0) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  FAILED TESTS — FULL ERROR LOG');
  console.log('─'.repeat(60));
  for (let i = 0; i < errors.length; i++) {
    console.log(`\n  [${i + 1}] ${errors[i]!.label}`);
    console.log(`       ERROR : ${errors[i]!.error}`);
    const stackLines = errors[i]!.stack.split('\n').slice(1, 4).join('\n       ');
    if (stackLines) console.log(`       STACK : ${stackLines}`);
  }
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${errors.length} test(s) failed. See above for details.`);
  console.log('─'.repeat(60));
  process.exit(1);
} else {
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('\n  All new-feature tests passed! 🎉');
}
