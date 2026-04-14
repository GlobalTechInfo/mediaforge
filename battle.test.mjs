/**
 * mediaforge battle test
 * Covers every export and method documented in the README.
 * Each test is isolated — errors are collected and the suite keeps running.
 * A full summary is printed at the end.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, 'tmp');
fs.mkdirSync(TMP, { recursive: true });

// ─── helpers ───────────────────────────────────────────────────────────────
const p = (name) => path.join(TMP, name);
const errors = [];
let passed = 0;
let skipped = 0;

async function run(label, fn) {
  process.stdout.write(`  ▸ ${label} ... `);
  try {
    await fn();
    console.log('✅ PASS');
    passed++;
  } catch (err) {
    const msg = err?.message ?? String(err);
    console.log(`❌ FAIL\n      ${msg}`);
    errors.push({ label, error: msg, stack: err?.stack ?? '' });
  }
}

function skip(label, reason) {
  console.log(`  ▸ ${label} ... ⏭  SKIP (${reason})`);
  skipped++;
}

function section(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

// ─── generate test media with ffmpeg built-in sources ──────────────────────
section('SETUP — generating test media');

function ffmpegExec(args) {
  execSync(`ffmpeg -y ${args}`, { stdio: 'pipe' });
}

await run('generate input.mp4 (10s 640x360 video+audio)', () => {
  ffmpegExec(
    '-f lavfi -i testsrc=duration=10:size=640x360:rate=30 ' +
    '-f lavfi -i sine=frequency=440:duration=10 ' +
    '-c:v libx264 -preset ultrafast -c:a aac -movflags +faststart ' +
    p('input.mp4')
  );
});

await run('generate short.mp4 (3s)', () => {
  ffmpegExec(
    '-f lavfi -i testsrc=duration=3:size=320x180:rate=15 ' +
    '-f lavfi -i sine=frequency=440:duration=3 ' +
    '-c:v libx264 -preset ultrafast -c:a aac -movflags +faststart ' +
    p('short.mp4')
  );
});

await run('generate audio.mp3', () => {
  ffmpegExec(
    '-f lavfi -i sine=frequency=440:duration=10 ' +
    '-c:a libmp3lame -b:a 128k ' +
    p('audio.mp3')
  );
});

await run('generate audio_raw.wav', () => {
  ffmpegExec(
    '-f lavfi -i sine=frequency=440:duration=10 ' +
    '-c:a pcm_s16le ' +
    p('audio_raw.wav')
  );
});

await run('generate logo.png', () => {
  ffmpegExec(
    '-f lavfi -i color=red:size=100x50:rate=1 -frames:v 1 ' +
    p('logo.png')
  );
});

await run('generate animation.gif', () => {
  ffmpegExec(
    '-f lavfi -i testsrc=duration=2:size=160x90:rate=10 ' +
    p('animation.gif')
  );
});

await run('generate part1.mp4 / part2.mp4 / part3.mp4', () => {
  for (const n of ['part1', 'part2', 'part3']) {
    ffmpegExec(
      '-f lavfi -i testsrc=duration=2:size=320x180:rate=15 ' +
      '-f lavfi -i sine=frequency=440:duration=2 ' +
      '-c:v libx264 -preset ultrafast -c:a aac -movflags +faststart ' +
      p(`${n}.mp4`)
    );
  }
});

await run('generate subs.srt', () => {
  fs.writeFileSync(
    p('subs.srt'),
    '1\n00:00:00,500 --> 00:00:02,000\nHello world\n\n2\n00:00:03,000 --> 00:00:05,000\nTest subtitle\n'
  );
});

await run('generate video.mkv with subtitle stream', () => {
  ffmpegExec(
    `-f lavfi -i testsrc=duration=5:size=320x180:rate=15 ` +
    `-f lavfi -i sine=frequency=440:duration=5 ` +
    `-i ${p('subs.srt')} ` +
    `-c:v libx264 -preset ultrafast -c:a aac -c:s srt ` +
    p('with_subs.mkv')
  );
});

// ─── imports ───────────────────────────────────────────────────────────────
section('IMPORT — loading all exports');

let ffmpeg, FFmpegBuilder;
let screenshots, frameToBuffer;
let pipeThrough, streamOutput, streamToFile;
let mergeToFile, concatFiles;
let toGif, gifToMp4;
let normalizeAudio, adjustVolume;
let addWatermark, addTextWatermark;
let burnSubtitles, extractSubtitles;
let writeMetadata, stripMetadata;
let generateWaveform, generateSpectrum;
let getPreset, applyPreset, listPresets;
let hlsPackage, adaptiveHls, dashPackage;
let twoPassEncode, buildTwoPassArgs;
let mapStream, mapAVS, copyStream, setMetadata, ss;
let nvencToArgs, vaapiToArgs;
let scale, crop, overlay, drawtext, fade;
let volume, loudnorm, equalizer, atempo;
let FilterGraph, videoFilterChain, filterGraph;
let probe, probeAsync, ProbeError;
let getVideoStreams, getAudioStreams;
let getDefaultVideoStream, getDefaultAudioStream;
let getMediaDuration, durationToMicroseconds;
let summarizeVideoStream, summarizeAudioStream;
let parseFrameRate, parseDuration, parseBitrate;
let isHdr, isInterlaced, getChapterList;
let findStreamByLanguage, formatDuration;
let renice, autoKillOnExit, killAllFFmpeg;
let guardCodec, guardFeatureVersion, selectBestCodec;

await run('import mediaforge (all exports)', async () => {
  const mod = await import('./dist/esm/index.js');

  ffmpeg = mod.ffmpeg;
  FFmpegBuilder = mod.FFmpegBuilder;
  screenshots = mod.screenshots;
  frameToBuffer = mod.frameToBuffer;
  pipeThrough = mod.pipeThrough;
  streamOutput = mod.streamOutput;
  streamToFile = mod.streamToFile;
  mergeToFile = mod.mergeToFile;
  concatFiles = mod.concatFiles;
  toGif = mod.toGif;
  gifToMp4 = mod.gifToMp4;
  normalizeAudio = mod.normalizeAudio;
  adjustVolume = mod.adjustVolume;
  addWatermark = mod.addWatermark;
  addTextWatermark = mod.addTextWatermark;
  burnSubtitles = mod.burnSubtitles;
  extractSubtitles = mod.extractSubtitles;
  writeMetadata = mod.writeMetadata;
  stripMetadata = mod.stripMetadata;
  generateWaveform = mod.generateWaveform;
  generateSpectrum = mod.generateSpectrum;
  getPreset = mod.getPreset;
  applyPreset = mod.applyPreset;
  listPresets = mod.listPresets;
  hlsPackage = mod.hlsPackage;
  adaptiveHls = mod.adaptiveHls;
  dashPackage = mod.dashPackage;
  twoPassEncode = mod.twoPassEncode;
  buildTwoPassArgs = mod.buildTwoPassArgs;
  mapStream = mod.mapStream;
  mapAVS = mod.mapAVS;
  copyStream = mod.copyStream;
  setMetadata = mod.setMetadata;
  ss = mod.ss;
  nvencToArgs = mod.nvencToArgs;
  vaapiToArgs = mod.vaapiToArgs;
  scale = mod.scale;
  crop = mod.crop;
  overlay = mod.overlay;
  drawtext = mod.drawtext;
  fade = mod.fade;
  volume = mod.volume;
  loudnorm = mod.loudnorm;
  equalizer = mod.equalizer;
  atempo = mod.atempo;
  FilterGraph = mod.FilterGraph;
  videoFilterChain = mod.videoFilterChain;
  filterGraph = mod.filterGraph;
  probe = mod.probe;
  probeAsync = mod.probeAsync;
  ProbeError = mod.ProbeError;
  getVideoStreams = mod.getVideoStreams;
  getAudioStreams = mod.getAudioStreams;
  getDefaultVideoStream = mod.getDefaultVideoStream;
  getDefaultAudioStream = mod.getDefaultAudioStream;
  getMediaDuration = mod.getMediaDuration;
  durationToMicroseconds = mod.durationToMicroseconds;
  summarizeVideoStream = mod.summarizeVideoStream;
  summarizeAudioStream = mod.summarizeAudioStream;
  parseFrameRate = mod.parseFrameRate;
  parseDuration = mod.parseDuration;
  parseBitrate = mod.parseBitrate;
  isHdr = mod.isHdr;
  isInterlaced = mod.isInterlaced;
  getChapterList = mod.getChapterList;
  findStreamByLanguage = mod.findStreamByLanguage;
  formatDuration = mod.formatDuration;
  renice = mod.renice;
  autoKillOnExit = mod.autoKillOnExit;
  killAllFFmpeg = mod.killAllFFmpeg;
  guardCodec = mod.guardCodec;
  guardFeatureVersion = mod.guardFeatureVersion;
  selectBestCodec = mod.selectBestCodec;
});

// ─── 1. fluent builder — basic methods ─────────────────────────────────────
section('1 — FLUENT BUILDER: core methods');

await run('.videoCodec .videoBitrate .audioCodec .audioBitrate .run()', async () => {
  await ffmpeg(p('input.mp4'))
    .output(p('out_basic.mp4'))
    .videoCodec('libx264')
    .videoBitrate('500k')
    .audioCodec('aac')
    .audioBitrate('64k')
    .run();
  if (!fs.existsSync(p('out_basic.mp4'))) throw new Error('output not created');
});

await run('.crf .fps .size .pixelFormat', async () => {
  await ffmpeg(p('input.mp4'))
    .output(p('out_crf.mp4'))
    .videoCodec('libx264')
    .crf(28)
    .fps(15)
    .size('320x180')
    .pixelFormat('yuv420p')
    .run();
  if (!fs.existsSync(p('out_crf.mp4'))) throw new Error('output not created');
});

await run('.noVideo() — extract audio only', async () => {
  await ffmpeg(p('input.mp4'))
    .output(p('out_audio_only.mp3'))
    .noVideo()
    .audioCodec('libmp3lame')
    .audioBitrate('128k')
    .run();
  if (!fs.existsSync(p('out_audio_only.mp3'))) throw new Error('output not created');
});

await run('.noAudio() — video only', async () => {
  await ffmpeg(p('input.mp4'))
    .output(p('out_video_only.mp4'))
    .noAudio()
    .videoCodec('libx264')
    .run();
  if (!fs.existsSync(p('out_video_only.mp4'))) throw new Error('output not created');
});

await run('.audioSampleRate .audioChannels', async () => {
  await ffmpeg(p('input.mp4'))
    .output(p('out_audio_opts.mp4'))
    .videoCodec('copy')
    .audioCodec('aac')
    .audioSampleRate(44100)
    .audioChannels(1)
    .run();
  if (!fs.existsSync(p('out_audio_opts.mp4'))) throw new Error('output not created');
});

await run('.outputFormat', async () => {
  await ffmpeg(p('input.mp4'))
    .output(p('out_format.mkv'))
    .outputFormat('matroska')
    .videoCodec('copy')
    .audioCodec('copy')
    .run();
  if (!fs.existsSync(p('out_format.mkv'))) throw new Error('output not created');
});

await run('.seekInput .inputDuration', async () => {
  await ffmpeg(p('input.mp4'))
    .seekInput('00:00:02')
    .inputDuration('3')
    .output(p('out_seekin.mp4'))
    .videoCodec('libx264')
    .audioCodec('aac')
    .run();
  if (!fs.existsSync(p('out_seekin.mp4'))) throw new Error('output not created');
});

await run('.seekOutput .duration', async () => {
  await ffmpeg(p('input.mp4'))
    .output(p('out_seekout.mp4'))
    .seekOutput('00:00:01')
    .duration('3')
    .videoCodec('libx264')
    .audioCodec('aac')
    .run();
  if (!fs.existsSync(p('out_seekout.mp4'))) throw new Error('output not created');
});

await run('.inputFormat', async () => {
  await ffmpeg(p('input.mp4'))
    .inputFormat('mp4')
    .output(p('out_infmt.mp4'))
    .videoCodec('copy')
    .audioCodec('copy')
    .run();
  if (!fs.existsSync(p('out_infmt.mp4'))) throw new Error('output not created');
});

await run('.addOutputOption .addGlobalOption', async () => {
  await ffmpeg(p('input.mp4'))
    .output(p('out_opts.mp4'))
    .videoCodec('libx264')
    .addOutputOption('-preset', 'ultrafast')
    .addGlobalOption('-loglevel', 'error')
    .run();
  if (!fs.existsSync(p('out_opts.mp4'))) throw new Error('output not created');
});

await run('.overwrite(true) .logLevel', async () => {
  await ffmpeg(p('input.mp4'))
    .output(p('out_overwrite.mp4'))
    .videoCodec('copy')
    .audioCodec('copy')
    .overwrite(true)
    .logLevel('error')
    .run();
  if (!fs.existsSync(p('out_overwrite.mp4'))) throw new Error('output not created');
});

await run('.map stream spec', async () => {
  await ffmpeg(p('input.mp4'))
    .output(p('out_map.mp4'))
    .map('0:v:0')
    .map('0:a:0')
    .videoCodec('copy')
    .audioCodec('copy')
    .run();
  if (!fs.existsSync(p('out_map.mp4'))) throw new Error('output not created');
});

await run('.videoFilter scale', async () => {
  await ffmpeg(p('input.mp4'))
    .output(p('out_vfilter.mp4'))
    .videoFilter('scale=320:180')
    .videoCodec('libx264')
    .audioCodec('copy')
    .run();
  if (!fs.existsSync(p('out_vfilter.mp4'))) throw new Error('output not created');
});

await run('.audioFilter volume', async () => {
  await ffmpeg(p('input.mp4'))
    .output(p('out_afilter.mp4'))
    .audioFilter('volume=0.5')
    .videoCodec('copy')
    .audioCodec('aac')
    .run();
  if (!fs.existsSync(p('out_afilter.mp4'))) throw new Error('output not created');
});

await run('.complexFilter with map', async () => {
  await ffmpeg(p('input.mp4'))
    .complexFilter('[0:v]scale=320:180[v];[0:a]volume=0.5[a]')
    .output(p('out_complex.mp4'))
    .map('[v]')
    .map('[a]')
    .videoCodec('libx264')
    .audioCodec('aac')
    .run();
  if (!fs.existsSync(p('out_complex.mp4'))) throw new Error('output not created');
});

await run('.input() chained (multiple inputs)', async () => {
  await ffmpeg(p('input.mp4'))
    .input(p('audio.mp3'))
    .output(p('out_twoinputs.mp4'))
    .map('0:v:0')
    .map('1:a:0')
    .videoCodec('copy')
    .audioCodec('copy')
    .run();
  if (!fs.existsSync(p('out_twoinputs.mp4'))) throw new Error('output not created');
});

await run('multiple outputs in one pass', async () => {
  await ffmpeg(p('input.mp4'))
    .output(p('out_multi1.mp4'))
    .size('320x180')
    .videoCodec('libx264')
    .audioCodec('aac')
    .output(p('out_multi2.mp4'))
    .size('160x90')
    .videoCodec('libx264')
    .audioCodec('aac')
    .run();
  if (!fs.existsSync(p('out_multi1.mp4'))) throw new Error('out_multi1 not created');
  if (!fs.existsSync(p('out_multi2.mp4'))) throw new Error('out_multi2 not created');
});

await run('.spawn() returns FFmpegProcess with emitter', async () => {
  const proc = ffmpeg(p('input.mp4'))
    .output(p('out_spawn.mp4'))
    .videoCodec('copy')
    .audioCodec('copy')
    .spawn();
  if (!proc || !proc.emitter) throw new Error('spawn() did not return expected process object');
  await new Promise((res, rej) => {
    proc.emitter.on('end', res);
    proc.emitter.on('error', rej);
  });
  if (!fs.existsSync(p('out_spawn.mp4'))) throw new Error('output not created');
});

await run('.enableProgress() + .spawn({ parseProgress: true })', async () => {
  const progressEvents = [];
  const proc = ffmpeg(p('input.mp4'))
    .output(p('out_progress.mp4'))
    .videoCodec('libx264')
    .audioCodec('aac')
    .enableProgress()
    .spawn({ parseProgress: true });

  proc.emitter.on('progress', (info) => progressEvents.push(info));
  proc.emitter.on('start', (args) => {
    if (!Array.isArray(args)) throw new Error('start event args not array');
  });

  await new Promise((res, rej) => {
    proc.emitter.on('end', res);
    proc.emitter.on('error', rej);
  });
  if (!fs.existsSync(p('out_progress.mp4'))) throw new Error('output not created');
});

await run('.spawn() emitter: stderr event', async () => {
  const lines = [];
  const proc = ffmpeg(p('input.mp4'))
    .output(p('out_stderr.mp4'))
    .videoCodec('copy')
    .audioCodec('copy')
    .logLevel('verbose')
    .spawn();
  proc.emitter.on('stderr', (line) => lines.push(line));
  await new Promise((res, rej) => {
    proc.emitter.on('end', res);
    proc.emitter.on('error', rej);
  });
});

await run('.run() returns Promise<void>', async () => {
  const result = ffmpeg(p('input.mp4'))
    .output(p('out_runvoid.mp4'))
    .videoCodec('copy')
    .audioCodec('copy')
    .run();
  if (!(result instanceof Promise)) throw new Error('run() did not return Promise');
  await result;
});

// ─── 2. screenshots & frame extraction ─────────────────────────────────────
section('2 — SCREENSHOTS & FRAME EXTRACTION');

await run('screenshots({ count: 3 })', async () => {
  const folder = path.join(TMP, 'thumbs1');
  fs.mkdirSync(folder, { recursive: true });
  const { files } = await screenshots({ input: p('input.mp4'), folder, count: 3 });
  if (!Array.isArray(files) || files.length === 0) throw new Error('no files returned');
});

await run('screenshots({ timestamps, size })', async () => {
  const folder = path.join(TMP, 'thumbs2');
  fs.mkdirSync(folder, { recursive: true });
  const { files } = await screenshots({
    input: p('input.mp4'),
    folder,
    timestamps: [1, 3, 5],
    filename: 'thumb_%04d.jpg',
    size: '320x180',
  });
  if (!Array.isArray(files) || files.length === 0) throw new Error('no files returned');
});

await run('frameToBuffer({ timestamp, format, size })', async () => {
  const buf = await frameToBuffer({
    input: p('input.mp4'),
    timestamp: 2,
    format: 'png',
    size: '320x180',
  });
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new Error('empty buffer returned');
  fs.writeFileSync(p('frame.png'), buf);
});

await run('frameToBuffer({ format: jpeg })', async () => {
  const buf = await frameToBuffer({
    input: p('input.mp4'),
    timestamp: 1,
    format: 'mjpeg',
  });
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new Error('empty buffer returned');
});

// ─── 3. pipe & stream I/O ──────────────────────────────────────────────────
section('3 — PIPE & STREAM I/O');

await run('pipeThrough: readable -> ffmpeg -> writable', async () => {
  const proc = pipeThrough({
    inputFormat: 'mp4',
    outputArgs: ['-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac'],
    outputFormat: 'mp4',
  });
  fs.createReadStream(p('input.mp4')).pipe(proc.stdin);
  const out = fs.createWriteStream(p('out_pipe.mp4'));
  proc.stdout.pipe(out);
  await new Promise((res, rej) => {
    proc.emitter.on('end', res);
    proc.emitter.on('error', rej);
  });
  if (!fs.existsSync(p('out_pipe.mp4'))) throw new Error('output not created');
});

await run('streamOutput: returns readable stream', async () => {
  const stream = streamOutput({
    input: p('input.mp4'),
    outputFormat: 'mp4',
    outputArgs: ['-c', 'copy', '-movflags', 'frag_keyframe+empty_moov'],
  });
  const chunks = [];
  await new Promise((res, rej) => {
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', res);
    stream.on('error', rej);
  });
  if (chunks.length === 0) throw new Error('no data received from streamOutput');
});

await run('streamToFile: stream -> file', async () => {
  const readable = fs.createReadStream(p('input.mp4'));
  await streamToFile({
    stream: readable,
    inputFormat: 'mp4',
    output: p('out_streamtofile.mp4'),
    outputArgs: ['-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac'],
  });
  if (!fs.existsSync(p('out_streamtofile.mp4'))) throw new Error('output not created');
});

// ─── 4. concat & merge ─────────────────────────────────────────────────────
section('4 — CONCAT & MERGE');

await run('mergeToFile (stream copy)', async () => {
  await mergeToFile({
    inputs: [p('part1.mp4'), p('part2.mp4'), p('part3.mp4')],
    output: p('merged_copy.mp4'),
  });
  if (!fs.existsSync(p('merged_copy.mp4'))) throw new Error('output not created');
});

await run('mergeToFile (reencode)', async () => {
  await mergeToFile({
    inputs: [p('part1.mp4'), p('part2.mp4')],
    output: p('merged_reencode.mp4'),
    reencode: true,
    videoCodec: 'libx264',
    audioCodec: 'aac',
  });
  if (!fs.existsSync(p('merged_reencode.mp4'))) throw new Error('output not created');
});

await run('concatFiles (event-based)', async () => {
  const proc = concatFiles({
    inputs: [p('part1.mp4'), p('part2.mp4'), p('part3.mp4')],
    output: p('concat_out.mp4'),
  });
  const progressEvents = [];
  proc.emitter.on('progress', (e) => progressEvents.push(e));
  await new Promise((res, rej) => {
    proc.emitter.on('end', res);
    proc.emitter.on('error', rej);
  });
  if (!fs.existsSync(p('concat_out.mp4'))) throw new Error('output not created');
});

// ─── 5. animated GIF ───────────────────────────────────────────────────────
section('5 — ANIMATED GIF');

await run('toGif (2-pass palette)', async () => {
  await toGif({
    input: p('short.mp4'),
    output: p('out.gif'),
    width: 160,
    fps: 10,
    colors: 128,
    dither: 'bayer',
    startTime: 0,
    duration: 3,
  });
  if (!fs.existsSync(p('out.gif'))) throw new Error('output not created');
});

await run('gifToMp4', async () => {
  await gifToMp4({ input: p('animation.gif'), output: p('gif_to_mp4.mp4') });
  if (!fs.existsSync(p('gif_to_mp4.mp4'))) throw new Error('output not created');
});

// ─── 6. audio normalization ────────────────────────────────────────────────
section('6 — AUDIO NORMALIZATION');

await run('normalizeAudio (EBU R128 two-pass)', async () => {
  const result = await normalizeAudio({
    input: p('input.mp4'),
    output: p('normalized.mp4'),
    targetI: -23,
    targetLra: 7,
    targetTp: -2,
  });
  if (result == null) throw new Error('result was null/undefined');
  if (!fs.existsSync(p('normalized.mp4'))) throw new Error('output not created');
});

await run('normalizeAudio podcast preset (-16 LUFS)', async () => {
  await normalizeAudio({
    input: p('audio.mp3'),
    output: p('audio_norm.mp3'),
    targetI: -16,
  });
  if (!fs.existsSync(p('audio_norm.mp3'))) throw new Error('output not created');
});

await run('adjustVolume (0.5 — half)', async () => {
  await adjustVolume({ input: p('input.mp4'), output: p('vol_half.mp4'), volume: '0.5' });
  if (!fs.existsSync(p('vol_half.mp4'))) throw new Error('output not created');
});

await run('adjustVolume (6dB boost)', async () => {
  await adjustVolume({ input: p('input.mp4'), output: p('vol_6db.mp4'), volume: '6dB' });
  if (!fs.existsSync(p('vol_6db.mp4'))) throw new Error('output not created');
});

// ─── 7. watermarks ─────────────────────────────────────────────────────────
section('7 — WATERMARKS');

const positions = ['top-left', 'top-right', 'top-center', 'bottom-left', 'bottom-right', 'bottom-center', 'center'];

for (const pos of positions) {
  await run(`addWatermark position=${pos}`, async () => {
    await addWatermark({
      input: p('input.mp4'),
      watermark: p('logo.png'),
      output: p(`wm_${pos.replace(/-/g, '_')}.mp4`),
      position: pos,
      margin: 8,
      opacity: 0.8,
    });
    if (!fs.existsSync(p(`wm_${pos.replace(/-/g, '_')}.mp4`))) throw new Error('output not created');
  });
}

await run('addWatermark scaleWidth', async () => {
  await addWatermark({
    input: p('input.mp4'),
    watermark: p('logo.png'),
    output: p('wm_scaled.mp4'),
    position: 'bottom-right',
    scaleWidth: 50,
  });
  if (!fs.existsSync(p('wm_scaled.mp4'))) throw new Error('output not created');
});

await run('addTextWatermark', async () => {
  await addTextWatermark({
    input: p('input.mp4'),
    output: p('wm_text.mp4'),
    text: '© Test 2026',
    position: 'bottom-right',
    fontSize: 20,
    fontColor: 'white@0.8',
  });
  if (!fs.existsSync(p('wm_text.mp4'))) throw new Error('output not created');
});

// ─── 8. subtitles ──────────────────────────────────────────────────────────
section('8 — SUBTITLES');

await run('burnSubtitles', async () => {
  await burnSubtitles({
    input: p('short.mp4'),
    subtitleFile: p('subs.srt'),
    output: p('burned_subs.mp4'),
    fontSize: 18,
    fontName: 'Monospace',
  });
  if (!fs.existsSync(p('burned_subs.mp4'))) throw new Error('output not created');
});

await run('extractSubtitles', async () => {
  await extractSubtitles({
    input: p('with_subs.mkv'),
    output: p('extracted.srt'),
    streamIndex: 0,
  });
  if (!fs.existsSync(p('extracted.srt'))) throw new Error('output not created');
});

// ─── 9. metadata ───────────────────────────────────────────────────────────
section('9 — METADATA');

await run('writeMetadata (container + stream + chapters)', async () => {
  await writeMetadata({
    input: p('input.mp4'),
    output: p('tagged.mp4'),
    metadata: { title: 'Battle Test', artist: 'mediaforge', year: '2026', comment: 'test' },
    streamMetadata: {
      'a:0': { language: 'eng', title: 'English Audio' },
    },
    chapters: [
      { title: 'Introduction', startSec: 0, endSec: 5 },
      { title: 'Main', startSec: 5, endSec: 10 },
    ],
  });
  if (!fs.existsSync(p('tagged.mp4'))) throw new Error('output not created');
});

await run('stripMetadata', async () => {
  await stripMetadata({ input: p('tagged.mp4'), output: p('stripped.mp4') });
  if (!fs.existsSync(p('stripped.mp4'))) throw new Error('output not created');
});

// ─── 10. waveform & spectrum ───────────────────────────────────────────────
section('10 — WAVEFORM & SPECTRUM');

await run('generateWaveform (line mode, lin scale)', async () => {
  await generateWaveform({
    input: p('audio.mp3'),
    output: p('waveform.png'),
    width: 800,
    height: 120,
    color: '#00aaff',
    backgroundColor: '#1a1a2e',
    mode: 'line',
    scale: 'lin',
  });
  if (!fs.existsSync(p('waveform.png'))) throw new Error('output not created');
});

await run('generateWaveform (point mode)', async () => {
  await generateWaveform({
    input: p('audio.mp3'),
    output: p('waveform_point.png'),
    width: 400,
    height: 80,
    color: '#ff0000',
    mode: 'point',
    scale: 'log',
  });
  if (!fs.existsSync(p('waveform_point.png'))) throw new Error('output not created');
});

await run('generateSpectrum', async () => {
  await generateSpectrum({
    input: p('audio.mp3'),
    output: p('spectrum.mp4'),
    width: 640,
    height: 360,
    color: 'fire',
    fps: 10,
  });
  if (!fs.existsSync(p('spectrum.mp4'))) throw new Error('output not created');
});

// ─── 11. named presets ─────────────────────────────────────────────────────
section('11 — NAMED PRESETS');

await run('listPresets() returns array', () => {
  const list = listPresets();
  if (!Array.isArray(list) || list.length === 0) throw new Error('listPresets returned empty');
  console.log(`      presets: ${list.join(', ')}`);
});

const presetNames = ['web', 'web-hq', 'mobile', 'archive', 'podcast', 'hls-input', 'gif', 'discord', 'instagram', 'prores', 'dnxhd'];

for (const name of presetNames) {
  await run(`getPreset('${name}') shape`, () => {
    const p2 = getPreset(name);
    if (!p2 || !Array.isArray(p2.videoArgs) || !Array.isArray(p2.audioArgs)) {
      throw new Error(`getPreset('${name}') returned unexpected shape: ${JSON.stringify(p2)}`);
    }
  });

  await run(`applyPreset('${name}') returns flat array`, () => {
    const args = applyPreset(name);
    if (!Array.isArray(args)) throw new Error('applyPreset did not return array');
  });
}

await run('applyPreset web — encode with preset', async () => {
  const args = applyPreset('web');
  await ffmpeg(p('input.mp4'))
    .output(p('preset_web.mp4'))
    .addOutputOption(...args)
    .run();
  if (!fs.existsSync(p('preset_web.mp4'))) throw new Error('output not created');
});

await run('getPreset web — encode with videoArgs/audioArgs', async () => {
  const pr = getPreset('web');
  await ffmpeg(p('input.mp4'))
    .output(p('preset_web2.mp4'))
    .addOutputOption(...pr.videoArgs)
    .addOutputOption(...pr.audioArgs)
    .run();
  if (!fs.existsSync(p('preset_web2.mp4'))) throw new Error('output not created');
});

// ─── 12. HLS & DASH ────────────────────────────────────────────────────────
section('12 — HLS & DASH PACKAGING');

await run('hlsPackage single-bitrate', async () => {
  const outDir = path.join(TMP, 'hls_single');
  fs.mkdirSync(outDir, { recursive: true });
  await hlsPackage({
    input: p('short.mp4'),
    outputDir: outDir,
    segmentDuration: 2,
    hlsVersion: 3,
    videoCodec: 'libx264',
    videoBitrate: '500k',
    audioBitrate: '64k',
  }).run();
  const files = fs.readdirSync(outDir);
  if (!files.some((f) => f.endsWith('.m3u8'))) throw new Error('no .m3u8 playlist generated');
});

await run('adaptiveHls multi-bitrate', async () => {
  const outDir = path.join(TMP, 'hls_adaptive');
  fs.mkdirSync(outDir, { recursive: true });
  await adaptiveHls({
    input: p('short.mp4'),
    outputDir: outDir,
    variants: [
      { label: '360p', resolution: '640x360', videoBitrate: '500k', audioBitrate: '64k' },
      { label: '180p', resolution: '320x180', videoBitrate: '200k', audioBitrate: '48k' },
    ],
  }).run();
  const files = fs.readdirSync(outDir);
  if (!files.some((f) => f.endsWith('.m3u8'))) throw new Error('no .m3u8 playlist generated');
});

await run('dashPackage', async () => {
  const outDir = path.join(TMP, 'dash_out');
  fs.mkdirSync(outDir, { recursive: true });
  await dashPackage({
    input: p('short.mp4'),
    output: path.join(outDir, 'manifest.mpd'),
    segmentDuration: 2,
    videoCodec: 'libx264',
    videoBitrate: '500k',
  }).run();
  if (!fs.existsSync(path.join(outDir, 'manifest.mpd'))) throw new Error('manifest.mpd not created');
});

// ─── 13. two-pass encoding ─────────────────────────────────────────────────
section('13 — TWO-PASS ENCODING');

await run('twoPassEncode', async () => {
  let pass1Done = false;
  await twoPassEncode({
    input: p('short.mp4'),
    output: p('twopass.mp4'),
    videoCodec: 'libx264',
    videoBitrate: '500k',
    audioCodec: 'aac',
    audioBitrate: '64k',
    onPass1Complete: () => { pass1Done = true; },
  });
  if (!pass1Done) throw new Error('onPass1Complete was not called');
  if (!fs.existsSync(p('twopass.mp4'))) throw new Error('output not created');
});

await run('buildTwoPassArgs returns {pass1, pass2}', () => {
  const { pass1, pass2 } = buildTwoPassArgs({
    input: p('short.mp4'),
    output: p('twopass_inspect.mp4'),
    videoCodec: 'libx264',
    videoBitrate: '500k',
  });
  if (!Array.isArray(pass1) || !Array.isArray(pass2)) throw new Error('expected array args');
  if (!pass1.includes('-pass') && !pass1.join(' ').includes('pass')) {
    throw new Error('pass1 args do not contain pass flag');
  }
});

// ─── 14. stream mapping DSL ────────────────────────────────────────────────
section('14 — STREAM MAPPING DSL');

await run('mapStream returns string', () => {
  const result = mapStream(0, 'v', 0);
  if (typeof result !== 'string') throw new Error(`expected string, got ${typeof result}`);
});

await run('mapAVS(0) maps video+audio+subtitle', () => {
  const result = mapAVS(0);
  if (!result) throw new Error('mapAVS returned falsy');
});

await run('copyStream returns args', () => {
  const result = copyStream('v');
  if (!result) throw new Error('copyStream returned falsy');
});

await run('setMetadata returns args', () => {
  const result = setMetadata('title', 'test');
  if (!result) throw new Error('setMetadata returned falsy');
});

await run('ss() language-aware mapping', () => {
  const result = ss(0, 'a', 'eng');
  if (!result) throw new Error('ss() returned falsy');
});

// ─── 15. hardware acceleration ─────────────────────────────────────────────
section('15 — HARDWARE ACCELERATION (args inspection)');

await run('nvencToArgs returns flat array', () => {
  const args = nvencToArgs({ preset: 'p4', cq: 23 }, 'h264_nvenc');
  if (!Array.isArray(args)) throw new Error('expected array');
  console.log(`      nvenc args: ${args.join(' ')}`);
});

await run('vaapiToArgs returns flat array', () => {
  const args = vaapiToArgs({}, 'h264_vaapi');
  if (!Array.isArray(args)) throw new Error('expected array');
  console.log(`      vaapi args: ${args.join(' ')}`);
});

await run('FFmpegBuilder.selectHwaccel returns string or null', () => {
  const builder = new FFmpegBuilder(p('input.mp4'));
  const best = builder.selectHwaccel(['cuda', 'vaapi', 'videotoolbox', 'none']);
  if (best !== null && typeof best !== 'string') throw new Error(`unexpected return: ${best}`);
  console.log(`      best hwaccel: ${best ?? 'none (all unsupported)'}`);
});

// ─── 16. filter system ─────────────────────────────────────────────────────
section('16 — FILTER SYSTEM');

await run('scale() filter function', () => {
  const f = scale({ w: 640, h: 360 });
  if (typeof f !== 'string' && typeof f !== 'object') throw new Error('unexpected return');
});

await run('crop() filter function', () => {
  const f = crop({ w: 320, h: 180, x: 0, y: 0 });
  if (f == null) throw new Error('null return');
});

await run('overlay() filter function', () => {
  const f = overlay({ x: 10, y: 10 });
  if (f == null) throw new Error('null return');
});

await run('drawtext() filter function', () => {
  const f = drawtext({ text: 'hello', x: 10, y: 10, fontsize: 24 });
  if (f == null) throw new Error('null return');
});

await run('fade() filter function', () => {
  const f = fade({ type: 'in', start_time: 0, duration: 1 });
  if (f == null) throw new Error('null return');
});

await run('volume() audio filter', () => {
  const f = volume({ volume: '0.5' });
  if (f == null) throw new Error('null return');
});

await run('loudnorm() audio filter', () => {
  const f = loudnorm({ i: -16, lra: 11, tp: -1.5 });
  if (f == null) throw new Error('null return');
});

await run('equalizer() audio filter', () => {
  const f = equalizer({ frequency: 1000, width_type: 'o', width: 1, gain: 3 });
  if (f == null) throw new Error('null return');
});

await run('atempo() audio filter', () => {
  const f = atempo({ tempo: 1.5 });
  if (f == null) throw new Error('null return');
});

await run('filterGraph() factory', () => {
  const fg = filterGraph();
  if (fg == null) throw new Error('null return');
});

await run('videoFilterChain', () => {
  if (videoFilterChain == null) throw new Error('videoFilterChain not exported');
  const result = videoFilterChain('scale=640:360');
  if (result == null) throw new Error('null return');
});

await run('FilterGraph class', () => {
  if (FilterGraph == null) throw new Error('FilterGraph not exported');
  const fg = new FilterGraph();
  if (fg == null) throw new Error('null instance');
});

await run('scale filter applied via .videoFilter()', async () => {
  await ffmpeg(p('input.mp4'))
    .output(p('filter_scale.mp4'))
    .videoFilter(scale({ w: 320, h: 180 }))
    .videoCodec('libx264')
    .audioCodec('copy')
    .run();
  if (!fs.existsSync(p('filter_scale.mp4'))) throw new Error('output not created');
});

await run('loudnorm filter applied via .audioFilter()', async () => {
  await ffmpeg(p('input.mp4'))
    .output(p('filter_loudnorm.mp4'))
    .audioFilter(loudnorm({ i: -16, lra: 11, tp: -1.5 }))
    .videoCodec('copy')
    .audioCodec('aac')
    .run();
  if (!fs.existsSync(p('filter_loudnorm.mp4'))) throw new Error('output not created');
});

// ─── 17. ffprobe integration ───────────────────────────────────────────────
section('17 — FFPROBE INTEGRATION');

await run('probe() synchronous', () => {
  const info = probe(p('input.mp4'));
  if (!info || !info.streams) throw new Error('probe() returned no streams');
  if (!info.format) throw new Error('probe() returned no format');
  console.log(`      duration: ${info.format.duration}s`);
});

await run('probeAsync() async', async () => {
  const info = await probeAsync(p('input.mp4'));
  if (!info || !info.streams) throw new Error('probeAsync() returned no streams');
});

await run('ProbeError is exported class/function', () => {
  if (!ProbeError) throw new Error('ProbeError not exported');
});

await run('getVideoStreams', () => {
  const info = probe(p('input.mp4'));
  const streams = getVideoStreams(info);
  if (!Array.isArray(streams) || streams.length === 0) throw new Error('no video streams');
});

await run('getAudioStreams', () => {
  const info = probe(p('input.mp4'));
  const streams = getAudioStreams(info);
  if (!Array.isArray(streams) || streams.length === 0) throw new Error('no audio streams');
});

await run('getDefaultVideoStream', () => {
  const info = probe(p('input.mp4'));
  const stream = getDefaultVideoStream(info);
  if (!stream) throw new Error('no default video stream');
  if (stream.codec_type !== 'video') throw new Error(`wrong codec_type: ${stream.codec_type}`);
});

await run('getDefaultAudioStream', () => {
  const info = probe(p('input.mp4'));
  const stream = getDefaultAudioStream(info);
  if (!stream) throw new Error('no default audio stream');
  if (stream.codec_type !== 'audio') throw new Error(`wrong codec_type: ${stream.codec_type}`);
});

await run('getMediaDuration', () => {
  const info = probe(p('input.mp4'));
  const dur = getMediaDuration(info);
  if (typeof dur !== 'number' || dur <= 0) throw new Error(`unexpected duration: ${dur}`);
  console.log(`      duration: ${dur}s`);
});

await run('durationToMicroseconds', () => {
  const info = probe(p('input.mp4'));
  const dur = getMediaDuration(info);
  const us = durationToMicroseconds(dur);
  if (typeof us !== 'number' || us <= 0) throw new Error(`unexpected microseconds: ${us}`);
});

await run('summarizeVideoStream', () => {
  const info = probe(p('input.mp4'));
  const stream = getDefaultVideoStream(info);
  const summary = summarizeVideoStream(stream);
  if (!summary || typeof summary !== 'object') throw new Error('unexpected summary shape');
  console.log(`      video summary: ${JSON.stringify(summary)}`);
});

await run('summarizeAudioStream', () => {
  const info = probe(p('input.mp4'));
  const stream = getDefaultAudioStream(info);
  const summary = summarizeAudioStream(stream);
  if (!summary || typeof summary !== 'object') throw new Error('unexpected summary shape');
  console.log(`      audio summary: ${JSON.stringify(summary)}`);
});

await run('parseFrameRate', () => {
  const info = probe(p('input.mp4'));
  const stream = getDefaultVideoStream(info);
  const fps = parseFrameRate(stream.r_frame_rate ?? stream.avg_frame_rate ?? '30/1');
  if (!fps || typeof fps.value !== 'number' || fps.value <= 0) throw new Error(`unexpected fps: ${JSON.stringify(fps)}`);
});

await run('parseDuration', () => {
  const d = parseDuration('00:01:30');
  if (typeof d !== 'number') throw new Error(`unexpected return: ${d}`);
});

await run('parseBitrate', () => {
  const b = parseBitrate('2M');
  if (typeof b !== 'number') throw new Error(`unexpected return: ${b}`);
  const b2 = parseBitrate('128k');
  if (typeof b2 !== 'number') throw new Error(`unexpected return: ${b2}`);
});

await run('isHdr', () => {
  const info = probe(p('input.mp4'));
  const result = isHdr(info);
  if (typeof result !== 'boolean') throw new Error(`expected boolean, got ${typeof result}`);
  console.log(`      isHdr: ${result}`);
});

await run('isInterlaced', () => {
  const info = probe(p('input.mp4'));
  const result = isInterlaced(info);
  if (typeof result !== 'boolean') throw new Error(`expected boolean, got ${typeof result}`);
  console.log(`      isInterlaced: ${result}`);
});

await run('getChapterList', () => {
  const info = probe(p('tagged.mp4'));
  const chapters = getChapterList(info);
  if (!Array.isArray(chapters)) throw new Error('expected array');
  console.log(`      chapters: ${chapters.length}`);
});

await run('findStreamByLanguage', () => {
  const info = probe(p('input.mp4'));
  const stream = findStreamByLanguage(info, 'eng', 'audio');
  console.log(`      stream by lang: ${stream ? stream.codec_name : 'not found (ok)'}`);
});

await run('formatDuration', () => {
  const s = formatDuration(90.5);
  if (typeof s !== 'string') throw new Error(`expected string, got ${typeof s}`);
  console.log(`      formatDuration(90.5): ${s}`);
});

// ─── 18. process management ────────────────────────────────────────────────
section('18 — PROCESS MANAGEMENT');

await run('renice (lower priority)', async () => {
  const proc = ffmpeg(p('input.mp4'))
    .output(p('out_renice.mp4'))
    .videoCodec('copy')
    .audioCodec('copy')
    .spawn();
  try {
    renice(proc.child, 10);
  } catch (e) {
    if (!e.message.includes('not supported') && !e.message.includes('permission')) throw e;
    console.log(`      renice skipped: ${e.message}`);
  }
  await new Promise((res, rej) => {
    proc.emitter.on('end', res);
    proc.emitter.on('error', rej);
  });
});

await run('autoKillOnExit registers and returns unregister fn', async () => {
  const proc = ffmpeg(p('input.mp4'))
    .output(p('out_autokill.mp4'))
    .videoCodec('copy')
    .audioCodec('copy')
    .spawn();
  const unregister = autoKillOnExit(proc.child);
  if (typeof unregister !== 'function') throw new Error('expected unregister function');
  await new Promise((res, rej) => {
    proc.emitter.on('end', res);
    proc.emitter.on('error', rej);
  });
  unregister();
});

await run('killAllFFmpeg is callable', () => {
  if (typeof killAllFFmpeg !== 'function') throw new Error('killAllFFmpeg not a function');
});

// ─── 19. compatibility guards ──────────────────────────────────────────────
section('19 — COMPATIBILITY GUARDS');

await run('FFmpegBuilder.checkCodec(libx264, encode)', async () => {
  const builder = new FFmpegBuilder(p('input.mp4'));
  const result = await builder.checkCodec('libx264', 'encode');
  if (typeof result !== 'object' || !('available' in result)) {
    throw new Error(`unexpected result: ${JSON.stringify(result)}`);
  }
  console.log(`      libx264 encode available: ${result.available}`);
});

await run('FFmpegBuilder.checkCodec(nonexistent_codec, encode)', async () => {
  const builder = new FFmpegBuilder(p('input.mp4'));
  const result = await builder.checkCodec('nonexistent_codec_xyz', 'encode');
  if (result.available !== false) throw new Error('expected available=false for fake codec');
});

await run('FFmpegBuilder.selectVideoCodec — falls back to libx264', async () => {
  const builder = new FFmpegBuilder(p('input.mp4'));
  const codec = await builder.selectVideoCodec([
    { codec: 'h264_nvenc', featureKey: 'nvenc' },
    { codec: 'h264_vaapi' },
    { codec: 'libx264' },
  ]);
  if (typeof codec !== 'string') throw new Error(`expected string codec, got ${typeof codec}`);
  console.log(`      selected codec: ${codec}`);
});

await run('guardCodec is exported', () => {
  if (typeof guardCodec !== 'function') throw new Error('guardCodec not a function');
});

await run('guardFeatureVersion is exported', () => {
  if (typeof guardFeatureVersion !== 'function') throw new Error('guardFeatureVersion not a function');
});

await run('selectBestCodec is exported', () => {
  if (typeof selectBestCodec !== 'function' && selectBestCodec == null) {
    throw new Error('selectBestCodec not exported');
  }
});

// ─── 20. CJS require compatibility ────────────────────────────────────────
section('20 — CJS REQUIRE (via createRequire)');

await run('require("mediaforge") returns ffmpeg function', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  try {
    const cjs = require('./dist/cjs/index.js');
    if (typeof cjs.ffmpeg !== 'function') throw new Error('ffmpeg not a function in CJS');
  } catch (e) {
    if (e.code === 'ERR_REQUIRE_ESM') {
      console.log('      CJS require not available (ESM-only build) — ok');
    } else {
      throw e;
    }
  }
});

// ─── 21. FFmpegBuilder class direct usage ─────────────────────────────────
section('21 — FFmpegBuilder class direct instantiation');

await run('new FFmpegBuilder(input) + .run()', async () => {
  const builder = new FFmpegBuilder(p('input.mp4'));
  builder.output(p('out_builder_direct.mp4'));
  builder.videoCodec('libx264');
  builder.audioCodec('aac');
  await builder.run();
  if (!fs.existsSync(p('out_builder_direct.mp4'))) throw new Error('output not created');
});

await run('new FFmpegBuilder() (no input) + .input(path)', async () => {
  const builder = new FFmpegBuilder();
  builder.input(p('input.mp4'));
  builder.output(p('out_builder_noinput.mp4'));
  builder.videoCodec('copy').audioCodec('copy');
  await builder.run();
  if (!fs.existsSync(p('out_builder_noinput.mp4'))) throw new Error('output not created');
});

// ─── 22. New Video Codec Serializers ──────────────────────────────────────
section('22 — NEW VIDEO CODEC SERIALIZERS');

let proResToArgs, dnxhdToArgs, mjpegToArgs, mpeg2ToArgs, mpeg4ToArgs, vp8ToArgs, theoraToArgs, ffv1ToArgs;

await run('import new video codec helpers', async () => {
  const mod = await import('./dist/esm/index.js');
  proResToArgs = mod.proResToArgs;
  dnxhdToArgs = mod.dnxhdToArgs;
  mjpegToArgs = mod.mjpegToArgs;
  mpeg2ToArgs = mod.mpeg2ToArgs;
  mpeg4ToArgs = mod.mpeg4ToArgs;
  vp8ToArgs = mod.vp8ToArgs;
  theoraToArgs = mod.theoraToArgs;
  ffv1ToArgs = mod.ffv1ToArgs;
  if (!proResToArgs || !dnxhdToArgs || !mjpegToArgs) throw new Error('new video helpers not exported');
});

await run('proResToArgs defaults to prores_ks', () => {
  const args = proResToArgs();
  if (!args.includes('prores_ks')) throw new Error(`expected prores_ks, got: ${args.join(' ')}`);
});
await run('proResToArgs profile=3 (HQ)', () => {
  const args = proResToArgs({ profile: 3 });
  const idx = args.indexOf('-profile:v');
  if (idx < 0 || args[idx+1] !== '3') throw new Error('profile:v 3 not set');
});
await run('proResToArgs encoder=prores_aw', () => {
  if (!proResToArgs({}, 'prores_aw').includes('prores_aw')) throw new Error('encoder override failed');
});
await run('dnxhdToArgs emits dnxhd', () => {
  if (!dnxhdToArgs().includes('dnxhd')) throw new Error('dnxhd codec not found');
});
await run('dnxhdToArgs sets bitrate + pixFmt', () => {
  const args = dnxhdToArgs({ bitrate: 145, pixFmt: 'yuv422p10le' });
  if (!args.includes('145k') || !args.includes('yuv422p10le')) throw new Error(`bad args: ${args}`);
});
await run('mjpegToArgs emits mjpeg + qscale', () => {
  const args = mjpegToArgs({ qscale: 3 });
  if (!args.includes('mjpeg') || !args.includes('3')) throw new Error(`bad args: ${args}`);
});
await run('mpeg2ToArgs emits mpeg2video + interlaced', () => {
  const args = mpeg2ToArgs({ bitrate: 8000, interlaced: true });
  if (!args.includes('mpeg2video') || !args.includes('+ildct+ilme')) throw new Error(`bad args: ${args}`);
});
await run('mpeg4ToArgs default + libxvid override', () => {
  if (!mpeg4ToArgs().includes('mpeg4')) throw new Error('mpeg4 not found');
  if (!mpeg4ToArgs({}, 'libxvid').includes('libxvid')) throw new Error('libxvid not found');
});
await run('vp8ToArgs emits libvpx + bitrate', () => {
  const args = vp8ToArgs({ bitrate: 800, cpuUsed: 4 });
  if (!args.includes('libvpx') || !args.includes('800k')) throw new Error(`bad args: ${args}`);
});
await run('theoraToArgs emits libtheora + quality', () => {
  const args = theoraToArgs({ qscale: 7 });
  if (!args.includes('libtheora') || !args.includes('7')) throw new Error(`bad args: ${args}`);
});
await run('ffv1ToArgs emits ffv1 + sliceCrc', () => {
  const args = ffv1ToArgs({ version: 3, sliceCrc: true, slices: 16 });
  if (!args.includes('ffv1') || !args.includes('1')) throw new Error(`bad args: ${args}`);
});

// ─── 23. New Audio Codec Serializers ──────────────────────────────────────
section('23 — NEW AUDIO CODEC SERIALIZERS');

let alacToArgs, eac3ToArgs, truehdToArgs, vorbisToArgs, wavpackToArgs, pcmToArgs, mp2ToArgs;

await run('import new audio codec helpers', async () => {
  const mod = await import('./dist/esm/index.js');
  alacToArgs = mod.alacToArgs;
  eac3ToArgs = mod.eac3ToArgs;
  truehdToArgs = mod.truehdToArgs;
  vorbisToArgs = mod.vorbisToArgs;
  wavpackToArgs = mod.wavpackToArgs;
  pcmToArgs = mod.pcmToArgs;
  mp2ToArgs = mod.mp2ToArgs;
  if (!alacToArgs || !eac3ToArgs || !pcmToArgs) throw new Error('new audio helpers not exported');
});

await run('alacToArgs emits alac', () => {
  if (!alacToArgs().includes('alac')) throw new Error('alac not found');
});
await run('eac3ToArgs emits eac3 + bitrate + dialnorm', () => {
  const args = eac3ToArgs({ bitrate: 640, dialNorm: -24 });
  if (!args.includes('eac3') || !args.includes('640k') || !args.includes('-24')) throw new Error(`bad args: ${args}`);
});
await run('truehdToArgs emits truehd', () => {
  if (!truehdToArgs().includes('truehd')) throw new Error('truehd not found');
});
await run('vorbisToArgs emits libvorbis + quality', () => {
  const args = vorbisToArgs({ qscale: 5 });
  if (!args.includes('libvorbis') || !args.includes('5')) throw new Error(`bad args: ${args}`);
});
await run('wavpackToArgs emits wavpack', () => {
  if (!wavpackToArgs().includes('wavpack')) throw new Error('wavpack not found');
});
await run('pcmToArgs pcm_s16le + sampleRate', () => {
  const args = pcmToArgs('pcm_s16le', { sampleRate: 48000, channels: 2 });
  if (!args.includes('pcm_s16le') || !args.includes('48000') || !args.includes('2')) throw new Error(`bad args: ${args}`);
});
await run('pcmToArgs pcm_s24le', () => { if (!pcmToArgs('pcm_s24le').includes('pcm_s24le')) throw new Error(); });
await run('pcmToArgs pcm_f32le', () => { if (!pcmToArgs('pcm_f32le').includes('pcm_f32le')) throw new Error(); });
await run('mp2ToArgs emits mp2 + bitrate', () => {
  const args = mp2ToArgs({ bitrate: 192, sampleRate: 48000 });
  if (!args.includes('mp2') || !args.includes('192k') || !args.includes('48000')) throw new Error(`bad args: ${args}`);
});

// ─── 24. New Hardware Codec Helpers ───────────────────────────────────────
section('24 — NEW HARDWARE CODEC HELPERS (args inspection)');

let mediacodecVideoToArgs, vulkanVideoToArgs;

await run('import new hardware codec helpers', async () => {
  const mod = await import('./dist/esm/index.js');
  mediacodecVideoToArgs = mod.mediacodecVideoToArgs;
  vulkanVideoToArgs = mod.vulkanVideoToArgs;
  if (!mediacodecVideoToArgs || !vulkanVideoToArgs) throw new Error('new hw helpers not exported');
});

await run('mediacodecVideoToArgs defaults to h264_mediacodec', () => {
  const args = mediacodecVideoToArgs({});
  if (!args.includes('h264_mediacodec')) throw new Error(`got: ${args}`);
});
await run('mediacodecVideoToArgs hevc + bitrate', () => {
  const args = mediacodecVideoToArgs({ bitrate: 4000 }, 'hevc_mediacodec');
  if (!args.includes('hevc_mediacodec') || !args.includes('4000k')) throw new Error(`got: ${args}`);
});
await run('mediacodecVideoToArgs av1_mediacodec', () => {
  if (!mediacodecVideoToArgs({}, 'av1_mediacodec').includes('av1_mediacodec')) throw new Error();
});
await run('vulkanVideoToArgs defaults to h264_vulkan', () => {
  if (!vulkanVideoToArgs({}).includes('h264_vulkan')) throw new Error();
});
await run('vulkanVideoToArgs hevc_vulkan + crf', () => {
  const args = vulkanVideoToArgs({ crf: 22 }, 'hevc_vulkan');
  if (!args.includes('hevc_vulkan') || !args.includes('22')) throw new Error(`got: ${args}`);
});

// ─── final summary ─────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log('  BATTLE TEST SUMMARY');
console.log('═'.repeat(60));
console.log(`  ✅ PASSED : ${passed}`);
console.log(`  ⏭  SKIPPED: ${skipped}`);
console.log(`  ❌ FAILED : ${errors.length}`);

if (errors.length > 0) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  FAILED TESTS — FULL ERROR LOG');
  console.log('─'.repeat(60));
  for (let i = 0; i < errors.length; i++) {
    console.log(`\n  [${i + 1}] ${errors[i].label}`);
    console.log(`       ERROR : ${errors[i].error}`);
    if (errors[i].stack) {
      const stackLines = errors[i].stack.split('\n').slice(1, 4).join('\n       ');
      console.log(`       STACK : ${stackLines}`);
    }
  }
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${errors.length} test(s) failed. See above for details.`);
  console.log('─'.repeat(60));
  process.exit(1);
} else {
  console.log('\n  All tests passed! 🎉');
}
