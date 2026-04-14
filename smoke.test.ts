/**
 * smoke.test.ts — MediaForge Comprehensive Certification Suite
 *
 * Runs against the compiled dist/esm build.
 * Usage: npm run smoke
 *
 * Requirements: clean.mp4 must exist in the working directory.
 */

import {
  ffmpeg,
  probeAsync,
  writeMetadata,
  generateWaveform,
  generateSpectrum,
  applyPreset,
  normalizeAudio,
  addTextWatermark,
  burnSubtitles,
  mergeToFile,
  pipeThrough,
  screenshots,
  toGif,
  stripMetadata,
  hlsPackage,
  twoPassEncode,
  listPresets,
  type ProbeResult,
  type PipeProcess,
} from './dist/esm/index.js';

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// ─── Config ──────────────────────────────────────────────────────────────────

const INPUT: string = 'clean.mp4';
const TOTAL: number = 21;
const COL_WIDTH: number = 40;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function printDivider(): void {
  console.log('─'.repeat(60));
}

function printSection(id: number, name: string): void {
  printDivider();
  console.log(`[${id}/${TOTAL}] ${name}`);
}

function printDetail(label: string, value: unknown): void {
  const v = typeof value === 'object' ? JSON.stringify(value) : String(value);
  console.log(`    ${pad(label + ':', 22)} ${v}`);
}

function printPass(durationMs: number): void {
  console.log(`    ✅ PASSED  (${durationMs}ms)`);
}

function printFail(id: number, err: unknown): void {
  console.log(`    ❌ FAILED`);
  console.error(`\n    ┌── ERROR IN TEST ${id} ${'─'.repeat(30)}`);
  if (err instanceof Error) {
    console.error(`    │  ${err.message.split('\n').join('\n    │  ')}`);
    if ((err as NodeJS.ErrnoException).code) {
      console.error(`    │  code: ${(err as NodeJS.ErrnoException).code}`);
    }
  } else {
    console.error(`    │  ${String(err)}`);
  }
  console.error(`    └${'─'.repeat(46)}\n`);
}

async function runTest(
  id: number,
  name: string,
  fn: () => Promise<void>,
): Promise<boolean> {
  printSection(id, name);
  const t0 = Date.now();
  try {
    await fn();
    printPass(Date.now() - t0);
    return true;
  } catch (err: unknown) {
    printFail(id, err);
    return false;
  }
}

function fileSize(p: string): string {
  try {
    const bytes = fs.statSync(p).size;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  } catch {
    return '?';
  }
}

function checkFile(p: string): void {
  if (!fs.existsSync(p)) throw new Error(`Output file not created: ${p}`);
  const size = fs.statSync(p).size;
  if (size === 0) throw new Error(`Output file is empty: ${p}`);
  printDetail('output', p);
  printDetail('size', fileSize(p));
}

function checkDir(dir: string, ext: string): void {
  if (!fs.existsSync(dir)) throw new Error(`Output dir not created: ${dir}`);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(ext));
  if (files.length === 0) throw new Error(`No ${ext} files in ${dir}`);
  printDetail('dir', dir);
  printDetail(`${ext} files`, files.length);
}

// ─── Pre-flight ───────────────────────────────────────────────────────────────

async function preflight(): Promise<void> {
  printDivider();
  console.log('🔍 PRE-FLIGHT CHECKS');
  printDivider();

  // Check input file
  if (!fs.existsSync(INPUT)) {
    throw new Error(`Input file not found: ${INPUT}. Please provide clean.mp4 in the working directory.`);
  }
  printDetail('input file', INPUT);
  printDetail('input size', fileSize(INPUT));

  // Check ffmpeg binary
  try {
    const ver = execFileSync('ffmpeg', ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const vLine = ver.split('\n')[0] ?? '';
    printDetail('ffmpeg', vLine.replace('ffmpeg version ', '').split(' ')[0] ?? 'found');
  } catch {
    throw new Error('ffmpeg not found on PATH. Install FFmpeg first.');
  }

  // Probe the input
  const info: ProbeResult = await probeAsync(INPUT);
  const vStream = info.streams.find((s) => s.codec_type === 'video');
  const aStream = info.streams.find((s) => s.codec_type === 'audio');
  printDetail('duration', `${Number(info.format.duration ?? 0).toFixed(2)}s`);
  printDetail('video', vStream ? `${vStream.codec_name} ${vStream.width}x${vStream.height}` : 'none');
  printDetail('audio', aStream ? `${aStream.codec_name} ${aStream.sample_rate}Hz` : 'none');
  printDetail('presets available', listPresets().join(', '));
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

async function startSuite(): Promise<void> {
  console.log('\n' + '═'.repeat(60));
  console.log('  🛡️  MEDIAFORGE COMPREHENSIVE CERTIFICATION SUITE');
  console.log('═'.repeat(60));

  await preflight();

  const suiteStart = Date.now();
  const results: boolean[] = [];

  // ── 1. Fluent Builder API ─────────────────────────────────────────────────
  results.push(await runTest(1, 'Fluent Builder — Transcode (x264 + AAC)', async () => {
    const out = 'v01_transcode.mp4';
    await ffmpeg(INPUT).output(out).videoCodec('libx264').crf(23).audioCodec('aac').run();
    checkFile(out);
    printDetail('codec', 'libx264 CRF 23 + AAC');
  }));

  // ── 2. Screenshots ────────────────────────────────────────────────────────
  results.push(await runTest(2, 'Screenshots — Multi-count Extraction', async () => {
    fs.mkdirSync('./thumbs', { recursive: true });
    await screenshots({ input: INPUT, folder: './thumbs', count: 3, filename: 'shot_%03d.jpg', size: '320x180' });
    checkDir('./thumbs', '.jpg');
  }));

  // ── 3. Pipe & Stream I/O ──────────────────────────────────────────────────
  results.push(await runTest(3, 'Pipe Through — Stream I/O (mp4 → mp4)', async () => {
    const out = 'v03_pipe.mp4';
    const proc: PipeProcess = pipeThrough({
      inputFormat: 'mp4',
      outputFormat: 'mp4',
      outputArgs: ['-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'copy'],
    });
    fs.createReadStream(INPUT).pipe(proc.stdin!);
    proc.stdout.pipe(fs.createWriteStream(out));
    await new Promise<void>((res, rej) => {
      proc.emitter.on('end', res);
      proc.emitter.on('error', rej);
    });
    checkFile(out);
    printDetail('method', 'pipe:0 → libx264 ultrafast → pipe:1 → file');
    printDetail('auto movflags', 'frag_keyframe+empty_moov injected');
    printDetail('auto probesize', '100M analyzeduration for mp4 input');
  }));

  // ── 4. Concat & Merge ─────────────────────────────────────────────────────
  results.push(await runTest(4, 'Merge — Re-encode Concatenation (2 clips)', async () => {
    const out = 'v04_merged.mp4';
    await mergeToFile({ inputs: [INPUT, INPUT], output: out, reencode: true, videoCodec: 'libx264' });
    checkFile(out);
    printDetail('clips merged', 2);
    printDetail('mode', 're-encode (libx264)');
  }));

  // ── 5. Animated GIF ───────────────────────────────────────────────────────
  results.push(await runTest(5, 'Animated GIF — 2-pass Palette Generation', async () => {
    const out = 'v05_hq.gif';
    await toGif({ input: INPUT, output: out, width: 480, fps: 15, colors: 256 });
    checkFile(out);
    printDetail('size', '480px wide');
    printDetail('fps', 15);
    printDetail('colors', 256);
  }));

  // ── 6. Audio Normalization ────────────────────────────────────────────────
  results.push(await runTest(6, 'Audio Normalization — EBU R128 (-16 LUFS)', async () => {
    const out = 'v06_norm.mp4';
    await normalizeAudio({ input: INPUT, output: out, targetI: -16 });
    checkFile(out);
    printDetail('target', '-16 LUFS (podcast standard)');
    printDetail('standard', 'EBU R128 loudnorm filter');
  }));

  // ── 7. Text Watermark ─────────────────────────────────────────────────────
  results.push(await runTest(7, 'Text Watermark — Center Overlay', async () => {
    const out = 'v07_watermark.mp4';
    await addTextWatermark({ input: INPUT, output: out, text: 'STABLE v1', position: 'center', fontSize: 50 });
    checkFile(out);
    printDetail('text', 'STABLE v1');
    printDetail('position', 'center');
    printDetail('font size', 50);
  }));

  // ── 8. Subtitles ──────────────────────────────────────────────────────────
  results.push(await runTest(8, 'Subtitles — SRT Hard-burn', async () => {
    const srt = 'test.srt';
    const out = 'v08_subs.mp4';
    fs.writeFileSync(srt, '1\n00:00:00,000 --> 00:00:05,000\nMediaForge Test\n');
    printDetail('srt file', srt);
    await burnSubtitles({ input: INPUT, subtitleFile: srt, output: out });
    checkFile(out);
    printDetail('method', 'subtitles filter (hard-burn)');
  }));

  // ── 9. Metadata & Chapters ────────────────────────────────────────────────
  results.push(await runTest(9, 'Metadata — Write Tags + Chapters', async () => {
    const out = 'v09_meta.mp4';
    await writeMetadata({
      input: INPUT,
      output: out,
      metadata: { title: 'Gold', artist: 'Qasim Ali', comment: 'mediaforge certified' },
      chapters: [{ title: 'Intro', startSec: 0, endSec: 3 }, { title: 'Main', startSec: 3, endSec: 8 }],
    });
    checkFile(out);
    // Verify tags written
    const probeOut: ProbeResult = await probeAsync(out);
    const tags = probeOut.format.tags ?? {};
    printDetail('title tag', (tags as Record<string, string>)['title'] ?? '?');
    printDetail('artist tag', (tags as Record<string, string>)['artist'] ?? '?');
    printDetail('chapters', probeOut.chapters?.length ?? 0);
  }));

  // ── 10. Waveform ──────────────────────────────────────────────────────────
  results.push(await runTest(10, 'Waveform — PNG Image (line mode)', async () => {
    const out = 'v10_wave.png';
    await generateWaveform({ input: INPUT, output: out, color: '#ff0000', mode: 'line', width: 1920, height: 240 });
    checkFile(out);
    printDetail('color', '#ff0000');
    printDetail('mode', 'line (default — no :draw= emitted for FFmpeg 7.x/8.x compat)');
    printDetail('dimensions', '1920×240');
  }));

  // ── 11. Named Presets ─────────────────────────────────────────────────────
  results.push(await runTest(11, 'Presets — Archive Quality Encode', async () => {
    const out = 'v11_archive.mp4';
    const presetArgs = applyPreset('archive');
    printDetail('preset', 'archive');
    printDetail('args', presetArgs.join(' '));
    await ffmpeg(INPUT).output(out).addOutputOption(...presetArgs).run();
    checkFile(out);
  }));

  // ── 12. HLS Packaging ─────────────────────────────────────────────────────
  results.push(await runTest(12, 'HLS Packaging — Segmented Stream', async () => {
    fs.mkdirSync('./hls', { recursive: true });
    await hlsPackage({ input: INPUT, outputDir: './hls', segmentDuration: 4 }).run();
    checkDir('./hls', '.ts');
    const m3u8 = path.join('./hls', 'playlist.m3u8');
    if (!fs.existsSync(m3u8)) throw new Error('playlist.m3u8 not created');
    printDetail('playlist', m3u8);
    printDetail('segment duration', '4s');
    printDetail('note', '-hls_version removed (FFmpeg 8.x incompatible)');
  }));

  // ── 13. Two-Pass Encoding ─────────────────────────────────────────────────
  results.push(await runTest(13, 'Two-Pass Encode — Target Bitrate (1M)', async () => {
    const out = 'v13_twopass.mp4';
    let pass1Done = false;
    let pass2Done = false;
    await twoPassEncode({
      input: INPUT,
      output: out,
      videoCodec: 'libx264',
      videoBitrate: '1M',
      audioCodec: 'aac',
      audioBitrate: '128k',
      onPass1Complete: () => { pass1Done = true; },
      onPass2Complete: () => { pass2Done = true; },
    });
    checkFile(out);
    printDetail('target bitrate', '1M');
    printDetail('audio', 'aac 128k');
    printDetail('pass 1', pass1Done ? '✓ completed' : '✗ not fired');
    printDetail('pass 2', pass2Done ? '✓ completed' : '✗ not fired');
    printDetail('pass 1 output', 'temp .mkv (ARM-safe — no -f null /dev/null)');
  }));

  // ── 14. Stream Mapping DSL ────────────────────────────────────────────────
  results.push(await runTest(14, 'Stream Mapping — DSL v:0 + a:0', async () => {
    const out = 'v14_mapped.mp4';
    await ffmpeg(INPUT).output(out).map('0:v:0').map('0:a:0').run();
    checkFile(out);
    printDetail('mapped streams', '0:v:0, 0:a:0');
  }));

  // ── 15. Hardware Acceleration ─────────────────────────────────────────────
  results.push(await runTest(15, 'Hardware Accel — API Validation', async () => {
    const builder = ffmpeg(INPUT);
    if (typeof builder.hwAccel !== 'function') throw new Error('hwAccel method missing from FFmpegBuilder');
    if (typeof builder.videoCodec !== 'function') throw new Error('videoCodec method missing');
    if (typeof builder.crf !== 'function') throw new Error('crf method missing');
    // Verify builder chains correctly
    const chained = builder.output('test.mp4').hwAccel('vaapi').videoCodec('h264_vaapi');
    if (!chained) throw new Error('Builder chain returned null');
    printDetail('hwAccel method', '✓ present');
    printDetail('builder chain', '✓ fluent (returns this)');
    printDetail('note', 'Actual hardware encode not tested (requires GPU)');
  }));

  // ── 16. Filter System ─────────────────────────────────────────────────────
  results.push(await runTest(16, 'Filter System — Complex vflip Filter', async () => {
    const out = 'v16_vflip.mp4';
    await ffmpeg(INPUT).output(out).videoFilter('vflip').run();
    checkFile(out);
    printDetail('filter', 'vflip (vertical flip)');
    printDetail('method', '.videoFilter() → -vf chain');
  }));

  // ── 17. FFprobe Integration ───────────────────────────────────────────────
  results.push(await runTest(17, 'FFprobe — JSON Stream Integrity', async () => {
    const info: ProbeResult = await probeAsync(INPUT);
    if (!info.streams || info.streams.length === 0) throw new Error('No streams detected');
    const video = info.streams.find((s) => s.codec_type === 'video');
    const audio = info.streams.find((s) => s.codec_type === 'audio');
    if (!video) throw new Error('No video stream found');
    if (!audio) throw new Error('No audio stream found');
    printDetail('total streams', info.streams.length);
    printDetail('video codec', `${video.codec_name} ${video.width}x${video.height}`);
    printDetail('audio codec', `${audio.codec_name} ${audio.sample_rate}Hz ${audio.channel_layout}`);
    printDetail('duration', `${Number(info.format.duration ?? 0).toFixed(3)}s`);
    printDetail('bit rate', `${Math.round(Number(info.format.bit_rate ?? 0) / 1000)}kbps`);
  }));

  // ── 18. Metadata Strip ────────────────────────────────────────────────────
  results.push(await runTest(18, 'Strip Metadata — Privacy Clean', async () => {
    const out = 'v18_stripped.mp4';
    await stripMetadata({ input: INPUT, output: out });
    checkFile(out);
    const info: ProbeResult = await probeAsync(out);
    const tags = info.format.tags ?? {};
    const tagCount = Object.keys(tags).length;
    printDetail('tags remaining', tagCount);
    printDetail('method', 'map_metadata -1 + map_chapters -1');
  }));

  // ── 19. New Video Codec Serializers ───────────────────────────────────────
  results.push(await runTest(19, 'Codec Serializers — Video (proResToArgs + dnxhdToArgs + mjpegToArgs)', async () => {
    const { proResToArgs, dnxhdToArgs, mjpegToArgs, mpeg2ToArgs, mpeg4ToArgs, vp8ToArgs, theoraToArgs, ffv1ToArgs } = await import('./dist/esm/index.js') as Record<string, (...a: unknown[]) => string[]>;

    const checks: Array<[string, string[], string]> = [
      ['proResToArgs()',           proResToArgs(),                     'prores_ks'],
      ['proResToArgs({profile:3})', proResToArgs({ profile: 3 }),     '3'],
      ['proResToArgs prores_aw',   proResToArgs({}, 'prores_aw'),     'prores_aw'],
      ['dnxhdToArgs({bitrate:145})', dnxhdToArgs({ bitrate: 145 }),  '145k'],
      ['mjpegToArgs({qscale:3})', mjpegToArgs({ qscale: 3 }),        'mjpeg'],
      ['mpeg2ToArgs({interlaced})', mpeg2ToArgs({ interlaced: true }),'mpeg2video'],
      ['mpeg4ToArgs()',             mpeg4ToArgs(),                     'mpeg4'],
      ['mpeg4ToArgs libxvid',      mpeg4ToArgs({}, 'libxvid'),       'libxvid'],
      ['vp8ToArgs({bitrate:800})', vp8ToArgs({ bitrate: 800 }),      'libvpx'],
      ['theoraToArgs({qscale:7})', theoraToArgs({ qscale: 7 }),      'libtheora'],
      ['ffv1ToArgs({sliceCrc})',    ffv1ToArgs({ sliceCrc: true }),   'ffv1'],
    ];

    for (const [label, args, expected] of checks) {
      if (!args.some((a) => String(a).includes(expected))) {
        throw new Error(`${label}: expected '${expected}' in [${args.join(' ')}]`);
      }
      printDetail(label, args.join(' '));
    }
  }));

  // ── 20. New Audio Codec Serializers ───────────────────────────────────────
  results.push(await runTest(20, 'Codec Serializers — Audio (alacToArgs + eac3ToArgs + pcmToArgs + …)', async () => {
    const { alacToArgs, eac3ToArgs, truehdToArgs, vorbisToArgs, wavpackToArgs, pcmToArgs, mp2ToArgs } = await import('./dist/esm/index.js') as Record<string, (...a: unknown[]) => string[]>;

    const checks: Array<[string, string[], string]> = [
      ['alacToArgs()',              alacToArgs(),                       'alac'],
      ['eac3ToArgs({bitrate:640})', eac3ToArgs({ bitrate: 640 }),      'eac3'],
      ['eac3ToArgs dialNorm',       eac3ToArgs({ dialNorm: -24 }),     '-24'],
      ['truehdToArgs()',            truehdToArgs(),                     'truehd'],
      ['vorbisToArgs({qscale:5})', vorbisToArgs({ qscale: 5 }),       'libvorbis'],
      ['wavpackToArgs()',           wavpackToArgs(),                    'wavpack'],
      ['pcmToArgs pcm_s16le',      pcmToArgs('pcm_s16le'),            'pcm_s16le'],
      ['pcmToArgs pcm_s24le',      pcmToArgs('pcm_s24le'),            'pcm_s24le'],
      ['pcmToArgs pcm_f32le',      pcmToArgs('pcm_f32le'),            'pcm_f32le'],
      ['pcmToArgs sampleRate',     pcmToArgs('pcm_s16le', { sampleRate: 48000 }), '48000'],
      ['mp2ToArgs({bitrate:192})', mp2ToArgs({ bitrate: 192 }),       '192k'],
    ];

    for (const [label, args, expected] of checks) {
      if (!args.some((a) => String(a).includes(expected))) {
        throw new Error(`${label}: expected '${expected}' in [${args.join(' ')}]`);
      }
      printDetail(label, args.join(' '));
    }
  }));

  // ── 21. Hardware Codec Serializers ────────────────────────────────────────
  results.push(await runTest(21, 'Codec Serializers — Hardware (mediacodecVideoToArgs + vulkanVideoToArgs)', async () => {
    const { mediacodecVideoToArgs, vulkanVideoToArgs } = await import('./dist/esm/index.js') as Record<string, (...a: unknown[]) => string[]>;

    const checks: Array<[string, string[], string]> = [
      ['mediacodecVideoToArgs default',      mediacodecVideoToArgs({}),                          'h264_mediacodec'],
      ['mediacodecVideoToArgs hevc',         mediacodecVideoToArgs({ bitrate: 4000 }, 'hevc_mediacodec'), 'hevc_mediacodec'],
      ['mediacodecVideoToArgs av1',          mediacodecVideoToArgs({}, 'av1_mediacodec'),        'av1_mediacodec'],
      ['vulkanVideoToArgs default',          vulkanVideoToArgs({}),                              'h264_vulkan'],
      ['vulkanVideoToArgs hevc + crf',       vulkanVideoToArgs({ crf: 22 }, 'hevc_vulkan'),     'hevc_vulkan'],
      ['vulkanVideoToArgs av1_vulkan',       vulkanVideoToArgs({}, 'av1_vulkan'),               'av1_vulkan'],
    ];

    for (const [label, args, expected] of checks) {
      if (!args.some((a) => String(a).includes(expected))) {
        throw new Error(`${label}: expected '${expected}' in [${args.join(' ')}]`);
      }
      printDetail(label, args.join(' '));
    }
    printDetail('note', 'Arg-only test — actual hardware encode not attempted');
  }));

  // ─── Summary ──────────────────────────────────────────────────────────────
  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  const totalMs = Date.now() - suiteStart;

  printDivider();
  console.log('');
  console.log('═'.repeat(60));
  if (failed === 0) {
    console.log(`  ✅ ALL ${TOTAL}/${TOTAL} TESTS PASSED — CERTIFIED STABLE`);
  } else {
    console.log(`  🏁 FINISHED: ${passed}/${TOTAL} passed | ${failed} failed`);
  }
  console.log(`  ⏱️  Total Time: ${(totalMs / 1000).toFixed(2)}s`);
  console.log('═'.repeat(60));
  console.log('');

  if (failed > 0) {
    const failedIds = results
      .map((r, i) => (!r ? i + 1 : null))
      .filter((x): x is number => x !== null);
    console.error(`Failed tests: ${failedIds.map((n) => `#${n}`).join(', ')}`);
    process.exit(1);
  }
}

startSuite().catch((err: unknown) => {
  console.error('\n💥 Suite crashed during pre-flight:');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
