/**
 * Task-oriented CLI commands.
 *
 * The raw ffmpeg flag passthrough that the main entry point handles is fine for
 * one-off encodes, but it re-exposes the parts of ffmpeg that never needed a
 * wrapper while hiding every helper this library actually provides. These
 * commands are the other half of the CLI: `mediaforge hls`, `mediaforge trim`,
 * `mediaforge chapters`, and so on.
 */
import * as m from '../index.ts';
import { EXTRA_TASKS } from './tasks.extra.ts';
import { bool, list, num, str } from './flags.ts';
import type { CliFlags, CliTask } from './types.ts';

export type { CliFlags, CliTask };

function require1(pos: string[], task: string, n: number): string[] {
  if (pos.length < n) {
    throw new Error(`${task} needs ${n} argument${n === 1 ? '' : 's'}. Usage: ${CLI_TASKS[task]?.usage ?? task}`);
  }
  return pos;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

const TASKS: Record<string, CliTask> = {
  trim: {
    name: 'trim',
    summary: 'Cut a clip between two timestamps',
    usage: 'mediaforge trim <input> <output> [--start <sec>] [--end <sec>] [--duration <sec>]',
    flags: { start: '=start time in seconds', end: '=end time in seconds', duration: '=duration in seconds' },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = require1(pos, 'trim', 2);
      await m.trimVideo({
        input: input!, output: output!,
        ...(num(f, 'start') !== undefined ? { start: num(f, 'start')! } : {}),
        ...(num(f, 'end') !== undefined ? { end: num(f, 'end')! } : {}),
        ...(num(f, 'duration') !== undefined ? { duration: num(f, 'duration')! } : {}),
      });
      console.log(`Wrote ${output}`);
    },
  },

  speed: {
    name: 'speed',
    summary: 'Change playback speed (pitch-corrected for audio)',
    usage: 'mediaforge speed <input> <output> --factor <n>',
    flags: { factor: '=speed multiplier, e.g. 2 for double speed' },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = require1(pos, 'speed', 2);
      const factor = num(f, 'factor');
      if (factor === undefined) throw new Error('speed requires --factor');
      await m.changeSpeed({ input: input!, output: output!, speed: factor });
      console.log(`Wrote ${output}`);
    },
  },

  volume: {
    name: 'volume',
    summary: 'Scale audio volume',
    usage: 'mediaforge volume <input> <output> --gain <n>',
    flags: { gain: '=linear gain, e.g. 0.5 for half volume' },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = require1(pos, 'volume', 2);
      const volume = num(f, 'gain');
      if (volume === undefined) throw new Error('volume requires --gain');
      await m.adjustVolume({ input: input!, output: output!, volume: String(volume) });
      console.log(`Wrote ${output}`);
    },
  },

  normalize: {
    name: 'normalize',
    summary: 'Two-pass EBU R128 loudness normalisation',
    usage: 'mediaforge normalize <input> <output> [--target <lufs>]',
    flags: { target: '=target integrated loudness in LUFS (default -14)' },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = require1(pos, 'normalize', 2);
      const target = num(f, 'target');
      const res = await m.normalizeAudio({
        input: input!, output: output!,
        ...(target !== undefined ? { targetI: target } : {}),
      });
      console.log(`Wrote ${output}`);
      console.log(`  measured I=${res.inputI} LUFS, LRA=${res.inputLra} LU, TP=${res.inputTp} dBTP`);
    },
  },

  extract: {
    name: 'extract',
    summary: 'Extract the audio track',
    usage: 'mediaforge extract <input> <output>',
    flags: {},
    positionals: ['input', 'output'],
    async run(pos) {
      const [input, output] = require1(pos, 'extract', 2);
      await m.extractAudio({ input: input!, output: output! });
      console.log(`Wrote ${output}`);
    },
  },

  'replace-audio': {
    name: 'replace-audio',
    summary: 'Swap a video\'s audio for another file',
    usage: 'mediaforge replace-audio <video> <audio> <output>',
    flags: {},
    positionals: ['video', 'audio', 'output'],
    async run(pos) {
      const [video, audio, output] = require1(pos, 'replace-audio', 3);
      await m.replaceAudio({ video: video!, audio: audio!, output: output! });
      console.log(`Wrote ${output}`);
    },
  },

  concat: {
    name: 'concat',
    summary: 'Concatenate files without re-encoding when possible',
    usage: 'mediaforge concat <output> --inputs a.mp4,b.mp4 [--reencode]',
    flags: { inputs: '=comma-separated input files', reencode: '=force a re-encode' },
    positionals: ['output'],
    async run(pos, f) {
      const [output] = require1(pos, 'concat', 1);
      const inputs = list(f, 'inputs');
      if (inputs.length < 2) throw new Error('concat requires --inputs with at least two files');
      // `--reencode` is the user-facing inverse of the `copy` option.
      // concatFiles resolves once the process is spawned, so the re-encode path
      // (which needs the concat filter) is still running when it returns — wait
      // for it or the command reports "Wrote" before the file exists.
      const proc = await m.concatFiles({ inputs, output: output!, copy: !bool(f, 'reencode') });
      await settleProcess(proc);
      console.log(`Wrote ${output}`);
    },
  },

  transitions: {
    name: 'transitions',
    summary: 'Concatenate clips with xfade transitions',
    usage: 'mediaforge transitions <output> --inputs a.mp4,b.mp4 [--transition fade] [--duration 0.5] [--fps 30] [--resolution 1280x720]',
    flags: {
      inputs: '=comma-separated input files',
      transition: '=xfade transition name (default fade)',
      duration: '=transition length in seconds',
      fps: '=output frame rate', resolution: '=output resolution, e.g. 1280x720',
    },
    positionals: ['output'],
    async run(pos, f) {
      const [output] = require1(pos, 'transitions', 1);
      const inputs = list(f, 'inputs');
      if (inputs.length < 2) throw new Error('transitions requires --inputs with at least two files');
      await m.concatWithTransitions({
        inputs, output: output!,
        transition: (str(f, 'transition') ?? 'fade') as m.TransitionType,
        ...(num(f, 'duration') !== undefined ? { duration: num(f, 'duration')! } : {}),
        ...(str(f, 'fps') !== undefined ? { fps: str(f, 'fps')! } : {}),
        ...(str(f, 'resolution') !== undefined ? { resolution: str(f, 'resolution')! } : {}),
      });
      console.log(`Wrote ${output}`);
    },
  },

  hls: {
    name: 'hls',
    summary: 'Package a single-bitrate HLS stream',
    usage: 'mediaforge hls <input> --outdir ./hls [--segment 6] [--bitrate 2M] [--audio 128k] [--hls-version 7]',
    flags: {
      outdir: '=output directory', segment: '=segment length in seconds',
      bitrate: '=video bitrate', audio: '=audio bitrate', 'hls-version': '=HLS version 3-8',
    },
    positionals: ['input'],
    async run(pos, f) {
      const [input] = require1(pos, 'hls', 1);
      const outdir = str(f, 'outdir');
      if (!outdir) throw new Error('hls requires --outdir');
      await m.hlsPackage({
        input: input!, outputDir: outdir,
        ...(num(f, 'segment') !== undefined ? { segmentDuration: num(f, 'segment')! } : {}),
        ...(str(f, 'bitrate') !== undefined ? { videoBitrate: str(f, 'bitrate')! } : {}),
        ...(str(f, 'audio') !== undefined ? { audioBitrate: str(f, 'audio')! } : {}),
        ...(num(f, 'hls-version') !== undefined ? { hlsVersion: num(f, 'hls-version')! } : {}),
      }).run();
      console.log(`HLS written to ${outdir}`);
    },
  },

  abr: {
    name: 'abr',
    summary: 'Build a multi-bitrate HLS ladder with -var_stream_map',
    usage: 'mediaforge abr <input> --out "v%v/index.m3u8" --variants name=WxH:bitrate,...',
    flags: { out: '=output pattern containing %v', variants: '=name=1920x1080:4M,name=1280x720:2M' },
    positionals: ['input'],
    async run(pos, f) {
      const [input] = require1(pos, 'abr', 1);
      const out = str(f, 'out');
      if (!out) throw new Error('abr requires --out');
      const raw = list(f, 'variants');
      if (raw.length === 0) throw new Error('abr requires --variants');
      const variants = raw.map(spec => {
        const [name, rest] = spec.split('=');
        if (!name || !rest) throw new Error(`abr: variant "${spec}" must look like name=WxH:bitrate`);
        const [resolution, videoBitrate] = rest.split(':');
        return { name: name!, resolution: resolution ?? '', videoBitrate: videoBitrate ?? '' };
      });
      await m.abrLadder({ input: input!, outputPattern: out, variants }).run();
      console.log(`ABR ladder written to ${out}`);
    },
  },

  dash: {
    name: 'dash',
    summary: 'Package a DASH manifest',
    usage: 'mediaforge dash <input> <output.mpd> [--segment 6] [--bitrate 2M]',
    flags: { segment: '=segment length in seconds', bitrate: '=video bitrate' },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = require1(pos, 'dash', 2);
      await m.dashPackage({
        input: input!, output: output!,
        ...(num(f, 'segment') !== undefined ? { segmentDuration: num(f, 'segment')! } : {}),
        ...(str(f, 'bitrate') !== undefined ? { videoBitrate: str(f, 'bitrate')! } : {}),
      }).run();
      console.log(`Wrote ${output}`);
    },
  },

  segments: {
    name: 'segments',
    summary: 'Split a file into fixed-length segments',
    usage: 'mediaforge segments <input> --pattern "seg%03d.ts" [--segment 2]',
    flags: { pattern: '=output pattern containing %', segment: '=segment length in seconds' },
    positionals: ['input'],
    async run(pos, f) {
      const [input] = require1(pos, 'segments', 1);
      const pattern = str(f, 'pattern');
      if (!pattern) throw new Error('segments requires --pattern');
      await m.writeSegments({
        input: input!, outputPattern: pattern,
        ...(num(f, 'segment') !== undefined ? { segmentTime: num(f, 'segment')! } : {}),
      });
      console.log(`Segments written matching ${pattern}`);
    },
  },

  chapters: {
    name: 'chapters',
    summary: 'Write chapter markers',
    usage: 'mediaforge chapters <input> <output> --chapters "Intro:0,Main:120"',
    flags: { chapters: '=comma-separated title:startSeconds pairs' },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = require1(pos, 'chapters', 2);
      const raw = list(f, 'chapters');
      if (raw.length === 0) throw new Error('chapters requires --chapters');
      const chapters = raw.map(spec => {
        const idx = spec.lastIndexOf(':');
        if (idx <= 0) throw new Error(`chapters: "${spec}" must look like title:startSeconds`);
        const start = Number(spec.slice(idx + 1));
        if (!Number.isFinite(start)) throw new Error(`chapters: "${spec}" has a non-numeric start time`);
        return { title: spec.slice(0, idx), start };
      });
      await m.addChapters({ input: input!, output: output!, chapters });
      console.log(`Wrote ${output}`);
    },
  },

  metadata: {
    name: 'metadata',
    summary: 'Write or strip global metadata',
    usage: 'mediaforge metadata <input> <output> --set title=My\\ Film [--strip]',
    flags: { set: '=comma-separated key=value pairs', strip: '=strip all metadata instead' },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = require1(pos, 'metadata', 2);
      if (bool(f, 'strip')) {
        await m.stripMetadata({ input: input!, output: output! });
        console.log(`Wrote ${output}`);
        return;
      }
      const pairs = list(f, 'set');
      if (pairs.length === 0) throw new Error('metadata requires --set or --strip');
      const metadata: Record<string, string> = {};
      for (const p of pairs) {
        const idx = p.indexOf('=');
        if (idx <= 0) throw new Error(`metadata: "${p}" must look like key=value`);
        metadata[p.slice(0, idx)] = p.slice(idx + 1);
      }
      await m.writeMetadata({ input: input!, output: output!, metadata });
      console.log(`Wrote ${output}`);
    },
  },

  thumbnail: {
    name: 'thumbnail',
    summary: 'Extract a single frame to an image file',
    usage: 'mediaforge thumbnail <input> <output> [--at 3] [--size 320x180] [--format png]',
    flags: {
      at: '=timestamp in seconds', size: '=output size, e.g. 320x180',
      format: '=png|mjpeg|bmp (default: taken from the output extension)',
    },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = require1(pos, 'thumbnail', 2);
      // frameToBuffer defaults to PNG, so writing to a .jpg path would produce
      // a PNG under a JPEG name. Take the format from --format when given and
      // otherwise from the output extension.
      const explicit = str(f, 'format');
      const ext = (explicit ?? output!.split('.').pop() ?? '').toLowerCase();
      const format = ext === 'jpg' || ext === 'jpeg' ? 'mjpeg' : ext === 'bmp' ? 'bmp' : 'png';
      if (explicit !== undefined && !['png', 'mjpeg', 'bmp', 'jpg', 'jpeg'].includes(ext)) {
        throw new Error(`thumbnail --format must be png, jpg/jpeg or bmp, got "${explicit}"`);
      }
      const buf = await m.frameToBuffer({
        input: input!,
        timestamp: num(f, 'at') ?? 0,
        format,
        ...(str(f, 'size') !== undefined ? { size: str(f, 'size')! } : {}),
      });
      const { writeFileSync } = await import('node:fs');
      writeFileSync(output!, buf);
      console.log(`Wrote ${output}`);
    },
  },

  sprite: {
    name: 'sprite',
    summary: 'Build a thumbnail sprite sheet',
    usage: 'mediaforge sprite <input> <output.png> [--columns 5] [--count 25] [--width 160]',
    flags: { columns: '=tiles per row', count: '=total tiles', width: '=tile width' },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = require1(pos, 'sprite', 2);
      await m.generateSprite({
        input: input!, output: output!,
        ...(num(f, 'columns') !== undefined ? { columns: num(f, 'columns')! } : {}),
        ...(num(f, 'count') !== undefined ? { count: num(f, 'count')! } : {}),
        ...(num(f, 'width') !== undefined ? { thumbWidth: num(f, 'width')! } : {}),
      });
      console.log(`Wrote ${output}`);
    },
  },

  frames: {
    name: 'frames',
    summary: 'Extract frames as images',
    usage: 'mediaforge frames <input> --outdir ./out [--fps 1] [--format png]',
    flags: { outdir: '=output directory', fps: '=frames per second', format: '=image format (png/jpg)' },
    positionals: ['input'],
    async run(pos, f) {
      const [input] = require1(pos, 'frames', 1);
      const outdir = str(f, 'outdir');
      if (!outdir) throw new Error('frames requires --outdir');
      const res = await m.extractFrames({
        input: input!,
        folder: outdir,
        filename: `frame_%05d.${str(f, 'format') ?? 'png'}`,
        fps: str(f, 'fps') ?? '1',
      });
      console.log(`Extracted ${res.files.length} frame(s) to ${outdir}`);
    },
  },

  gif: {
    name: 'gif',
    summary: 'Convert a video to an animated GIF',
    usage: 'mediaforge gif <input> <output.gif> [--fps 15] [--width 480] [--colors 128]',
    flags: { fps: '=frames per second', width: '=output width', colors: '=palette size' },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = require1(pos, 'gif', 2);
      await m.toGif({
        input: input!, output: output!,
        ...(num(f, 'fps') !== undefined ? { fps: num(f, 'fps')! } : {}),
        ...(num(f, 'width') !== undefined ? { width: num(f, 'width')! } : {}),
        ...(num(f, 'colors') !== undefined ? { colors: num(f, 'colors')! } : {}),
      });
      console.log(`Wrote ${output}`);
    },
  },

  watermark: {
    name: 'watermark',
    summary: 'Overlay a watermark image',
    usage: 'mediaforge watermark <input> <logo.png> <output> [--position bottom-right] [--opacity 0.7] [--margin 20] [--width 200]',
    flags: {
      position: '=top-left|top-right|top-center|bottom-left|bottom-right|bottom-center|center',
      margin: '=margin in pixels', opacity: '=0-1', width: '=scale watermark to this width',
    },
    positionals: ['input', 'watermark', 'output'],
    async run(pos, f) {
      const [input, logo, output] = require1(pos, 'watermark', 3);
      await m.addWatermark({
        input: input!, watermark: logo!, output: output!,
        ...(str(f, 'position') !== undefined ? { position: str(f, 'position')! } : {}),
        ...(num(f, 'margin') !== undefined ? { margin: num(f, 'margin')! } : {}),
        ...(num(f, 'opacity') !== undefined ? { opacity: num(f, 'opacity')! } : {}),
        ...(num(f, 'width') !== undefined ? { scaleWidth: num(f, 'width')! } : {}),
      });
      console.log(`Wrote ${output}`);
    },
  },

  text: {
    name: 'text',
    summary: 'Burn a text watermark into a video',
    usage: 'mediaforge text <input> <output> --text "Hello" [--position bottom-right] [--margin 20] [--size 48] [--color white] [--font /path/to.ttf]',
    flags: {
      text: '=text to draw', position: '=position', margin: '=margin in pixels',
      size: '=font size', color: '=font colour', font: '=font file path',
    },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = require1(pos, 'text', 2);
      const text = str(f, 'text');
      if (!text) throw new Error('text requires --text');
      await m.addTextWatermark({
        input: input!, output: output!, text,
        ...(str(f, 'position') !== undefined ? { position: str(f, 'position')! } : {}),
        ...(num(f, 'margin') !== undefined ? { margin: num(f, 'margin')! } : {}),
        ...(num(f, 'size') !== undefined ? { fontSize: num(f, 'size')! } : {}),
        ...(str(f, 'color') !== undefined ? { fontColor: str(f, 'color')! } : {}),
        ...(str(f, 'font') !== undefined ? { fontFile: str(f, 'font')! } : {}),
      });
      console.log(`Wrote ${output}`);
    },
  },

  subtitles: {
    name: 'subtitles',
    summary: 'Burn subtitles in, or convert a subtitle track',
    usage: 'mediaforge subtitles <input> <output> [--file subs.srt] [--convert srt] [--stream 0] [--shift 1.5] [--fix-duration]',
    flags: {
      file: '=subtitle file to burn', convert: '=convert embedded track to this format',
      stream: '=subtitle stream index', shift: '=shift cue timings by N seconds',
      'fix-duration': '=rescale cue durations to match the video',
    },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = require1(pos, 'subtitles', 2);
      const file = str(f, 'file');
      if (file) {
        await m.burnSubtitles({ input: input!, subtitleFile: file, output: output! });
        console.log(`Wrote ${output}`);
        return;
      }
      const format = str(f, 'convert');
      if (!format) throw new Error('subtitles requires --file (to burn) or --convert (to convert a track)');
      await m.convertSubtitles({
        input: input!, output: output!, format: format as m.SubtitleFormat,
        streamIndex: num(f, 'stream') ?? 0,
        ...(num(f, 'shift') !== undefined ? { shiftSeconds: num(f, 'shift')! } : {}),
        ...(bool(f, 'fix-duration') !== undefined ? { fixDuration: bool(f, 'fix-duration')! } : {}),
      });
      console.log(`Wrote ${output}`);
    },
  },

  quality: {
    name: 'quality',
    summary: 'Measure VMAF / SSIM / PSNR of an encode against a reference',
    usage: 'mediaforge quality <reference> <distorted> [--metric vmaf] [--min 90]',
    flags: { metric: '=vmaf|ssim|psnr (default vmaf)', min: '=fail unless the score reaches this' },
    positionals: ['reference', 'distorted'],
    async run(pos, f) {
      const [reference, distorted] = require1(pos, 'quality', 2);
      const metric = (str(f, 'metric') ?? 'vmaf') as m.QualityMetric;
      const score = await m.measureQuality({
        reference: reference!, distorted: distorted!, metric,
        ...(num(f, 'min') !== undefined ? { minScore: num(f, 'min')! } : {}),
      });
      console.log(`${score.metric}: ${score.value.toFixed(4)}${score.frames !== undefined ? ` over ${score.frames} frames` : ''}`);
    },
  },

  tonemap: {
    name: 'tonemap',
    summary: 'Tone-map an HDR file down to SDR',
    usage: 'mediaforge tonemap <input> <output> [--algorithm hable] [--peak 1000] [--desat 0.6] [--force]',
    flags: {
      algorithm: '=hable|mobius|reinhard|clip|linear|spline (default mobius)',
      peak: '=source peak luminance in nits (default 1000)', desat: '=desaturation 0-1',
      force: '=tone map even if the input does not look like HDR',
    },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = require1(pos, 'tonemap', 2);
      await m.toneMapHdrToSdr({
        input: input!, output: output!,
        algorithm: (str(f, 'algorithm') ?? 'mobius') as m.ToneMapAlgorithm,
        ...(num(f, 'peak') !== undefined ? { peak: num(f, 'peak')! } : {}),
        ...(num(f, 'desat') !== undefined ? { desaturation: num(f, 'desat')! } : {}),
        // `--force` means "tone map it even though it does not look like HDR",
        // which is the inverse of requireHdrInput.
        ...(bool(f, 'force') !== undefined ? { requireHdrInput: !bool(f, 'force')! } : {}),
      });
      console.log(`Wrote ${output}`);
    },
  },

  interpolate: {
    name: 'interpolate',
    summary: 'Motion-compensated frame interpolation (slow motion, 24→60)',
    usage: 'mediaforge interpolate <input> <output> --fps 60 [--method mci]',
    flags: { fps: '=target frame rate', method: '=mci|blend|dup (default mci)' },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = require1(pos, 'interpolate', 2);
      const fps = num(f, 'fps');
      if (fps === undefined) throw new Error('interpolate requires --fps');
      await m.interpolateFrames({
        input: input!, output: output!, fps,
        method: (str(f, 'method') ?? 'mci') as m.InterpolationMethod,
      });
      console.log(`Wrote ${output}`);
    },
  },

  silence: {
    name: 'silence',
    summary: 'Remove silent stretches (or just report them with --detect)',
    usage: 'mediaforge silence <input> <output> [--threshold -50] [--min 0.5] [--detect] [--video]',
    flags: {
      threshold: '=dB threshold', min: '=minimum silence length in seconds',
      detect: '=report the silent ranges instead of cutting them', video: '=drop the audio track',
    },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = require1(pos, 'silence', 2);
      const threshold = num(f, 'threshold') ?? -50;
      const minDuration = num(f, 'min') ?? 0.5;
      if (bool(f, 'detect')) {
        const segs = await m.detectSilence({ input: input!, threshold, duration: minDuration });
        console.log(`${segs.length} silent segment(s):`);
        for (const s of segs) console.log(`  ${s.start.toFixed(2)} → ${s.end.toFixed(2)} (${s.duration.toFixed(2)}s)`);
        return;
      }
      await m.removeSilence({
        input: input!, output: output!, threshold, minDuration,
        ...(bool(f, 'video') !== undefined ? { videoOnly: bool(f, 'video')! } : {}),
      });
      console.log(`Wrote ${output}`);
    },
  },

  scenes: {
    name: 'scenes',
    summary: 'Detect scene changes, or auto-cut on them',
    usage: 'mediaforge scenes <input> [output] [--threshold 0.4] [--cut]',
    flags: { threshold: '=detection threshold 0-1', cut: '=write one clip per scene to output' },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = require1(pos, 'scenes', 1);
      const threshold = num(f, 'threshold') ?? 0.4;
      if (bool(f, 'cut')) {
        if (!output) throw new Error('scenes --cut requires an output path');
        await m.cutToScenes({ input: input!, output: output!, threshold });
        console.log(`Wrote ${output}`);
        return;
      }
      const scenes = await m.detectScenes({ input: input!, threshold });
      console.log(`${scenes.length} scene change(s):`);
      for (const s of scenes) console.log(`  scene ${s.sceneNumber} at ${s.timestamp.toFixed(3)}s`);
    },
  },

  waveform: {
    name: 'waveform',
    summary: 'Render a waveform image',
    usage: 'mediaforge waveform <input> <output.png> [--width 1920] [--height 240] [--color cyan] [--scale log]',
    flags: { width: '=image width', height: '=image height', color: '=CSS colour', scale: '=lin|log' },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = require1(pos, 'waveform', 2);
      await m.generateWaveform({
        input: input!, output: output!,
        ...(num(f, 'width') !== undefined ? { width: num(f, 'width')! } : {}),
        ...(num(f, 'height') !== undefined ? { height: num(f, 'height')! } : {}),
        ...(str(f, 'color') !== undefined ? { color: str(f, 'color')! } : {}),
        ...(str(f, 'scale') !== undefined ? { scale: str(f, 'scale') as 'lin' | 'log' } : {}),
      });
      console.log(`Wrote ${output}`);
    },
  },

  spectrum: {
    name: 'spectrum',
    summary: 'Render a spectrum visualiser video',
    usage: 'mediaforge spectrum <input> <output.mp4> [--palette fire] [--width 1280] [--height 720]',
    flags: { palette: '=showspectrum palette name', width: '=video width', height: '=video height' },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = require1(pos, 'spectrum', 2);
      await m.generateSpectrum({
        input: input!, output: output!,
        ...(str(f, 'palette') !== undefined ? { color: str(f, 'palette') as m.SpectrumColor } : {}),
        ...(num(f, 'width') !== undefined ? { width: num(f, 'width')! } : {}),
        ...(num(f, 'height') !== undefined ? { height: num(f, 'height')! } : {}),
      });
      console.log(`Wrote ${output}`);
    },
  },

  delogo: {
    name: 'delogo',
    summary: 'Blur out a rectangular region (station logo, clock)',
    usage: 'mediaforge delogo <input> <output> --x 10 --y 10 --width 120 --height 40',
    flags: { x: '=region left', y: '=region top', width: '=region width', height: '=region height' },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = require1(pos, 'delogo', 2);
      for (const k of ['x', 'y', 'width', 'height'] as const) {
        if (num(f, k) === undefined) throw new Error(`delogo requires --${k}`);
      }
      await m.ffmpeg(input!)
        .output(output!)
        .videoFilter(m.delogo({ x: num(f, 'x')!, y: num(f, 'y')!, width: num(f, 'width')!, height: num(f, 'height')! }))
        .run();
      console.log(`Wrote ${output}`);
    },
  },

  twopass: {
    name: 'twopass',
    summary: 'Two-pass bitrate-targeted encode',
    usage: 'mediaforge twopass <input> <output> --bitrate 2M [--codec libx264] [--audio aac]',
    flags: { bitrate: '=target video bitrate', codec: '=video codec (default libx264)', audio: '=audio codec' },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = require1(pos, 'twopass', 2);
      const videoBitrate = str(f, 'bitrate');
      if (!videoBitrate) throw new Error('twopass requires --bitrate');
      await m.twoPassEncode({
        input: input!, output: output!, videoBitrate,
        videoCodec: str(f, 'codec') ?? 'libx264',
        ...(str(f, 'audio') !== undefined ? { audioCodec: str(f, 'audio')! } : {}),
      });
      console.log(`Wrote ${output}`);
    },
  },

  'to-bitrate': {
    name: 'to-bitrate',
    summary: 'Re-encode to a target bitrate',
    usage: 'mediaforge to-bitrate <input> <output> --bitrate 2M [--crf 23] [--codec libx264] [--audio aac] [--preset medium] [--fps 30] [--size 1280x720] [--maxrate 2500k] [--bufsize 5000k]',
    flags: {
      bitrate: '=target video bitrate', crf: '=constant-quality value',
      codec: '=video codec (default libx264)', audio: '=audio codec', preset: '=encoder preset',
      fps: '=frame rate', size: '=output size', maxrate: '=max bitrate', bufsize: '=buffer size',
    },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = require1(pos, 'to-bitrate', 2);
      const b = m.ffmpeg(input!).output(output!)
        .videoCodec(str(f, 'codec') ?? 'libx264')
        .audioCodec(str(f, 'audio') ?? 'aac');
      if (str(f, 'bitrate')) b.videoBitrate(str(f, 'bitrate')!);
      if (num(f, 'crf') !== undefined) b.crf(num(f, 'crf')!);
      if (str(f, 'preset')) b.preset(str(f, 'preset')!);
      if (str(f, 'fps')) b.fps(str(f, 'fps')!);
      if (str(f, 'size')) b.size(str(f, 'size')!);
      if (str(f, 'maxrate')) {
        b.rateControl({ max: str(f, 'maxrate')!, bufferSize: str(f, 'bufsize') ?? str(f, 'maxrate')! });
      }
      await b.run();
      console.log(`Wrote ${output}`);
    },
  },
};

/** Resolve once an FFmpegProcess has finished, propagating any error. */
function settleProcess(proc: m.FFmpegProcess): Promise<void> {
  if (proc.child.exitCode !== null || proc.child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    proc.emitter.on('end', () => resolve());
    proc.emitter.on('error', (e: Error) => reject(e));
  });
}

/**
 * Every task command, keyed by name.
 *
 * `TASKS` holds the editing commands and `EXTRA_TASKS` the commands that
 * expose the rest of the library surface (filters, graphs, codecs, mapping,
 * presets, analysis, hardware chains and the pure arg builders). They are merged
 * here so `mediaforge help`, the unknown-flag check and the task tests all see
 * one table.
 */
const registry: Record<string, CliTask> = { ...TASKS };

/**
 * `tasks.extra.ts` imports the library barrel, and the barrel re-exports this
 * module, so the two form a cycle. Folding `EXTRA_TASKS` in when this module is
 * evaluated would therefore throw for a caller that entered the cycle through
 * `tasks.extra.ts`, so the merge happens on first access instead. The proxy keeps
 * `Object.keys`/`in`/`taskDetail` honest, and the registry object identity stays
 * stable across reads.
 */
const allTasks = (): Record<string, CliTask> => Object.assign(registry, EXTRA_TASKS);

export const CLI_TASKS: Record<string, CliTask> = new Proxy(registry, {
  get: (_t, k) => Reflect.get(allTasks(), k),
  has: (_t, k) => Reflect.has(allTasks(), k),
  ownKeys: () => Reflect.ownKeys(allTasks()),
  getOwnPropertyDescriptor: (_t, k) => Reflect.getOwnPropertyDescriptor(allTasks(), k),
});

/**
 * Parse `--flag value` / `--flag` / `-f value` arguments.
 *
 * A `--flag` immediately followed by another `--flag` is treated as boolean, so
 * `scenes in.mp4 --cut` works without a dummy value.
 */
export function parseTaskArgs(argv: string[]): { positional: string[]; flags: CliFlags } {
  const positional: string[] = [];
  const flags: CliFlags = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[body] = true;
    } else {
      flags[body] = next;
      i++;
    }
  }
  return { positional, flags };
}

/** Human-readable task listing, grouped for `mediaforge help`. */
export function taskHelpText(): string {
  const entries = Object.values(CLI_TASKS)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(t => `  ${t.name.padEnd(14)} ${t.summary}`);
  return `TASK COMMANDS\n${entries.join('\n')}`;
}

/** Detailed help for a single task. */
export function taskDetail(name: string): string {
  const t = CLI_TASKS[name];
  // Returning an empty string here would make `mediaforge help <typo>` print
  // nothing at all, which reads like a silent success.
  if (!t) {
    return `Unknown task command "${name}".\n\nRun \`mediaforge help\` for the list of task commands.`;
  }
  const flags = Object.entries(t.flags).map(([k, v]) => `  --${k.padEnd(16)} ${v}`).join('\n');
  return [
    t.usage,
    '',
    t.summary,
    flags ? `\nOPTIONS\n${flags}` : '',
  ].filter(Boolean).join('\n');
}
