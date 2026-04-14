/**
 * deno-tests/battle.test.ts — MediaForge Deno Battle Test
 *
 * Mirrors battle.test.mjs but imports directly from lib/ (Deno source).
 * Verifies the library works correctly under Deno runtime.
 *
 * Run: deno task battle
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, 'tmp_battle');
fs.mkdirSync(TMP, { recursive: true });

const p = (name: string) => path.join(TMP, name);
const errors: Array<{ label: string; error: string; stack: string }> = [];
let passed = 0;

async function run(label: string, fn: () => void | Promise<void>): Promise<void> {
  process.stdout.write(`  ▸ ${label} ... `);
  try {
    await fn();
    console.log('✅ PASS');
    passed++;
  } catch (err: unknown) {
    const msg = err instanceof Error ? (err.message ?? String(err)) : String(err);
    const stack = err instanceof Error ? (err.stack ?? '') : '';
    console.log(`❌ FAIL\n      ${msg.slice(0, 200)}`);
    errors.push({ label, error: msg, stack });
  }
}

function section(title: string): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

function ffmpegExec(args: string): void {
  execSync(`ffmpeg -y ${args}`, { stdio: 'pipe' });
}

// ─── Imports ─────────────────────────────────────────────────────────────────
import {
  ffmpeg, FFmpegBuilder,
  screenshots, frameToBuffer,
  pipeThrough, streamOutput, streamToFile,
  mergeToFile, concatFiles,
  toGif, gifToMp4,
  normalizeAudio, adjustVolume,
  addWatermark, addTextWatermark,
  burnSubtitles, extractSubtitles,
  writeMetadata, stripMetadata,
  generateWaveform, generateSpectrum,
  getPreset, applyPreset, listPresets,
  hlsPackage, adaptiveHls, dashPackage,
  twoPassEncode, buildTwoPassArgs,
  mapStream, mapAVS, copyStream, setMetadata, ss,
  nvencToArgs, vaapiToArgs,
  scale, crop, overlay, drawtext, fade,
  volume, loudnorm, equalizer, atempo,
  FilterGraph, videoFilterChain, filterGraph,
  probe, probeAsync, ProbeError,
  getVideoStreams, getAudioStreams,
  getDefaultVideoStream, getDefaultAudioStream,
  getMediaDuration, durationToMicroseconds,
  summarizeVideoStream, summarizeAudioStream,
  parseFrameRate, parseDuration, parseBitrate,
  isHdr, isInterlaced, getChapterList,
  findStreamByLanguage, formatDuration,
  renice, autoKillOnExit, killAllFFmpeg,
  guardCodec, guardFeatureVersion, selectBestCodec,
  // New codec helpers
  proResToArgs, dnxhdToArgs, mjpegToArgs, mpeg2ToArgs,
  mpeg4ToArgs, vp8ToArgs, theoraToArgs, ffv1ToArgs,
  alacToArgs, eac3ToArgs, truehdToArgs, vorbisToArgs,
  wavpackToArgs, pcmToArgs, mp2ToArgs,
  mediacodecVideoToArgs, vulkanVideoToArgs,
} from '../lib/index.ts';

// ─── Setup ────────────────────────────────────────────────────────────────────
section('SETUP — generating test media');

await run('generate input.mp4 (10s)', () => {
  ffmpegExec(
    '-f lavfi -i testsrc=duration=10:size=640x360:rate=30 ' +
    '-f lavfi -i sine=frequency=440:duration=10 ' +
    '-c:v libx264 -preset ultrafast -c:a aac -movflags +faststart ' + p('input.mp4')
  );
});

await run('generate short.mp4 (3s)', () => {
  ffmpegExec(
    '-f lavfi -i testsrc=duration=3:size=320x180:rate=15 ' +
    '-f lavfi -i sine=frequency=440:duration=3 ' +
    '-c:v libx264 -preset ultrafast -c:a aac -movflags +faststart ' + p('short.mp4')
  );
});

await run('generate audio.mp3', () => {
  ffmpegExec('-f lavfi -i sine=frequency=440:duration=10 -c:a libmp3lame -b:a 128k ' + p('audio.mp3'));
});

await run('generate logo.png', () => {
  ffmpegExec('-f lavfi -i color=red:size=100x50:rate=1 -frames:v 1 ' + p('logo.png'));
});

await run('generate parts', () => {
  for (const n of ['part1', 'part2', 'part3']) {
    ffmpegExec(
      '-f lavfi -i testsrc=duration=2:size=320x180:rate=15 ' +
      '-f lavfi -i sine=frequency=440:duration=2 ' +
      '-c:v libx264 -preset ultrafast -c:a aac -movflags +faststart ' + p(`${n}.mp4`)
    );
  }
});

await run('generate subs.srt', () => {
  fs.writeFileSync(p('subs.srt'), '1\n00:00:00,500 --> 00:00:02,000\nHello world\n');
});

// ─── 1. Fluent Builder ────────────────────────────────────────────────────────
section('1 — FLUENT BUILDER');

await run('.videoCodec .audioBitrate .run()', async () => {
  await ffmpeg(p('input.mp4')).output(p('out_basic.mp4')).videoCodec('libx264').videoBitrate('500k').audioCodec('aac').audioBitrate('64k').run();
  if (!fs.existsSync(p('out_basic.mp4'))) throw new Error('output not created');
});
await run('.crf .fps .size', async () => {
  await ffmpeg(p('input.mp4')).output(p('out_crf.mp4')).videoCodec('libx264').crf(28).fps(15).size('320x180').run();
  if (!fs.existsSync(p('out_crf.mp4'))) throw new Error('output not created');
});
await run('.noVideo() audio only', async () => {
  await ffmpeg(p('input.mp4')).output(p('out_audio.mp3')).noVideo().audioCodec('libmp3lame').audioBitrate('128k').run();
  if (!fs.existsSync(p('out_audio.mp3'))) throw new Error('output not created');
});
await run('.addOutputOption .addGlobalOption', async () => {
  await ffmpeg(p('input.mp4')).output(p('out_opts.mp4')).videoCodec('libx264').addOutputOption('-preset', 'ultrafast').addGlobalOption('-loglevel', 'error').run();
  if (!fs.existsSync(p('out_opts.mp4'))) throw new Error('output not created');
});
await run('.map .overwrite .logLevel', async () => {
  await ffmpeg(p('input.mp4')).output(p('out_map.mp4')).map('0:v:0').map('0:a:0').videoCodec('copy').audioCodec('copy').overwrite(true).logLevel('error').run();
  if (!fs.existsSync(p('out_map.mp4'))) throw new Error('output not created');
});
await run('.videoFilter .audioFilter strings', async () => {
  await ffmpeg(p('input.mp4')).output(p('out_filters.mp4')).videoFilter('scale=320:180').audioFilter('volume=0.5').videoCodec('libx264').audioCodec('aac').run();
  if (!fs.existsSync(p('out_filters.mp4'))) throw new Error('output not created');
});
await run('.spawn() + emitter', async () => {
  const proc = ffmpeg(p('input.mp4')).output(p('out_spawn.mp4')).videoCodec('copy').audioCodec('copy').spawn();
  if (!proc?.emitter) throw new Error('no emitter');
  await new Promise<void>((res, rej) => { proc.emitter.on('end', res); proc.emitter.on('error', rej); });
  if (!fs.existsSync(p('out_spawn.mp4'))) throw new Error('output not created');
});

// ─── 2. Screenshots ───────────────────────────────────────────────────────────
section('2 — SCREENSHOTS');

await run('screenshots count:3', async () => {
  const folder = path.join(TMP, 'thumbs');
  fs.mkdirSync(folder, { recursive: true });
  const { files } = await screenshots({ input: p('input.mp4'), folder, count: 3 });
  if (!Array.isArray(files) || files.length === 0) throw new Error('no files returned');
});
await run('frameToBuffer png', async () => {
  const buf = await frameToBuffer({ input: p('input.mp4'), timestamp: 2, format: 'png' });
  if (!(buf instanceof Uint8Array) || buf.length === 0) throw new Error('empty buffer');
});

// ─── 3. Pipe & Stream ─────────────────────────────────────────────────────────
section('3 — PIPE & STREAM I/O');

await run('streamOutput readable stream', async () => {
  const stream = streamOutput({ input: p('input.mp4'), outputFormat: 'mp4', outputArgs: ['-c', 'copy', '-movflags', 'frag_keyframe+empty_moov'] });
  const chunks: Uint8Array[] = [];
  await new Promise<void>((res, rej) => { stream.on('data', (c: Uint8Array) => chunks.push(c)); stream.on('end', res); stream.on('error', rej); });
  if (chunks.length === 0) throw new Error('no data');
});
await run('streamToFile stream→file', async () => {
  const readable = fs.createReadStream(p('input.mp4'));
  await streamToFile({ stream: readable, inputFormat: 'mp4', output: p('out_s2f.mp4'), outputArgs: ['-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac'] });
  if (!fs.existsSync(p('out_s2f.mp4'))) throw new Error('output not created');
});

// ─── 4. Concat & Merge ───────────────────────────────────────────────────────
section('4 — CONCAT & MERGE');

await run('mergeToFile (copy)', async () => {
  await mergeToFile({ inputs: [p('part1.mp4'), p('part2.mp4'), p('part3.mp4')], output: p('merged.mp4') });
  if (!fs.existsSync(p('merged.mp4'))) throw new Error('output not created');
});
await run('mergeToFile (reencode)', async () => {
  await mergeToFile({ inputs: [p('part1.mp4'), p('part2.mp4')], output: p('merged_re.mp4'), reencode: true, videoCodec: 'libx264', audioCodec: 'aac' });
  if (!fs.existsSync(p('merged_re.mp4'))) throw new Error('output not created');
});

// ─── 5. GIF ──────────────────────────────────────────────────────────────────
section('5 — ANIMATED GIF');

await run('toGif 2-pass', async () => {
  await toGif({ input: p('short.mp4'), output: p('out.gif'), width: 160, fps: 10, colors: 128 });
  if (!fs.existsSync(p('out.gif'))) throw new Error('output not created');
});

// ─── 6. Audio Normalization ───────────────────────────────────────────────────
section('6 — AUDIO NORMALIZATION');

await run('normalizeAudio -23 LUFS', async () => {
  await normalizeAudio({ input: p('input.mp4'), output: p('normalized.mp4'), targetI: -23 });
  if (!fs.existsSync(p('normalized.mp4'))) throw new Error('output not created');
});
await run('adjustVolume 0.5', async () => {
  await adjustVolume({ input: p('input.mp4'), output: p('vol_half.mp4'), volume: '0.5' });
  if (!fs.existsSync(p('vol_half.mp4'))) throw new Error('output not created');
});

// ─── 7. Watermarks ───────────────────────────────────────────────────────────
section('7 — WATERMARKS');

await run('addWatermark bottom-right', async () => {
  await addWatermark({ input: p('input.mp4'), watermark: p('logo.png'), output: p('wm_br.mp4'), position: 'bottom-right', opacity: 0.8 });
  if (!fs.existsSync(p('wm_br.mp4'))) throw new Error('output not created');
});
await run('addTextWatermark center', async () => {
  await addTextWatermark({ input: p('input.mp4'), output: p('wm_text.mp4'), text: 'Deno Test', position: 'center', fontSize: 24 });
  if (!fs.existsSync(p('wm_text.mp4'))) throw new Error('output not created');
});

// ─── 8. Subtitles ─────────────────────────────────────────────────────────────
section('8 — SUBTITLES');

await run('burnSubtitles', async () => {
  await burnSubtitles({ input: p('short.mp4'), subtitleFile: p('subs.srt'), output: p('burned.mp4') });
  if (!fs.existsSync(p('burned.mp4'))) throw new Error('output not created');
});

// ─── 9. Metadata ─────────────────────────────────────────────────────────────
section('9 — METADATA');

await run('writeMetadata + chapters', async () => {
  await writeMetadata({
    input: p('input.mp4'), output: p('tagged.mp4'),
    metadata: { title: 'Deno Battle Test', artist: 'mediaforge' },
    chapters: [{ title: 'Intro', startSec: 0, endSec: 5 }],
  });
  if (!fs.existsSync(p('tagged.mp4'))) throw new Error('output not created');
});
await run('stripMetadata', async () => {
  await stripMetadata({ input: p('tagged.mp4'), output: p('stripped.mp4') });
  if (!fs.existsSync(p('stripped.mp4'))) throw new Error('output not created');
});

// ─── 10. Waveform ─────────────────────────────────────────────────────────────
section('10 — WAVEFORM & SPECTRUM');

await run('generateWaveform', async () => {
  await generateWaveform({ input: p('audio.mp3'), output: p('wave.png'), width: 800, height: 120, color: '#00aaff' });
  if (!fs.existsSync(p('wave.png'))) throw new Error('output not created');
});

// ─── 11. Presets ──────────────────────────────────────────────────────────────
section('11 — PRESETS');

await run('listPresets + applyPreset web', async () => {
  const list = listPresets();
  if (!Array.isArray(list) || list.length === 0) throw new Error('empty list');
  const args = applyPreset('web');
  if (!Array.isArray(args)) throw new Error('not array');
  await ffmpeg(p('input.mp4')).output(p('preset_web.mp4')).addOutputOption(...args).run();
  if (!fs.existsSync(p('preset_web.mp4'))) throw new Error('output not created');
});

// ─── 12. HLS & DASH ──────────────────────────────────────────────────────────
section('12 — HLS & DASH');

await run('hlsPackage', async () => {
  const outDir = path.join(TMP, 'hls_single');
  fs.mkdirSync(outDir, { recursive: true });
  await hlsPackage({ input: p('short.mp4'), outputDir: outDir, segmentDuration: 2, videoCodec: 'libx264', videoBitrate: '500k', audioBitrate: '64k' }).run();
  if (!fs.readdirSync(outDir).some((f: string) => f.endsWith('.m3u8'))) throw new Error('no m3u8');
});
await run('adaptiveHls multi-bitrate', async () => {
  const outDir = path.join(TMP, 'hls_adaptive');
  fs.mkdirSync(outDir, { recursive: true });
  await adaptiveHls({ input: p('short.mp4'), outputDir: outDir, variants: [{ label: '360p', resolution: '640x360', videoBitrate: '500k', audioBitrate: '64k' }, { label: '180p', resolution: '320x180', videoBitrate: '200k', audioBitrate: '48k' }] }).run();
  const outFiles = fs.readdirSync(outDir);
  if (!outFiles.some((f: string) => f.endsWith('.m3u8'))) throw new Error('no m3u8 generated');
});
await run('dashPackage', async () => {
  const outDir = path.join(TMP, 'dash');
  fs.mkdirSync(outDir, { recursive: true });
  await dashPackage({ input: p('short.mp4'), output: path.join(outDir, 'manifest.mpd'), segmentDuration: 2, videoCodec: 'libx264', videoBitrate: '500k' }).run();
  if (!fs.existsSync(path.join(outDir, 'manifest.mpd'))) throw new Error('manifest.mpd not created');
});

// ─── 13. Two-Pass ─────────────────────────────────────────────────────────────
section('13 — TWO-PASS ENCODING');

await run('twoPassEncode', async () => {
  let pass1Done = false;
  await twoPassEncode({ input: p('short.mp4'), output: p('twopass.mp4'), videoCodec: 'libx264', videoBitrate: '500k', audioCodec: 'aac', audioBitrate: '64k', onPass1Complete: () => { pass1Done = true; } });
  if (!pass1Done) throw new Error('pass1 callback not fired');
  if (!fs.existsSync(p('twopass.mp4'))) throw new Error('output not created');
});
await run('buildTwoPassArgs', () => {
  const { pass1, pass2 } = buildTwoPassArgs({ input: p('short.mp4'), output: p('x.mp4'), videoCodec: 'libx264', videoBitrate: '500k' });
  if (!Array.isArray(pass1) || !Array.isArray(pass2)) throw new Error('not arrays');
  if (!pass1.some((a: string) => a.endsWith('.mkv'))) throw new Error('no .mkv output in pass1');
});

// ─── 14. Stream Mapping ───────────────────────────────────────────────────────
section('14 — STREAM MAPPING DSL');

await run('mapStream(0,"v",0) returns string', () => {
  const result = mapStream(0, 'v', 0);
  if (typeof result !== 'string') throw new Error(`expected string, got ${typeof result}`);
  if (result !== '0:v:0') throw new Error(`expected '0:v:0', got '${result}'`);
});
await run('mapAVS returns array', () => { if (!mapAVS(0)) throw new Error('falsy'); });
await run('setMetadata returns args', () => { if (!setMetadata('title', 'test')) throw new Error('falsy'); });
await run('ss() language mapping', () => { if (!ss(0, 'a', 0)) throw new Error('falsy'); });

// ─── 15. Hardware Acceleration ────────────────────────────────────────────────
section('15 — HARDWARE ACCELERATION (args)');

await run('nvencToArgs returns array', () => { if (!Array.isArray(nvencToArgs({ preset: 'p4' }, 'h264_nvenc'))) throw new Error('not array'); });
await run('vaapiToArgs returns array', () => { if (!Array.isArray(vaapiToArgs({}, 'h264_vaapi'))) throw new Error('not array'); });
await run('selectHwaccel returns string|null', () => {
  const builder = new FFmpegBuilder(p('input.mp4'));
  const best = builder.selectHwaccel(['cuda', 'vaapi', 'none']);
  if (best !== null && typeof best !== 'string') throw new Error(`unexpected: ${best}`);
});

// ─── 16. Filter System ────────────────────────────────────────────────────────
section('16 — FILTER SYSTEM');

await run('scale({w,h}) returns string', () => {
  const f = scale({ w: 640, h: 360 });
  if (typeof f !== 'string') throw new Error('not string');
  if (!f.includes('scale')) throw new Error('no scale in output');
});
await run('crop({w,h,x,y}) returns string', () => {
  const f = crop({ w: 320, h: 180, x: 0, y: 0 });
  if (f == null) throw new Error('null return');
});
await run('overlay({x,y}) returns string', () => {
  const f = overlay({ x: 10, y: 10 });
  if (f == null) throw new Error('null return');
});
await run('drawtext({text,...}) returns string', () => {
  const f = drawtext({ text: 'hello', x: 10, y: 10, fontsize: 24 });
  if (f == null) throw new Error('null return');
  if (!f.includes('drawtext')) throw new Error('no drawtext');
});
await run('fade({type,...}) returns string', () => {
  const f = fade({ type: 'in', start_time: 0, duration: 1 });
  if (f == null) throw new Error('null return');
});
await run('volume({volume}) returns string', () => {
  const f = volume({ volume: '0.5' });
  if (f == null) throw new Error('null return');
  if (!f.includes('volume')) throw new Error('no volume in output');
});
await run('loudnorm({i,lra,tp}) returns string', () => {
  const f = loudnorm({ i: -16, lra: 11, tp: -1.5 });
  if (f == null) throw new Error('null return');
  if (!f.includes('loudnorm')) throw new Error('no loudnorm');
});
await run('equalizer returns string', () => {
  const f = equalizer({ frequency: 1000, width_type: 'o', width: 1, gain: 3 });
  if (f == null) throw new Error('null return');
});
await run('atempo({tempo}) returns string', () => {
  const f = atempo({ tempo: 1.5 });
  if (f == null) throw new Error('null return');
  if (!f.includes('atempo')) throw new Error('no atempo');
});
await run('filterGraph() factory', () => {
  const fg = filterGraph();
  if (fg == null) throw new Error('null return');
});
await run('FilterGraph class', () => {
  if (FilterGraph == null) throw new Error('not exported');
  const fg = new FilterGraph();
  if (fg == null) throw new Error('null instance');
});
await run('scale via .videoFilter()', async () => {
  await ffmpeg(p('input.mp4')).output(p('filter_scale.mp4')).videoFilter(scale({ w: 320, h: 180 })).videoCodec('libx264').audioCodec('copy').run();
  if (!fs.existsSync(p('filter_scale.mp4'))) throw new Error('output not created');
});
await run('loudnorm via .audioFilter()', async () => {
  await ffmpeg(p('input.mp4')).output(p('filter_loudnorm.mp4')).audioFilter(loudnorm({ i: -16, lra: 11, tp: -1.5 })).videoCodec('copy').audioCodec('aac').run();
  if (!fs.existsSync(p('filter_loudnorm.mp4'))) throw new Error('output not created');
});

// ─── 17. FFprobe ──────────────────────────────────────────────────────────────
section('17 — FFPROBE INTEGRATION');

await run('probe() sync', () => {
  const info = probe(p('input.mp4'));
  if (!info?.streams) throw new Error('no streams');
  if (!info.format) throw new Error('no format');
});
await run('probeAsync()', async () => {
  const info = await probeAsync(p('input.mp4'));
  if (!info?.streams) throw new Error('no streams');
});
await run('getVideoStreams + getDefaultVideoStream', () => {
  const info = probe(p('input.mp4'));
  const streams = getVideoStreams(info);
  if (!Array.isArray(streams) || streams.length === 0) throw new Error('no video streams');
  const def = getDefaultVideoStream(info);
  if (!def) throw new Error('no default video');
});
await run('getMediaDuration + durationToMicroseconds', () => {
  const info = probe(p('input.mp4'));
  const dur = getMediaDuration(info);
  if (typeof dur !== 'number' || (dur as number) <= 0) throw new Error(`bad duration: ${dur}`);
  const us = durationToMicroseconds(dur as number);
  if (typeof us !== 'number' || us <= 0) throw new Error(`bad microseconds: ${us}`);
});
await run('parseFrameRate returns ParsedFrameRate object', () => {
  const info = probe(p('input.mp4'));
  const stream = getDefaultVideoStream(info);
  const fps = parseFrameRate(stream?.r_frame_rate ?? stream?.avg_frame_rate ?? '30/1');
  if (!fps || typeof fps.value !== 'number' || fps.value <= 0) throw new Error(`unexpected fps: ${JSON.stringify(fps)}`);
});
await run('parseDuration + parseBitrate', () => {
  const d = parseDuration('00:01:30');
  if (typeof d !== 'number') throw new Error(`bad duration: ${d}`);
  const b = parseBitrate('2M');
  if (typeof b !== 'number') throw new Error(`bad bitrate: ${b}`);
});
await run('isHdr + isInterlaced', () => {
  const info = probe(p('input.mp4'));
  if (typeof isHdr(info) !== 'boolean') throw new Error('isHdr not boolean');
  if (typeof isInterlaced(info) !== 'boolean') throw new Error('isInterlaced not boolean');
});
await run('formatDuration', () => {
  const s = formatDuration(90.5);
  if (typeof s !== 'string') throw new Error('not string');
});

// ─── 18. Process Management ───────────────────────────────────────────────────
section('18 — PROCESS MANAGEMENT');

await run('autoKillOnExit + killAllFFmpeg', async () => {
  const proc = ffmpeg(p('input.mp4')).output(p('out_ak.mp4')).videoCodec('copy').audioCodec('copy').spawn();
  const unregister = autoKillOnExit(proc.child);
  if (typeof unregister !== 'function') throw new Error('expected unregister fn');
  await new Promise<void>((res, rej) => { proc.emitter.on('end', res); proc.emitter.on('error', rej); });
  unregister();
  if (typeof killAllFFmpeg !== 'function') throw new Error('killAllFFmpeg not fn');
});

// ─── 19. Compatibility Guards ─────────────────────────────────────────────────
section('19 — COMPATIBILITY GUARDS');

await run('checkCodec + selectVideoCodec', async () => {
  const builder = new FFmpegBuilder(p('input.mp4'));
  const result = await builder.checkCodec('libx264', 'encode');
  if (typeof result !== 'object' || !('available' in result)) throw new Error('bad result shape');
  const codec = await builder.selectVideoCodec([{ codec: 'h264_nvenc', featureKey: 'nvenc' }, { codec: 'libx264' }]);
  if (typeof codec !== 'string') throw new Error(`expected string, got ${typeof codec}`);
});
await run('guardCodec + guardFeatureVersion + selectBestCodec exported', () => {
  if (typeof guardCodec !== 'function') throw new Error('guardCodec not fn');
  if (typeof guardFeatureVersion !== 'function') throw new Error('guardFeatureVersion not fn');
  if (typeof selectBestCodec !== 'function') throw new Error('selectBestCodec not fn');
});

// ─── 20. New Codec Serializers ────────────────────────────────────────────────
section('20 — NEW CODEC SERIALIZERS (video)');

await run('proResToArgs defaults + profile', () => {
  if (!proResToArgs().includes('prores_ks')) throw new Error('prores_ks not found');
  if (!proResToArgs({ profile: 3 }).includes('3')) throw new Error('profile 3 not found');
  if (!proResToArgs({}, 'prores_aw').includes('prores_aw')) throw new Error('encoder override failed');
});
await run('dnxhdToArgs bitrate + pixFmt', () => {
  if (!dnxhdToArgs({ bitrate: 145, pixFmt: 'yuv422p10le' }).includes('145k')) throw new Error('bitrate missing');
});
await run('mjpegToArgs qscale', () => { if (!mjpegToArgs({ qscale: 3 }).includes('mjpeg')) throw new Error(); });
await run('mpeg2ToArgs interlaced', () => { if (!mpeg2ToArgs({ interlaced: true }).includes('+ildct+ilme')) throw new Error(); });
await run('mpeg4ToArgs + libxvid', () => { if (!mpeg4ToArgs({}, 'libxvid').includes('libxvid')) throw new Error(); });
await run('vp8ToArgs libvpx', () => { if (!vp8ToArgs({ bitrate: 800 }).includes('libvpx')) throw new Error(); });
await run('theoraToArgs libtheora', () => { if (!theoraToArgs({ qscale: 7 }).includes('libtheora')) throw new Error(); });
await run('ffv1ToArgs sliceCrc', () => { if (!ffv1ToArgs({ version: 3, sliceCrc: true }).includes('ffv1')) throw new Error(); });

section('20 — NEW CODEC SERIALIZERS (audio)');

await run('alacToArgs', () => { if (!alacToArgs().includes('alac')) throw new Error(); });
await run('eac3ToArgs bitrate + dialnorm', () => {
  const args = eac3ToArgs({ bitrate: 640, dialNorm: -24 });
  if (!args.includes('eac3')) throw new Error();
  if (!args.includes('-24')) throw new Error('dialnorm missing');
});
await run('truehdToArgs', () => { if (!truehdToArgs().includes('truehd')) throw new Error(); });
await run('vorbisToArgs', () => { if (!vorbisToArgs({ qscale: 5 }).includes('libvorbis')) throw new Error(); });
await run('wavpackToArgs', () => { if (!wavpackToArgs().includes('wavpack')) throw new Error(); });
await run('pcmToArgs pcm_s16le + pcm_s24le + pcm_f32le', () => {
  if (!pcmToArgs('pcm_s16le', { sampleRate: 48000 }).includes('pcm_s16le')) throw new Error();
  if (!pcmToArgs('pcm_s24le').includes('pcm_s24le')) throw new Error();
  if (!pcmToArgs('pcm_f32le').includes('pcm_f32le')) throw new Error();
});
await run('mp2ToArgs bitrate', () => { if (!mp2ToArgs({ bitrate: 192 }).includes('192k')) throw new Error(); });

section('20 — NEW CODEC SERIALIZERS (hardware)');

await run('mediacodecVideoToArgs h264/hevc/av1', () => {
  if (!mediacodecVideoToArgs({}).includes('h264_mediacodec')) throw new Error();
  if (!mediacodecVideoToArgs({ bitrate: 4000 }, 'hevc_mediacodec').includes('hevc_mediacodec')) throw new Error();
  if (!mediacodecVideoToArgs({}, 'av1_mediacodec').includes('av1_mediacodec')) throw new Error();
});
await run('vulkanVideoToArgs h264/hevc/av1', () => {
  if (!vulkanVideoToArgs({}).includes('h264_vulkan')) throw new Error();
  if (!vulkanVideoToArgs({ crf: 22 }, 'hevc_vulkan').includes('hevc_vulkan')) throw new Error();
  if (!vulkanVideoToArgs({}, 'av1_vulkan').includes('av1_vulkan')) throw new Error();
});

// ─── Cleanup ─────────────────────────────────────────────────────────────────
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log('  DENO BATTLE TEST SUMMARY');
console.log('═'.repeat(60));
console.log(`  ✅ PASSED : ${passed}`);
console.log(`  ❌ FAILED : ${errors.length}`);

if (errors.length > 0) {
  console.log(`\n${'─'.repeat(60)}`);
  for (let i = 0; i < errors.length; i++) {
    console.log(`\n  [${i + 1}] ${errors[i].label}`);
    console.log(`       ERROR : ${errors[i].error}`);
    const stackLines = errors[i].stack.split('\n').slice(1, 3).join('\n       ');
    if (stackLines) console.log(`       STACK : ${stackLines}`);
  }
  console.log(`\n  ${errors.length} test(s) failed.`);
  console.log('─'.repeat(60));
  Deno.exit(1);
} else {
  console.log('\n  All tests passed! 🎉');
}
