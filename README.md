<div align="center">

<img src="https://raw.githubusercontent.com/GlobalTechInfo/Database/main/images/mediaforge.png" alt="mediaforge" width="100%" />

[![NPM](https://img.shields.io/npm/v/mediaforge.svg)](https://www.npmjs.com/package/mediaforge)
[![JSR](https://jsr.io/badges/@globaltech/mediaforge)](https://jsr.io/@globaltech/mediaforge)
[![codecov](https://codecov.io/gh/GlobalTechInfo/mediaforge/branch/main/graph/badge.svg)](https://codecov.io/gh/GlobalTechInfo/mediaforge)
[![Downloads](https://img.shields.io/npm/dw/mediaforge?style=flat-square&label=Downloads&color=green)](https://npmjs.com/package/mediaforge)

</div>


**Fully typed TypeScript wrapper for FFmpeg — fluent builder API, v6/v7/v8 compatible, zero native bindings**

---

## What is mediaforge?

`mediaforge` is a zero-dependency TypeScript library that wraps the system `ffmpeg` binary with a fluent, fully-typed API. No native bindings, no bundled binaries — it uses whatever `ffmpeg` is installed on the system.

```ts
import { ffmpeg } from 'mediaforge';             // ESM ✅
// or
const { ffmpeg } = require('mediaforge');        // CJS ✅

await ffmpeg('input.mp4')
  .output('output.mp4')
  .videoCodec('libx264')
  .videoBitrate('2M')
  .audioCodec('aac')
  .audioBitrate('128k')
  .run();
```

---

## Install

**npm / pnpm / yarn / bun**
```bash
npm install mediaforge
pnpm add mediaforge
yarn add mediaforge
bun add mediaforge
```
**cli**
```bash
npm install -g mediaforge
```

**deno**
```bash
deno add jsr:@globaltech/mediaforge
```

**Deno (via JSR)**
```ts
import { ffmpeg } from "jsr:@globaltech/mediaforge";
```

**Deno (via npm compat)**
```ts
import { ffmpeg } from "npm:mediaforge";
```

Requires `ffmpeg` (and `ffprobe`) to be installed and on `PATH`, or set `FFMPEG_PATH` / `FFPROBE_PATH` environment variables.

---

## Runtime Support

| Runtime | Supported | Notes |
|---------|-----------|-------|
| Node.js 20+ | ✅ | Recommended |
| Deno 2.x | ✅ | Via `node:` compat layer — requires `--allow-env` and `--allow-run` |
| Bun | ✅ | Full support |
| npm | ✅ | Full support |
| pnpm | ✅ | Full support |
| yarn | ✅ | Full support |

> **Deno users:** the library uses `node:child_process` and `node:events` internally.
> You must grant `--allow-env` (for `FFMPEG_PATH`/`FFPROBE_PATH` resolution) and
> `--allow-run` (for spawning the `ffmpeg`/`ffprobe` binaries) when running your script:
>
> ```bash
> deno run --allow-env --allow-run my-script.ts
> ```

---

## Table of Contents

- [Fluent Builder API](#fluent-builder-api)
- [Screenshots & Frame Extraction](#screenshots-frame-extraction)
- [Pipe & Stream I/O](#pipe-stream-io)
- [Concat & Merge](#concat-merge)
- [Animated GIF](#animated-gif)
- [Audio Normalization](#audio-normalization)
- [Watermarks](#watermarks)
- [Subtitles](#subtitles)
- [Metadata](#metadata)
- [Waveform & Spectrum](#waveform-spectrum)
- [Codec Serializers](#codec-serializers)
- [Color Grading & Visual Filters](#color-grading-filters)
- [Hardware Codec Helpers (v0.3.0)](#hardware-codecs-v3)
- [Edit Helpers (v0.3.0)](#edit-helpers)
- [Named Presets](#named-presets)
- [HLS & DASH Packaging](#hls-dash-packaging)
- [Two-Pass Encoding](#two-pass-encoding)
- [Stream Mapping DSL](#stream-mapping-dsl)
- [Hardware Acceleration](#hardware-acceleration)
- [Filter System](#filter-system)
- [FFprobe Integration](#ffprobe-integration)
- [Process Management](#process-management)
- [Progress Events](#progress-events)
- [CLI](#cli)
- [Compatibility Guards](#compatibility-guards)
- [Version Support](#version-support)

---

<a name="fluent-builder-api"></a>

## Fluent Builder API

All methods return `this` for chaining. Call `.output()` before codec/filter options.

```ts
import { ffmpeg } from 'mediaforge';

// Transcode video
await ffmpeg('input.mp4')
  .output('output.mp4')
  .videoCodec('libx264')
  .crf(22)
  .addOutputOption('-preset', 'fast')
  .audioCodec('aac')
  .audioBitrate('128k')
  .run();

// Extract audio only
await ffmpeg('video.mp4')
  .output('audio.mp3')
  .noVideo()
  .audioCodec('libmp3lame')
  .audioBitrate('192k')
  .run();

// Multiple outputs in one pass
await ffmpeg('input.mp4')
  .output('preview.mp4')
  .size('640x360')
  .videoCodec('libx264')
  .output('hq.mp4')
  .size('1920x1080')
  .videoCodec('libx264')
  .run();
```

### Builder methods

| Method | Description |
|--------|-------------|
| `.input(path, opts?)` | Add input file |
| `.seekInput(pos)` | Seek in last-added input (fast) |
| `.inputDuration(d)` | Limit last-added input duration |
| `.inputFormat(fmt)` | Force input format |
| `.output(path, opts?)` | Add output — call before codec/filter options |
| `.videoCodec(codec)` | Set video codec (`libx264`, `libx265`, `copy`, …) |
| `.videoBitrate(rate)` | Set video bitrate (`2M`, `4000k`, …) |
| `.fps(rate)` | Set output frame rate |
| `.size(wxh)` | Set output size (`1280x720`) |
| `.crf(value)` | Set CRF quality value |
| `.pixelFormat(fmt)` | Set pixel format |
| `.audioCodec(codec)` | Set audio codec (`aac`, `libopus`, `copy`, …) |
| `.audioBitrate(rate)` | Set audio bitrate (`128k`, `192k`, …) |
| `.audioSampleRate(hz)` | Set sample rate |
| `.audioChannels(n)` | Set channel count |
| `.noVideo()` | Disable video stream |
| `.noAudio()` | Disable audio stream |
| `.outputFormat(fmt)` | Force output format |
| `.map(spec)` | Add stream mapping |
| `.duration(d)` | Limit output duration |
| `.seekOutput(pos)` | Output seek (accurate, re-encode) |
| `.videoFilter(f)` | Set `-vf` filter chain |
| `.audioFilter(f)` | Set `-af` filter chain |
| `.complexFilter(f)` | Set `-filter_complex` |
| `.addOutputOption(...args)` | Pass extra output args |
| `.addGlobalOption(...args)` | Pass extra global args |
| `.overwrite(bool)` | Overwrite output (default: true) |
| `.logLevel(level)` | Set ffmpeg log level |
| `.hwAccel(name, opts?)` | Enable hardware acceleration |
| `.spawn(opts?)` | Start process, return `FFmpegProcess` |
| `.run(opts?)` | Start process, return `Promise<void>` |
| `.dry()` | Return CLI args without executing |

---

### Low-level process API

```ts
import { spawnFFmpeg, runFFmpeg, FFmpegSpawnError } from 'mediaforge';

// spawnFFmpeg — returns FFmpegProcess with .emitter for streaming events
const proc = spawnFFmpeg({ binary: 'ffmpeg', args: ['-i', 'in.mp4', 'out.mp4'] });
proc.emitter.on('end', () => console.log('done'));

// runFFmpeg — awaitable, throws FFmpegSpawnError on non-zero exit
await runFFmpeg({ binary: 'ffmpeg', args: ['-i', 'in.mp4', 'out.mp4'] });
```

---

<a name="screenshots-frame-extraction"></a>

## Screenshots & Frame Extraction

```ts
import { screenshots, frameToBuffer } from 'mediaforge';

// Extract 5 evenly-spaced screenshots
const { files } = await screenshots({
  input: 'video.mp4',
  folder: './thumbs',
  count: 5,
});
console.log(files); // ['./thumbs/screenshot_0001.png', ...]

// Extract at specific timestamps
const { files } = await screenshots({
  input: 'video.mp4',
  folder: './thumbs',
  timestamps: ['00:00:05', '00:01:30', 90],
  filename: 'thumb_%04d.jpg',
  size: '640x360',
});

// Get a single frame as a Buffer (no file written)
const buf = await frameToBuffer({
  input: 'video.mp4',
  timestamp: 30,
  format: 'png',
  size: '1280x720',
});
fs.writeFileSync('frame.png', buf);

// Export ALL frames as individual images with fps control
await extractFrames({
  input: 'video.mp4',
  folder: './frames',
  fps: 30,           // Extract at 30 fps (every frame)
  pattern: 'frame_%06d.png',
  size: '1920x1080',
  quality: 95,
});
```

---

<a name="pipe-stream-io"></a>

## Pipe & Stream I/O

```ts
import { pipeThrough, streamOutput, streamToFile } from 'mediaforge';
import fs from 'fs';

// Pipe: readable stream → ffmpeg → writable stream
// When outputFormat is 'mp4' or 'mov', the library automatically injects
// -movflags frag_keyframe+empty_moov+default_base_moof so the output is
// streamable without seeking. You do not need to set this manually.
const proc = pipeThrough({
  inputFormat: 'webm',
  outputArgs: ['-c:v', 'libx264', '-c:a', 'aac'],
  outputFormat: 'mp4',
});
fs.createReadStream('input.webm').pipe(proc.stdin!);
proc.stdout.pipe(fs.createWriteStream('output.mp4'));
await new Promise((res, rej) => {
  proc.emitter.on('end', res);
  proc.emitter.on('error', rej);
});

// Stream output to HTTP response
import http from 'http';
http.createServer((req, res) => {
  res.setHeader('Content-Type', 'video/mp4');
  streamOutput({
    input: 'movie.mp4',
    outputFormat: 'mp4',
    outputArgs: ['-c', 'copy', '-movflags', 'frag_keyframe+empty_moov'],
  }).pipe(res);
}).listen(3000);

// Pipe incoming HTTP upload directly to file
await streamToFile({
  stream: req,           // Node.js IncomingMessage
  inputFormat: 'webm',
  output: './uploads/video.mp4',
  outputArgs: ['-c:v', 'libx264', '-c:a', 'aac'],
});
```

> **MP4/MOV pipe fixes:** Two automatic fixes are applied when piping MP4/MOV:
> 1. **Output:** `-movflags frag_keyframe+empty_moov+default_base_moof` is injected
>    automatically for `mp4`/`mov` output formats so the stream is seekable-free.
>    Pass your own `-movflags` to override.
> 2. **Input:** `-analyzeduration 100M -probesize 100M` is injected automatically
>    when `inputFormat` is `mp4`/`mov`/`m4v`, giving FFmpeg enough buffer to locate
>    the `moov` atom even when it is at the end of the file. For large files,
>    pre-processing with `-movflags +faststart` (moov at start) is still recommended.

---

<a name="concat-merge"></a>

## Concat & Merge

```ts
import { mergeToFile, concatFiles } from 'mediaforge';

// Stream copy (fastest — no re-encode)
await mergeToFile({
  inputs: ['part1.mp4', 'part2.mp4', 'part3.mp4'],
  output: 'merged.mp4',
});

// Re-encode while merging
await mergeToFile({
  inputs: ['clip1.mp4', 'clip2.mp4'],
  output: 'merged.mp4',
  reencode: true,
  videoCodec: 'libx264',
  audioCodec: 'aac',
});

// filter_complex concat (event-based control)
const proc = concatFiles({
  inputs: ['a.mp4', 'b.mp4', 'c.mp4'],
  output: 'out.mp4',
});
proc.emitter.on('progress', console.log);
await new Promise((res, rej) => {
  proc.emitter.on('end', res);
  proc.emitter.on('error', rej);
});

// Concat with crossfade transitions between clips
await concatWithTransitions({
  inputs: ['intro.mp4', 'segment1.mp4', 'segment2.mp4', 'outro.mp4'],
  output: 'seamless.mp4',
  transition: 'crossfade',
  duration: 1,        // 1 second transition between each clip
});
```

---

<a name="animated-gif"></a>

## Animated GIF

```ts
import { toGif, gifToMp4 } from 'mediaforge';

// High-quality 2-pass GIF (palette generation)
await toGif({
  input: 'clip.mp4',
  output: 'clip.gif',
  width: 480,
  fps: 15,
  colors: 256,
  dither: 'bayer',
  startTime: 10,
  duration: 5,
});

// Convert GIF back to MP4 (for platform uploads)
await gifToMp4({ input: 'animation.gif', output: 'animation.mp4' });
```

---

<a name="audio-normalization"></a>

## Audio Normalization

```ts
import { normalizeAudio, adjustVolume } from 'mediaforge';

// EBU R128 two-pass normalization (broadcast standard)
const result = await normalizeAudio({
  input: 'raw.mp4',
  output: 'normalized.mp4',
  targetI: -23,    // integrated loudness (LUFS)
  targetLra: 7,    // loudness range (LU)
  targetTp: -2,    // true peak (dBTP)
});
console.log(`Input was ${result.inputI} LUFS`);

// Podcast standard (-16 LUFS)
await normalizeAudio({ input: 'episode.mp3', output: 'episode-norm.mp3', targetI: -16 });

// Simple volume adjust
await adjustVolume({ input: 'in.mp4', output: 'out.mp4', volume: '0.5' });   // half
await adjustVolume({ input: 'in.mp4', output: 'out.mp4', volume: '6dB' });   // +6dB

// Detect silence and get timestamp ranges
const silence = await detectSilence({
  input: 'audio.wav',
  noiseLevel: -40,      // dB threshold (default: -60dB)
  duration: 2,       // minimum silence duration in seconds
  silenceOnly: true,    // return only silence ranges (false = include speech)
});
console.log(silence.startTimes);   // [0.5, 45.2, 120.8]
console.log(silence.endTimes);    // [2.1, 47.0, 122.5]

// Parse loudnorm output for EBU R128 analysis
const loudness = await parseLoudnorm({
  input: 'audio.mp3',
  measures: ['I', 'LRA', 'TP'],   // what to measure
});
console.log(loudness.normalized);  // { I: -23.1, LRA: 6.2, TP: -1.8 }
```

---

<a name="watermarks"></a>

## Watermarks

```ts
import { addWatermark, addTextWatermark } from 'mediaforge';

// Image watermark
await addWatermark({
  input: 'video.mp4',
  watermark: 'logo.png',
  output: 'watermarked.mp4',
  position: 'bottom-right',   // top-left | top-right | top-center |
                               // bottom-left | bottom-right | bottom-center | center
  margin: 10,
  opacity: 0.7,
  scaleWidth: 150,             // optional: scale logo to 150px wide
});

// Text watermark
await addTextWatermark({
  input: 'video.mp4',
  output: 'watermarked.mp4',
  text: '© MyCompany 2026',
  position: 'bottom-right',
  fontSize: 24,
  fontColor: 'white@0.8',
  fontFile: '/path/to/font.ttf',  // optional
});
```

---

<a name="subtitles"></a>

## Subtitles

```ts
import { burnSubtitles, extractSubtitles } from 'mediaforge';

// Burn (hardcode) subtitles into video
await burnSubtitles({
  input: 'video.mp4',
  subtitleFile: 'subs.srt',
  output: 'video-subbed.mp4',
  fontSize: 24,
  fontName: 'Arial',
});

// Extract subtitle stream to file
await extractSubtitles({
  input: 'movie.mkv',
  output: 'subs.srt',
  streamIndex: 0,
});
```

---

<a name="metadata"></a>

## Metadata

```ts
import { writeMetadata, stripMetadata } from 'mediaforge';

// Write container and stream metadata
await writeMetadata({
  input: 'video.mp4',
  output: 'tagged.mp4',
  metadata: { title: 'My Film', artist: 'Director', year: '2025', comment: 'Draft' },
  streamMetadata: {
    'a:0': { language: 'eng', title: 'English Audio' },
    's:0': { language: 'fra' },
  },
  chapters: [
    { title: 'Introduction', startSec: 0,   endSec: 120  },
    { title: 'Act One',      startSec: 120, endSec: 1800 },
  ],
});

// Strip all metadata (privacy-safe export)
await stripMetadata({ input: 'original.mp4', output: 'clean.mp4' });

// Add chapter markers (convenience wrapper)
await addChapters({
  input: 'movie.mp4',
  output: 'chapters.mp4',
  chapters: [
    { title: 'Introduction', startSec: 0 },
    { title: 'Chapter 1: Setup', startSec: 120 },
    { title: 'Chapter 2: Action', startSec: 600, endSec: 1200 },
    { title: 'Conclusion', startSec: 1800 },
  ],
});
```

---

<a name="waveform-spectrum"></a>

## Waveform & Spectrum

```ts
import { generateWaveform, generateSpectrum } from 'mediaforge';

// Waveform image from audio
await generateWaveform({
  input: 'audio.mp3',
  output: 'waveform.png',
  width: 1920,
  height: 240,
  color: '#00aaff',
  backgroundColor: '#1a1a2e',  // Only emitted when non-default (FFmpeg 7.x safe)
  mode: 'line',    // line | point | p2p | cline
  scale: 'lin',    // lin | log
});

// Real-time spectrum visualizer video
await generateSpectrum({
  input: 'podcast.mp3',
  output: 'spectrum.mp4',
  width: 1280,
  height: 720,
  color: 'fire',
  fps: 25,
});
```

> **FFmpeg 7.x compatibility:** The `showwavespic` filter's `bgcolor` and `draw`
> parameters were removed in FFmpeg 7.1. `generateWaveform` only emits `bgcolor`
> when you set a non-default (non-black) value, and only emits `draw` when the
> mode is not the default `'line'`.

---

<a name="codec-serializers"></a>

## Codec Serializers

Typed helpers that build the exact FFmpeg argument arrays for each encoder.
Every helper is verified against both **FFmpeg v7** (Ubuntu/Linux) and **FFmpeg v8** (Android Termux).

### Video

```ts
import {
  x264ToArgs, x265ToArgs, svtav1ToArgs, vp9ToArgs,
  proResToArgs, dnxhdToArgs, mjpegToArgs, mpeg2ToArgs,
  mpeg4ToArgs, vp8ToArgs, theoraToArgs, ffv1ToArgs,
} from 'mediaforge';

// H.264 — libx264
await ffmpeg('in.mp4').output('out.mp4').addOutputOption(...x264ToArgs({ crf: 22, preset: 'slow' })).run();

// Apple ProRes HQ — prores_ks
await ffmpeg('in.mp4').output('out.mov').addOutputOption(...proResToArgs({ profile: 3 })).run();

// Avid DNxHD
await ffmpeg('in.mp4').output('out.mxf').addOutputOption(...dnxhdToArgs({ bitrate: 145, pixFmt: 'yuv422p10le' })).run();

// Motion JPEG
await ffmpeg('in.mp4').output('out.avi').addOutputOption(...mjpegToArgs({ qscale: 3 })).run();

// MPEG-2 (broadcast / DVD)
await ffmpeg('in.mp4').output('out.mpg').addOutputOption(...mpeg2ToArgs({ bitrate: 8000, interlaced: true })).run();

// VP8 (WebM)
await ffmpeg('in.mp4').output('out.webm').addOutputOption(...vp8ToArgs({ bitrate: 800, cpuUsed: 4 })).run();

// FFV1 lossless archival
await ffmpeg('in.mp4').output('out.mkv').addOutputOption(...ffv1ToArgs({ version: 3, slices: 16, sliceCrc: true })).run();
```

| Helper | Encoder | Available |
|--------|---------|-----------|
| `x264ToArgs(opts)` | `libx264` | v6+ |
| `x265ToArgs(opts)` | `libx265` | v6+ |
| `svtav1ToArgs(opts)` | `libsvtav1` | v6+ |
| `vp9ToArgs(opts)` | `libvpx-vp9` | v6+ | `crf`, `bitrate`, `quality`, `cpuUsed`, `tileColumns`, `rowMt`, `deadline` |
| `proResToArgs(opts?, enc?)` | `prores_ks` / `prores_aw` / `prores` | v6+ |
| `dnxhdToArgs(opts?)` | `dnxhd` | v6+ |
| `mjpegToArgs(opts?)` | `mjpeg` | v6+ |
| `mpeg2ToArgs(opts?)` | `mpeg2video` | v6+ |
| `mpeg4ToArgs(opts?, enc?)` | `mpeg4` / `libxvid` | v6+ |
| `vp8ToArgs(opts?)` | `libvpx` | v6+ |
| `theoraToArgs(opts?)` | `libtheora` | v6+ |
| `ffv1ToArgs(opts?)` | `ffv1` | v6+ |

### Audio

```ts
import {
  aacToArgs, mp3ToArgs, opusToArgs, flacToArgs, ac3ToArgs,
  alacToArgs, eac3ToArgs, vorbisToArgs, pcmToArgs, mp2ToArgs,
} from 'mediaforge';

// Apple Lossless
await ffmpeg('in.flac').output('out.m4a').addOutputOption(...alacToArgs()).run();

// Dolby Digital Plus (streaming platforms)
await ffmpeg('in.mp4').output('out.mp4').addOutputOption(...eac3ToArgs({ bitrate: 640, dialNorm: -24 })).run();

// PCM master (WAV)
await ffmpeg('in.mp4').output('out.wav').addOutputOption(...pcmToArgs('pcm_s24le', { sampleRate: 48000 })).run();

// MP2 broadcast
await ffmpeg('in.mp4').output('out.mpg').addOutputOption(...mp2ToArgs({ bitrate: 192, sampleRate: 48000 })).run();
```

| Helper | Encoder | Use case |
|--------|---------|----------|
| `aacToArgs(opts)` | `aac` | Universal streaming | `bitrate`, `vbr`, `profile` (`aac_low`, `aac_he`, `aac_he_v2`), `sampleRate`, `channels` |
| `mp3ToArgs(opts)` | `libmp3lame` | Consumer/podcasting |
| `opusToArgs(opts)` | `libopus` | WebRTC, Discord |
| `flacToArgs(opts?)` | `flac` | Lossless |
| `ac3ToArgs(opts?)` | `ac3` | Dolby Digital |
| `alacToArgs(opts?)` | `alac` | Apple Lossless |
| `eac3ToArgs(opts?)` | `eac3` | Dolby Digital Plus (Netflix/Amazon) |
| `truehdToArgs(opts?)` | `truehd` | Dolby TrueHD (Blu-ray) |
| `vorbisToArgs(opts?)` | `libvorbis` | Ogg Vorbis |
| `wavpackToArgs(opts?)` | `wavpack` | Hybrid lossless |
| `pcmToArgs(format, opts?)` | `pcm_s16le`, `pcm_s24le`, `pcm_f32le`, … | Raw PCM masters |
| `mp2ToArgs(opts?)` | `mp2` | DVB/ATSC broadcast |

### Hardware Acceleration

```ts
import { nvencToArgs, vaapiToArgs, qsvToArgs, mediacodecVideoToArgs, vulkanVideoToArgs } from 'mediaforge';

// NVIDIA NVENC (Linux)
await ffmpeg('in.mp4').output('out.mp4').addOutputOption(...nvencToArgs({ preset: 'p4', cq: 23 }, 'h264_nvenc')).run();

// Android MediaCodec (FFmpeg v8 / Termux)
await ffmpeg('in.mp4').output('out.mp4').addOutputOption(...mediacodecVideoToArgs({ bitrate: 4000 }, 'h264_mediacodec')).run();

// Vulkan GPU (Linux + Android)
await ffmpeg('in.mp4').output('out.mp4').addOutputOption(...vulkanVideoToArgs({ crf: 22 }, 'h264_vulkan')).run();
```

| Helper | Codecs | Platform |
|--------|--------|----------|
| `nvencToArgs(opts, codec?)` | `h264_nvenc`, `hevc_nvenc`, `av1_nvenc` | NVIDIA GPU (Linux) |
| `vaapiToArgs(opts, codec?)` | `h264_vaapi`, `hevc_vaapi`, `vp8_vaapi`, … | Intel/AMD (Linux) |
| `qsvToArgs(opts, codec?)` | `h264_qsv`, `hevc_qsv` | Intel Quick Sync |
| `mediacodecToArgs(opts, codec?)` | `h264_mediacodec`, `hevc_mediacodec` | Android MediaCodec (generic) |
| `mediacodecVideoToArgs(opts, codec?)` | `h264_mediacodec`, `hevc_mediacodec`, `av1_mediacodec`, … | Android (FFmpeg v8) |
| `vulkanToArgs(opts, codec?)` | `h264_vulkan`, `hevc_vulkan` | Vulkan GPU (generic) |
| `vulkanVideoToArgs(opts, codec?)` | `h264_vulkan`, `hevc_vulkan`, `av1_vulkan`, `ffv1_vulkan` | Vulkan GPU |

---

<a name="edit-helpers"></a>

## Edit Helpers (v0.3.0)

### `trimVideo` — cut by time range

```ts
import { trimVideo } from 'mediaforge';

// Instant stream copy (frame-approximate, no quality loss)
await trimVideo({ input: 'in.mp4', output: 'out.mp4', start: 10, end: 40 });

// Frame-accurate re-encode
await trimVideo({ input: 'in.mp4', output: 'out.mp4', start: '00:00:10', duration: 30, copy: false });
```

### `changeSpeed` — video + audio tempo

```ts
import { changeSpeed } from 'mediaforge';

await changeSpeed({ input: 'in.mp4', output: 'fast.mp4', speed: 2.0 });   // 2× faster
await changeSpeed({ input: 'in.mp4', output: 'slow.mp4', speed: 0.25 });  // 4× slow-mo
// Chains multiple atempo filters automatically for speeds outside 0.5–2.0
```

### `extractAudio` / `replaceAudio` / `mixAudio`

```ts
import { extractAudio, replaceAudio, mixAudio } from 'mediaforge';

// Extract audio — codec auto-detected from extension
await extractAudio({ input: 'video.mp4', output: 'audio.mp3' });
await extractAudio({ input: 'video.mp4', output: 'master.wav', sampleRate: 48000 });

// Replace audio track
await replaceAudio({ video: 'video.mp4', audio: 'music.mp3', output: 'out.mp4' });

// Mix multiple audio files
await mixAudio({ inputs: ['voice.mp3', 'bg.mp3'], output: 'mixed.mp3', weights: [1.0, 0.3] });
```

### `stackVideos` — hstack / vstack / xstack

```ts
import { stackVideos } from 'mediaforge';

// Side by side
await stackVideos({ inputs: ['a.mp4', 'b.mp4'], output: 'side.mp4', direction: 'hstack' });

// 2×2 grid
await stackVideos({ inputs: ['a.mp4','b.mp4','c.mp4','d.mp4'], output: 'grid.mp4', direction: 'xstack', columns: 2 });
```

### `cropToRatio` — smart center crop

```ts
import { cropToRatio } from 'mediaforge';

await cropToRatio({ input: 'wide.mp4', output: 'square.mp4', ratio: '1:1' });
await cropToRatio({ input: 'landscape.mp4', output: 'portrait.mp4', ratio: '9:16' });
```

### `generateSprite` — thumbnail sprite sheet

```ts
import { generateSprite } from 'mediaforge';

const info = await generateSprite({ input: 'video.mp4', output: 'sprites.jpg', columns: 5, count: 25 });
// info.columns, info.rows, info.thumbWidth — use to build a VTT seek-preview file
```

### `buildAtempoChain` — exported utility

```ts
import { buildAtempoChain } from 'mediaforge';

buildAtempoChain(2.0);   // → 'atempo=2.000000'
buildAtempoChain(4.0);   // → 'atempo=2.0,atempo=2.000000'  (chained for >2x)
buildAtempoChain(0.25);  // → 'atempo=0.5,atempo=0.500000'  (chained for <0.5x)
```

### `loopVideo` / `deinterlace` / `applyLUT` / `stabilizeVideo` / `streamToUrl`

```ts
import { loopVideo, deinterlace, applyLUT, stabilizeVideo, streamToUrl } from 'mediaforge';

await loopVideo({ input: 'clip.mp4', output: 'looped.mp4', loops: 2, duration: 10 }); // loop 2x, trim to 10s total
await deinterlace({ input: 'broadcast.ts', output: 'progressive.mp4' });
await applyLUT({ input: 'raw.mp4', output: 'graded.mp4', lut: 'film.cube' });
await stabilizeVideo({ input: 'shaky.mp4', output: 'stable.mp4', smoothing: 15 });
// Requires FFmpeg compiled with --enable-libvidstab
await streamToUrl({ input: 'video.mp4', url: 'rtmp://live.twitch.tv/app/STREAM_KEY', format: 'flv' }); // format required
```

---

<a name="color-grading-filters"></a>

## Color Grading & Visual Filters (v0.3.0)

```ts
import { curves, levels, deband, deshake, deflicker, smartblur } from 'mediaforge';
import { FilterChain } from 'mediaforge';

// Standalone (returns filter string for .videoFilter())
await ffmpeg('in.mp4').output('out.mp4').videoFilter(curves({ preset: 'vintage' })).videoCodec('libx264').run();
await ffmpeg('in.mp4').output('out.mp4').videoFilter(levels({ inBlack: 10, inWhite: 240 })).videoCodec('libx264').run();

// Chained (attach to a FilterChain)
const chain = new FilterChain();
deband(chain);
deshake(chain, { rx: 16, ry: 16 });
await ffmpeg('in.mp4').output('out.mp4').videoFilter(chain.toString()).run();
```

| Filter | Standalone | Description |
|--------|-----------|-------------|
| `curves(opts)` | ✅ | Tone curves — named presets (`vintage`, `cross_process`, …) or custom R/G/B points |
| `levels(opts?)` | ✅ | Input/output range + gamma adjustment (FFmpeg 7+; not in FFmpeg 6) |
| `deband(chain, opts?)` | ❌ | Remove banding from flat regions |
| `deshake(chain, opts?)` | ❌ | Camera shake stabilisation (no external lib) |
| `deflicker(chain, opts?)` | ❌ | Reduce temporal flicker (time-lapses) |
| `smartblur(chain, opts?)` | ❌ | Edge-preserving smoothing |
| `hstack(chain, n)` | ❌ | Stack N videos horizontally (use `stackVideos` for high-level) |
| `vstack(chain, n)` | ❌ | Stack N videos vertically |
| `xstack(chain, opts)` | ❌ | Arrange N videos in a custom grid |
| `colorSource(chain, opts?)` | ❌ | Solid colour source frame (for overlays) |
| `drawbox(opts?)` | ✅ | Draw colored boxes/frames on video |
| `drawgrid(opts?)` | ✅ | Draw a grid overlay |
| `vignette(opts?)` | ✅ | Apply vignette effect |
| `vaguedenoiser(opts?)` | ✅ | Wavelet-based denoising |

## Analysis Helpers (v0.4.0)

```ts
import { detectSilence, detectScenes, cropDetect, burnTimecode, parseLoudnorm } from 'mediaforge';

// Detect silence segments (returns Array<{ start, end, duration }>)
const silences = await detectSilence({
  input: 'podcast.mp3',
  threshold: -40,    // dB (default: -50)
  duration: 0.5,     // minimum silence length in seconds (default: 0.5)
});
silences.forEach(s => console.log(`Silence: ${s.start.toFixed(2)}s – ${s.end.toFixed(2)}s`));

// Two-pass EBU R128 loudness measurement (non-destructive)
const loudness = await parseLoudnorm({ input: 'audio.mp3' });
console.log(loudness); // { input_i, input_lra, input_tp, input_thresh, ... }
```

```ts
import { detectSilence, detectScenes, cropDetect, burnTimecode } from 'mediaforge';

// Detect scene changes in video
const scenes = await detectScenes({
  input: 'video.mp4',
  threshold: 0.4,   // scene change sensitivity (default: 0.4, lower = more sensitive)
});
// Returns: Array of { timestamp: number, sceneNumber: number }
scenes.forEach(s => console.log(`Scene ${s.sceneNumber} at ${s.timestamp}s`));

// Detect letterbox/pillarbox (black bars)
const crop = await cropDetect({
  input: 'video.mp4',
  limit: 100,  // max frames to scan (default: 100)
  skip: 5,     // skip first N seconds (default: 5)
});
if (crop) console.log(crop);  // { width: 1920, height: 800, x: 0, y: 140 } or null

// Burn timecode into video
// position: 'tl', 'tr', 'bl', 'br', 'center' (default: 'bl')
await burnTimecode({
  input: 'video.mp4',
  output: 'timecoded.mp4',
  fontsize: 24,
  fontcolor: 'white',
  position: 'bl',
});
```

---

<a name="hardware-codecs-v3"></a>

## Hardware Codec Helpers (v0.3.0 additions)

```ts
import { amfToArgs, videotoolboxToArgs } from 'mediaforge';

// AMD AMF (Windows/Linux with AMD GPU)
await ffmpeg('in.mp4').output('out.mp4').addOutputOption(...amfToArgs({ bitrate: 8000, quality: 'balanced' }, 'hevc_amf')).run();

// Apple VideoToolbox (macOS/iOS)
await ffmpeg('in.mp4').output('out.mp4').addOutputOption(...videotoolboxToArgs({ bitrate: 6000 }, 'hevc_videotoolbox')).run();
```

| Helper | Codecs | Platform |
|--------|--------|----------|
| `amfToArgs(opts, codec?)` | `h264_amf`, `hevc_amf`, `av1_amf` | AMD GPU (Windows / Linux libamf) |
| `videotoolboxToArgs(opts, codec?)` | `h264_videotoolbox`, `hevc_videotoolbox` | Apple macOS / iOS |

## Audio Filters

mediaforge exports 26 audio filters. All support two overload styles — standalone (returns filter string) or chained (appends to `FilterChain`).

```ts
import {
  volume, loudnorm, equalizer, bass, treble, atempo,
  aecho, afade, highpass, lowpass, dynaudnorm, compand,
  aresample, amerge, amix, pan, channelmap, channelsplit,
  asplit, silencedetect, rubberband, agate, asetpts, atrim,
  headphones, sofalizer,
} from 'mediaforge';

// Standalone — returns filter string for .audioFilter()
await ffmpeg('in.mp4').output('out.mp4')
  .audioFilter([
    bass({ gain: 4 }),                          // boost bass +4dB
    treble({ gain: -2 }),                       // cut highs -2dB
    highpass({ frequency: 80 }),                // remove sub-80Hz rumble
    equalizer({ frequency: 3000, width_type: 'o', width: 1, gain: 3 }),
    dynaudnorm(),                               // dynamic normalisation
    compand(),                                  // dynamic range compression
  ].join(','))
  .audioCodec('aac').run();

// Tempo / pitch
await ffmpeg('in.mp4').output('out.mp4')
  .audioFilter(atempo({ tempo: 1.5 }))         // 1.5× speed (audio only)
  .audioFilter(rubberband({ pitch: 1.5 }))     // pitch-shift up
  .audioCodec('aac').run();

// Spatial audio
await ffmpeg('in.mp4').output('out.mp4')
  .audioFilter(aecho(new FilterChain(), { delays: 500, decays: 0.5 }))
  .audioFilter(headphones({ map: 'stereo' }))
  .audioFilter(sofalizer({ sofa: 'HRTF_44100.sofa', gain: 3.0 }))
  .audioCodec('aac').run();

// Channel manipulation
await ffmpeg('stereo.mp3').output('mono.mp3')
  .audioFilter(pan(new FilterChain(), 'mono|c0=0.5*c0+0.5*c1'))
  .audioFilter(aresample(new FilterChain(), 44100))
  .audioCodec('libmp3lame').run();

// Silence / gating
await ffmpeg('podcast.mp3').output('gated.mp3')
  .audioFilter(agate(new FilterChain(), { threshold: 0.02 }))
  .audioFilter(highpass(new FilterChain(), 80))
  .audioFilter(lowpass(new FilterChain(), 16000))
  .audioCodec('libmp3lame').run();

import { headphones, sofalizer } from 'mediaforge';

// Virtual surround sound from stereo headphones
await ffmpeg('in.mp4').output('out.mp4')
  .audioFilter(headphones({ map: 'stereo' }))
  .run();

// SOFA file-based 3D audio virtualization
await ffmpeg('in.mp4').output('out.mp4')
  .audioFilter(sofalizer({ sofa: 'HRTF_44100.sofa', gain: 3.0 }))
  .run();
```

---

<a name="named-presets"></a>

## Named Presets

Production-ready codec configurations, ready to apply:


```ts
import { getPreset, applyPreset, listPresets } from 'mediaforge';

// Get preset as separate arg arrays
const p = getPreset('web');
await ffmpeg('input.mp4')
  .output('output.mp4')
  .addOutputOption(...p.videoArgs)
  .addOutputOption(...p.audioArgs)
  .run();

// Or as flat array
await ffmpeg('input.mp4')
  .output('output.mp4')
  .addOutputOption(...applyPreset('web'))
  .run();

// List all available presets
console.log(listPresets());
```

| Preset | Description |
|--------|-------------|
| `web` | H.264 + AAC, faststart, browser-safe |
| `web-hq` | H.264 CRF 18 + AAC 192k, slow preset |
| `mobile` | H.264 baseline + AAC, small file |
| `archive` | Lossless H.264 CRF 0 + FLAC |
| `podcast` | Audio-only, mono AAC 96k, no video |
| `hls-input` | H.264 with fixed keyframes for HLS |
| `gif` | Audio disabled (use with `toGif()`) |
| `discord` | Discord-friendly H.264 + AAC |
| `instagram` | Instagram-compatible H.264 + AAC |
| `prores` | ProRes 422 HQ + PCM for editing |
| `dnxhd` | DNxHD 115 + PCM for editing |

---

<a name="hls-dash-packaging"></a>

## HLS & DASH Packaging

```ts
import { hlsPackage, adaptiveHls, dashPackage } from 'mediaforge';

// Single-bitrate HLS
await hlsPackage({
  input: 'input.mp4',
  outputDir: './hls-output',
  segmentDuration: 6,
  hlsVersion: 3,          // 3 | 4 | 5 | 6 | 7 — default: 3
  videoCodec: 'libx264',
  videoBitrate: '2M',
  audioBitrate: '128k',
}).run();

// Adaptive HLS (multiple bitrates)
await adaptiveHls({
  input: 'input.mp4',
  outputDir: './hls-output',
  variants: [
    { label: '1080p', resolution: '1920x1080', videoBitrate: '4M',   audioBitrate: '192k' },
    { label: '720p',  resolution: '1280x720',  videoBitrate: '2M',   audioBitrate: '128k' },
    { label: '360p',  resolution: '854x480',   videoBitrate: '800k', audioBitrate: '96k'  },
  ],
}).run();

// DASH
await dashPackage({
  input: 'input.mp4',
  output: 'output/manifest.mpd',
  segmentDuration: 4,
  videoCodec: 'libx264',
  videoBitrate: '2M',
}).run();
```

> **FFmpeg 7.x compatibility:** `hls_version` and all other `hls_*` flags are
> output-private options in FFmpeg — they must follow `-f hls` in the argument
> list or FFmpeg will reject them with `Unrecognized option 'hls_version'`. The
> library now guarantees correct flag ordering internally.

---

<a name="two-pass-encoding"></a>

## Two-Pass Encoding

```ts
import { twoPassEncode, buildTwoPassArgs } from 'mediaforge';

await twoPassEncode({
  input: 'input.mp4',
  output: 'output.mp4',
  videoCodec: 'libx264',
  videoBitrate: '2M',
  audioCodec: 'aac',
  audioBitrate: '128k',
  onPass1Complete: () => console.log('Pass 1 done'),
});

// Inspect args without running
const { pass1, pass2 } = buildTwoPassArgs({
  input: 'input.mp4',
  output: 'output.mp4',
  videoCodec: 'libvpx-vp9',
  videoBitrate: '1.5M',
});
```

---


---

<a name="arg-builders"></a>

## Arg-Builder Functions

Low-level helpers that return raw `string[]` arrays, useful when you need direct control over FFmpeg arguments. Each one corresponds to a high-level helper but exposes the underlying argument array.

```ts
import {
  buildScreenshotArgs, buildFrameBufferArgs, buildExtractFramesArgs, buildTimestampFilename,
  buildConcatList, buildConcatTransitionArgs,
  buildHlsArgs, buildDashArgs,
  buildGifArgs, buildGifPalettegenFilter, buildGifPaletteuseFilter,
  buildMetadataArgs, buildChapterContent,
  buildPipeThroughArgs, buildStreamOutputArgs,
  buildWatermarkFilter, buildTextWatermarkFilter,
  buildBurnSubtitlesFilter, buildBurnTimecodeFilter,
  buildWaveformFilter, buildSpectrumFilter,
  buildLoudnormFilter, buildSilenceDetectFilter,
  buildSceneSelectFilter,
} from 'mediaforge';

// Screenshot
const args = buildScreenshotArgs('input.mp4', 'thumb.jpg', 3, '320x180');
// → ['-y', '-ss', '3', '-i', 'input.mp4', '-s', '320x180', '-vframes', '1', 'thumb.jpg']

// Pipe a frame as raw bytes (e.g. for on-the-fly image processing)
const args = buildFrameBufferArgs('input.mp4', 5, 'png');
// → [..., 'pipe:1']  ← reads from pipe, outputs raw PNG bytes

// GIF two-pass (palettegen + paletteuse)
const { pass1, pass2 } = buildGifArgs('input.mp4', 'palette.png', 'out.gif', 10, 320, 'bayer');

// Loudnorm filter string
const filter = buildLoudnormFilter(-23, 7, -2);
// → 'loudnorm=I=-23:LRA=7:tp=-2'

// Silence detect filter string
const filter = buildSilenceDetectFilter(-40, 1.0);
// → 'silencedetect=noise=-40dB:d=1'

// FFMETADATA chapter file content
const meta = buildChapterContent([
  { title: 'Intro', startSec: 0, endSec: 30 },
  { title: 'Main',  startSec: 30, endSec: 180 },
]);
```

---

<a name="stream-mapping-dsl"></a>

## Stream Mapping DSL

```ts
import {
  mapStream, mapAll, mapAllVideo, mapAllAudio, mapAllSubtitles,
  mapVideo, mapAudio, mapSubtitle, mapLabel, mapAVS,
  negateMap, setStreamMetadata, setMetadata, setDisposition,
  streamCodec, copyStream, remuxAll, mapDefaultStreams, copyAudioAndSubs,
  serializeSpecifier, ss,
} from 'mediaforge';

// Map all streams from input 0
await ffmpeg('input.mkv').output('out.mkv').addOutputOption(...mapAll(0)).run();

// Map specific stream types
await ffmpeg('input.mp4').output('out.mp4')
  .map(mapVideo(0, 0)[1])    // first video stream
  .map(mapAudio(0, 1)[1])    // second audio stream
  .videoCodec('copy').audioCodec('copy').run();

// Negate a mapping (exclude subtitle streams)
await ffmpeg('input.mkv').output('out.mp4')
  .map('0').addOutputOption(...negateMap('0:s'))
  .videoCodec('copy').audioCodec('copy').run();

// Remux all streams (copy everything)
await ffmpeg('input.mkv').output('out.mp4')
  .addOutputOption(...remuxAll()).run();

// Set stream metadata
await ffmpeg('in.mp4').output('out.mp4')
  .addOutputOption(...setStreamMetadata(0, 'a', 0, 'language', 'eng'))
  .addOutputOption(...setDisposition(0, 'a', 0, ['default']))
  .videoCodec('copy').audioCodec('copy').run();

// Map AVS (all three types at once)
const mapping = mapAVS(0);   // returns ['-map','0:v','-map','0:a','-map','0:s']

// Language-aware specifier
const eng = ss(0, 'a', 'eng');   // 0:a:language:eng
```

---

<a name="hardware-acceleration"></a>

## Hardware Acceleration

```ts
import { ffmpeg } from 'mediaforge';
import { nvencToArgs, vaapiToArgs } from 'mediaforge';

// NVENC (NVIDIA)
await ffmpeg('input.mp4')
  .hwAccel('cuda')
  .output('output.mp4')
  .addOutputOption(...nvencToArgs({ preset: 'p4', cq: 23 }, 'h264_nvenc'))
  .run();

// VAAPI (Intel/AMD on Linux)
await ffmpeg('input.mp4')
  .hwAccel('vaapi', { device: '/dev/dri/renderD128' })
  .output('output.mp4')
  .addOutputOption(...vaapiToArgs({}, 'h264_vaapi'))
  .run();

// Auto-select best available hardware
const builder = new FFmpegBuilder('input.mp4');
const bestHw = builder.selectHwaccel(['cuda', 'vaapi', 'videotoolbox']);
if (bestHw) builder.hwAccel(bestHw);
```

---


---

<a name="filter-graph-api"></a>

## Low-level Filter Graph API

For advanced complex filter graphs you can build nodes and links directly:

```ts
import {
  filterGraph, videoFilterChain, audioFilterChain,
  VideoFilterChain, AudioFilterChain, FilterChain, FilterGraph,
  GraphNode, GraphStream, serializeNode, serializeLink, pad, resetLabelCounter,
} from 'mediaforge';

// Simple chain — compose video filters step by step
const chain = videoFilterChain('scale=1280:720');
// chain.toString() → 'scale=1280:720'

// Filter graph — connect multiple streams with labels
const fg = filterGraph();
// Use pad() to create named stream labels
const inPad  = pad('0:v');   // toString() → '[0:v]'
const outPad = pad('vout');  // toString() → '[vout]'

// Serialize a graph node
const node = serializeNode({ name: 'scale', positional: [640, 360], named: {} });
// → 'scale=640:360'

// Serialize a filter link  → '[0:v]scale=640:360[vout]'
const link = serializeLink({ inputs: [inPad], filter: { name: 'scale', positional: [640, 360], named: {} }, outputs: [outPad] });

// Reset auto-label counter (labels are auto-generated as [v0], [v1] etc.)
resetLabelCounter();
```

---

<a name="filter-system"></a>

## Filter System

All filter functions work in two modes — chained (with a `FilterChain` first arg) or **standalone** (returning a serialized string directly):

```ts
import { scale, loudnorm } from 'mediaforge';

// Standalone — returns a filter string
const s = scale({ w: 320, h: 180 });          // 'scale=320:180'
const n = loudnorm({ i: -16, lra: 11 });      // 'loudnorm=i=-16:lra=11:...'

// Pass directly to .videoFilter() / .audioFilter()
await ffmpeg('input.mp4')
  .output('output.mp4')
  .videoFilter(scale({ w: 1280, h: 720 }))
  .audioFilter(loudnorm({ i: -23, lra: 7, tp: -2 }))
  .run();
```

`ScaleOptions` and `CropOptions` accept `w`/`h` shorthand for `width`/`height`.

```ts
import { scale, crop, overlay, drawtext, fade } from 'mediaforge';
import { volume, loudnorm, equalizer, atempo } from 'mediaforge';
import { FilterGraph, videoFilterChain, filterGraph } from 'mediaforge';

// Simple video filter
await ffmpeg('input.mp4')
  .output('output.mp4')
  .videoFilter(scale({ w: 1280, h: 720 }))
  .run();

// Audio filter
await ffmpeg('input.mp4')
  .output('output.mp4')
  .audioFilter(loudnorm({ i: -16, lra: 11, tp: -1.5 }))
  .run();

// Complex filter graph
const graph = filterGraph();
// Use .complexFilter() on builder for raw filter_complex strings
await ffmpeg('input.mp4')
  .complexFilter('[0:v]scale=1280:720[v];[0:a]volume=0.5[a]')
  .output('output.mp4')
  .map('[v]').map('[a]')
  .run();
```

**75 built-in filters**: `scale`, `crop`, `pad`, `overlay`, `drawtext`, `fps`, `setpts`, `trim`, `format`, `vflip`, `hflip`, `rotate`, `unsharp`, `gblur`, `eq`, `hue`, `colorbalance`, `yadif`, `thumbnail`, `select`, `concat`, `split`, `tile`, `colorkey`, `chromakey`, `subtitles`, `fade`, `zoompan`, `volume`, `loudnorm`, `equalizer`, `bass`, `treble`, `afade`, `amerge`, `amix`, `pan`, `aresample`, `dynaudnorm`, `compand`, `aecho`, `highpass`, `lowpass`, `silencedetect`, `rubberband`, `atempo`, `agate`, and more.

---

<a name="ffprobe-integration"></a>

## FFprobe Integration

```ts
import {
  probe, probeAsync, ProbeError,
  getVideoStreams, getAudioStreams,
  getDefaultVideoStream, getDefaultAudioStream,
  getMediaDuration, durationToMicroseconds,
  summarizeVideoStream, summarizeAudioStream,
  parseFrameRate, parseDuration, parseBitrate,
  isHdr, isInterlaced, getChapterList,
  findStreamByLanguage, formatDuration,
  getSubtitleStreams, getStreamLanguage,
} from 'mediaforge';

// Synchronous probe
const info = probe('video.mp4');
console.log(info.format?.duration);   // "120.042000"
console.log(info.streams[0]?.codec_name); // "h264"

// Async probe
const info = await probeAsync('video.mp4');

// Helpers
const videoStreams = getVideoStreams(info);
const audioStreams = getAudioStreams(info);
const duration = getMediaDuration(info);           // seconds
const us = durationToMicroseconds(duration!);      // microseconds

const videoSummary = summarizeVideoStream(getDefaultVideoStream(info)!);
// { codec: 'h264', width: 1920, height: 1080, fps: 30, bitrate: 4000000, ... }

console.log(isHdr(info));        // true/false
console.log(isInterlaced(info)); // true/false
console.log(getChapterList(info)); // [{ title, startSec, endSec }]

const engAudio = findStreamByLanguage(info, 'eng', 'audio');
```

---

<a name="process-management"></a>

## Process Management

```ts
import { renice, autoKillOnExit, killAllFFmpeg } from 'mediaforge';

// Lower priority of running encode (Linux/macOS: -20 to 19, Windows: maps to priority class)
const proc = ffmpeg('input.mp4').output('out.mp4').spawn();
renice(proc.child, 10);  // lower priority — works on Linux, macOS, and Windows

// Auto-kill on process exit (prevents orphan ffmpeg processes)
// Listens to exit, SIGINT, SIGTERM — does NOT touch uncaughtException
const unregister = autoKillOnExit(proc.child);
proc.emitter.on('end', () => unregister());

// Emergency: kill all ffmpeg processes on this machine (Linux/macOS/Windows)
killAllFFmpeg('SIGTERM');
```

---

<a name="progress-events"></a>

## Progress Events

```ts
import { ffmpeg } from 'mediaforge';

const proc = ffmpeg('input.mp4')
  .output('output.mp4')
  .videoCodec('libx264')
  .enableProgress()
  .spawn({ parseProgress: true });

proc.emitter.on('start',    (args) => console.log('Started:', args));
proc.emitter.on('progress', (info) => {
  console.log(`${info.percent?.toFixed(1)}% — fps: ${info.fps} — speed: ${info.speed}x`);
});
proc.emitter.on('stderr',   (line) => { /* raw stderr line */ });
proc.emitter.on('end',      ()     => console.log('Done'));
proc.emitter.on('error',    (err)  => console.error(err));

await new Promise((res, rej) => {
  proc.emitter.on('end', res);
  proc.emitter.on('error', rej);
});
```

---


<a name="deno-bun-usage"></a>

## Deno & Bun Usage

```ts
// Deno — import from JSR
import { ffmpeg, probe, screenshots } from "jsr:@globaltech/mediaforge";

// Transcode (requires --allow-run=ffmpeg --allow-read --allow-write)
await ffmpeg("input.mp4")
  .output("output.mp4")
  .videoCodec("libx264")
  .audioBitrate("128k")
  .run();

// Probe a file
const info = probe("video.mp4");
console.log(info.format?.duration);

// Screenshots
const { files } = await screenshots({ input: "video.mp4", folder: "./thumbs", count: 5 });
```

Deno permissions required:
```bash
deno run --allow-run=ffmpeg,ffprobe --allow-read --allow-write your-script.ts
```

```ts
// Bun — same API as Node.js
import { ffmpeg } from "mediaforge";

await ffmpeg("input.mp4")
  .output("output.mp4")
  .videoCodec("libx264")
  .run();
```

---

<a name="cli"></a>

## CLI

```bash
# Transcode
mediaforge -i input.mp4 -c:v libx264 -b:v 2M -c:a aac output.mp4

# Probe a file
mediaforge probe video.mp4

# List capabilities
mediaforge caps --codecs
mediaforge caps --filters
mediaforge caps --formats
mediaforge caps --hwaccels

# Show version
mediaforge version
```

---

<a name="compatibility-guards"></a>

## Compatibility Guards

```ts
import {
  guardCodec, guardHwaccel, guardFeatureVersion,
  selectBestCodec, selectBestHwaccel, assertCodec,
  CapabilityRegistry, getDefaultRegistry,
} from 'mediaforge';

// Check codec / hwaccel availability at runtime
guardCodec(registry, 'libx264', 'encode');       // → { available: boolean, reason?: string }
guardHwaccel(registry, 'cuda');                   // → { available: boolean }
assertCodec(registry, 'libx264', 'encode');       // throws GuardError if unavailable

// Auto-select best available codec from priority list
selectBestCodec(version, registry, [
  { codec: 'h264_nvenc', featureKey: 'nvenc' },
  { codec: 'h264_vaapi' },
  { codec: 'libx264' },                           // software fallback
]);

// Auto-select best hardware accelerator
selectBestHwaccel(registry, ['cuda', 'vaapi', 'videotoolbox']);

// Access the runtime capability registry directly
const registry = getDefaultRegistry('ffmpeg');    // or pass explicit path, e.g. '/usr/local/bin/ffmpeg'
const custom = new CapabilityRegistry('ffmpeg');  // custom binary path
console.log(registry.hasCodec('libx264'));        // true
console.log(registry.canEncode('libx264'));       // true
console.log(registry.hasFilter('scale'));         // true
console.log(registry.encoders.size);             // 80+ encoders on standard FFmpeg builds
```

```ts
import { FFmpegBuilder } from 'mediaforge';
const builder = new FFmpegBuilder();

// Builders expose selectHwaccel() to pick the best available hardware
const builder = new FFmpegBuilder('input.mp4');
const hwaccel = builder.selectHwaccel(['cuda', 'vaapi', 'videotoolbox', 'none']);
console.log(hwaccel); // 'cuda' | 'vaapi' | null (if none of them available)

// For codec selection use the standalone selectBestCodec()
const codec = selectBestCodec(liveVersion, registry, [
  { codec: 'h264_nvenc', featureKey: 'nvenc' },
  { codec: 'h264_vaapi' },
  { codec: 'libx264' },   // software fallback
]);
```

---

<a name="version-support"></a>

## Version Support

| FFmpeg Version | Support |
|---------------|---------|
| v8.x | ✅ Full |
| v7.x | ✅ Full |
| v6.x | ✅ Full (note: `levels` filter not available in v6; use `curves` instead) |
| v5.x and below | ⚠️ Partial |

Tested with Node.js 20, 22, 24.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FFMPEG_PATH` | `ffmpeg` | Path to ffmpeg binary |
| `FFPROBE_PATH` | `ffprobe` | Path to ffprobe binary |

----

## 🤝 Contributing

Contributions, issues and feature requests are welcome! Feel free to open an [issue](https://github.com/GlobalTechInfo/mediaforge/issues) or submit a pull request.

---

## 📄 License

Distributed under the MIT License. See [`LICENSE`](https://github.com/GlobalTechInfo/mediaforge/blob/main/LICENSE) for more information.

---
