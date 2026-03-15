<div align="center">

[![npm version](https://img.shields.io/npm/v/mediaforge.svg)](https://www.npmjs.com/package/mediaforge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![codecov](https://codecov.io/gh/GlobalTechInfo/mediaforge/branch/main/graph/badge.svg)](https://codecov.io/gh/GlobalTechInfo/mediaforge)
[![Code Quality](https://img.shields.io/codefactor/grade/github/GlobalTechInfo/mediaforge?style=flat-square&label=Code%20Quality)](https://www.codefactor.io/repository/github/GlobalTechInfo/mediaforge)
[![Downloads](https://img.shields.io/npm/dw/mediaforge?style=flat-square&label=Downloads&color=green)](https://npmjs.com/package/mediaforge)

</div>

# mediaforge

**Fully typed TypeScript wrapper for FFmpeg — fluent builder API, v6/v7/v8 compatible, zero native bindings**

---

## What is mediaforge?

`mediaforge` is a zero-dependency TypeScript library that wraps the system `ffmpeg` binary with a fluent, fully-typed API. No native bindings, no bundled binaries — it uses whatever `ffmpeg` is installed on the system.

```ts
import { ffmpeg } from 'mediaforge';

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

```bash
npm install mediaforge
```

Requires `ffmpeg` (and `ffprobe`) to be installed and on `PATH`, or set `FFMPEG_PATH` / `FFPROBE_PATH` environment variables.

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
```

---

<a name="pipe-stream-io"></a>

## Pipe & Stream I/O

```ts
import { pipeThrough, streamOutput, streamToFile } from 'mediaforge';
import fs from 'fs';

// Pipe: readable stream → ffmpeg → writable stream
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
  text: '© MyCompany 2025',
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
  backgroundColor: '#1a1a2e',
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

<a name="stream-mapping-dsl"></a>

## Stream Mapping DSL

```ts
import { mapStream, mapAVS, copyStream, setMetadata, ss } from 'mediaforge';

// Convenience helpers for complex mappings
const mapping = mapAVS(0);   // maps 0:v, 0:a, 0:s

// Language-aware mapping
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

<a name="filter-system"></a>

## Filter System

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

**54 built-in filters**: `scale`, `crop`, `pad`, `overlay`, `drawtext`, `fps`, `setpts`, `trim`, `format`, `vflip`, `hflip`, `rotate`, `unsharp`, `gblur`, `eq`, `hue`, `yadif`, `thumbnail`, `select`, `concat`, `split`, `tile`, `colorkey`, `chromakey`, `subtitles`, `fade`, `zoompan`, `volume`, `loudnorm`, `equalizer`, `bass`, `treble`, `afade`, `amerge`, `amix`, `pan`, `aresample`, `dynaudnorm`, `compand`, `aecho`, `highpass`, `lowpass`, `silencedetect`, `rubberband`, `atempo`, `agate`, and more.

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
import { guardCodec, guardFeatureVersion, selectBestCodec } from 'mediaforge';
import { FFmpegBuilder } from 'mediaforge';

const builder = new FFmpegBuilder();

// Check codec availability
const result = builder.checkCodec('libx264', 'encode');
if (!result.available) console.warn(result.reason);

// Auto-select best codec
const codec = await builder.selectVideoCodec([
  { codec: 'h264_nvenc', featureKey: 'nvenc' },
  { codec: 'h264_vaapi' },
  { codec: 'libx264' },   // fallback
]);
```

---

<a name="version-support"></a>

## Version Support

| FFmpeg Version | Support |
|---------------|---------|
| v8.x | ✅ Full |
| v7.x | ✅ Full |
| v6.x | ✅ Full |
| v5.x and below | ⚠️ Partial |

Tested with Node.js 18, 20, 22.

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
