import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnFFmpeg, runFFmpeg } from '../process/spawn.ts';
import { resolveBinary, resolveProbe } from '../utils/binary.ts';
import { probeAsync } from '../probe/ffprobe.ts';
import { getAudioStreams } from '../probe/ffprobe.ts';
import type { FFmpegProcess } from '../process/spawn.ts';

export interface MergeOptions {
  /** Input files to concatenate in order */
  inputs: string[];
  /** Output file path */
  output: string;
  /** If true, re-encode. If false (default), attempt stream copy */
  reencode?: boolean;
  /** Video codec when re-encoding. Default: 'libx264' */
  videoCodec?: string;
  /** Audio codec when re-encoding. Default: 'aac' */
  audioCodec?: string;
  /** Extra output args */
  extraArgs?: string[];
  /** ffmpeg binary override */
  binary?: string;
}

/**
 * Concatenate multiple video/audio files into one using the concat demuxer.
 * This is the fastest method (stream copy by default, no re-encode).
 *
 * @example
 * await mergeToFile({
 *   inputs: ['part1.mp4', 'part2.mp4', 'part3.mp4'],
 *   output: 'merged.mp4',
 * });
 */
export async function mergeToFile(opts: MergeOptions): Promise<void> {
  const {
    inputs,
    output,
    reencode = false,
    videoCodec = 'libx264',
    audioCodec = 'aac',
    extraArgs = [],
    binary = resolveBinary(),
  } = opts;

  if (inputs.length === 0) throw new Error('mergeToFile: no inputs provided');
  if (inputs.length === 1) {
    const src = inputs[0] as string;
    if (!fs.existsSync(src)) throw new Error(`mergeToFile: input file not found: "${src}"`);
    const outDir = path.dirname(path.resolve(output));
    fs.mkdirSync(outDir, { recursive: true });
    fs.copyFileSync(src, output);
    return;
  }

  // Write concat list file
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mediaforge-concat-'));
  const tmpList = path.join(tmpDir, 'ffmpeg-concat-list.txt');
  const sanitizedInputs = inputs.map(f => sanitizeConcatPath(f));
  const listContent = sanitizedInputs
    .map(f => `file '${f.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)
    .join('\n');
  fs.writeFileSync(tmpList, listContent);

  try {
    const args: string[] = ['-y', '-f', 'concat', '-safe', '0', '-i', tmpList];

    if (reencode) {
      args.push('-c:v', videoCodec, '-c:a', audioCodec);
    } else {
      args.push('-c', 'copy');
    }

    args.push(...extraArgs, output);
    await runFFmpeg({ binary, args });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export interface ConcatOptions {
  /** Input files to concatenate */
  inputs: string[];
  /** Output file path */
  output: string;
  /** Transition duration in seconds between clips (requires re-encode) */
  transitionDuration?: number;
  /** ffmpeg binary override */
  binary?: string;
}

/**
 * Build a concat filter_complex for re-encoding concatenation with optional transitions.
 * Returns an FFmpegProcess for event-based control.
 */
export interface ConcatFilesOptions extends ConcatOptions {
  /** Video codec for re-encode. Default: 'libx264' */
  videoCodec?: string;
  /** Audio codec for re-encode. Default: 'aac' */
  audioCodec?: string;
  /** If true, use stream copy instead of re-encoding */
  copy?: boolean;
}

export async function concatFiles(opts: ConcatFilesOptions): Promise<FFmpegProcess> {
  const {
    inputs,
    output,
    videoCodec = 'libx264',
    audioCodec = 'aac',
    copy: useCopy,
    binary = resolveBinary(),
  } = opts;

  // Build filter_complex — probe each input for audio presence to avoid
  // invalid `[i:a?]` placeholders in filtergraph pad names.
  if (inputs.length === 0) throw new Error('concatFiles requires at least one input');

  const n = inputs.length;
  const inputArgs: string[] = [];
  for (const inp of inputs) inputArgs.push('-i', inp);

  // `binary` is the FFMPEG path; probeAsync needs the FFPROBE path. Passing
  // ffmpeg here made every probe fail, so audio was always assumed present.
  const probeBin = resolveProbe();
  const hasAudio: boolean[] = [];
  for (const inp of inputs) {
    try {
      const result = await probeAsync(inp, { binary: probeBin });
      hasAudio.push(getAudioStreams(result).length > 0);
    } catch {
      // If probing fails, assume audio is present (conservative)
      hasAudio.push(true);
    }
  }

  let filterComplex = '';
  for (let i = 0; i < n; i++) {
    if (hasAudio[i]) {
      filterComplex += `[${i}:v][${i}:a]`;
    } else {
      // anullsrc is a SOURCE filter: it takes no inputs. The previous form
      // `[i:v]anullsrc[aN]` was invalid filtergraph syntax and always failed.
      filterComplex += `anullsrc=channel_layout=stereo:sample_rate=44100[a${i}]`;
    }
  }
  filterComplex += `concat=n=${n}:v=1:a=1[v][a]`;

  const args: string[] = [
    '-y',
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', '[v]',
    '-map', '[a]',
    // Stream copy cannot survive a filtergraph: ffmpeg decodes every frame to
    // run the concat filter and then rejects `-c copy` with "Filtering and
    // streamcopy cannot be used together". Since the concat filter is what
    // makes mixed-codec inputs work at all, copy mode has to go through the
    // concat demuxer instead, which needs no re-encode.
    ...(useCopy ? [] : ['-c:v', videoCodec, '-c:a', audioCodec]),
    output,
  ];

  if (useCopy) {
    // Concat demuxer: no filtergraph, so `-c copy` is valid. Falls back to the
    // re-encoding path when the inputs are not stream-compatible with each
    // other, which is the only case where the demuxer cannot be used.
    const listFile = writeConcatListFile(inputs, output);
    try {
      const proc = spawnFFmpeg({
        binary,
        args: ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', output],
      });
      await awaitProcess(proc);
      return proc;
    } catch {
      // Demuxer copy failed (mismatched codecs/params) — re-encode instead.
    } finally {
      rmSync(listFile, { force: true });
    }
  }

  return spawnFFmpeg({ binary, args });
}

/**
 * Sanitize a file path for use in ffmpeg concat demuxer list.
 * Resolves symlinks and validates paths to prevent traversal attacks.
 * Rejects paths containing newlines, carriage returns, or other control characters.
 */
function sanitizeConcatPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  // deno-lint-ignore no-control-regex
  const controlRe = /[\x00-\x1F\x7F\u0080-\u009F\u200B-\u200F\u2028-\u2029\uFEFF]/;
  if (controlRe.test(resolved)) {
    throw new Error(
      `Concat file path contains control characters: "${resolved}"`,
    );
  }
  try {
    const real = realpathSync(resolved);
    return real;
  } catch {
    // If realpath fails (e.g. file doesn't exist yet), use resolved path
    return resolved;
  }
}

/**
 * Build the concat demuxer file content without running ffmpeg.
 * Useful for inspection or custom piping.
 */
export function buildConcatList(files: string[]): string {
  return files
    .map(f => {
      const resolved = sanitizeConcatPath(f);
      return `file '${resolved.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    })
    .join('\n');
}

/**
 * Write a concat-demuxer list to a temp file next to `output`.
 *
 * Lives beside the output rather than in os.tmpdir() so the absolute paths in
 * the list stay valid without `-safe 0` relying on a cross-device guess.
 */
function writeConcatListFile(inputs: string[], output: string): string {
  const dir = path.dirname(path.resolve(output));
  const listFile = path.join(
    dir,
    `.mediaforge-concat-${process.pid}-${Date.now()}.txt`,
  );
  writeFileSync(listFile, buildConcatList(inputs), 'utf8');
  return listFile;
}

/** Resolve once an FFmpegProcess has finished, propagating any error. */
function awaitProcess(proc: FFmpegProcess): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };
    proc.emitter.on('end', () => done());
    proc.emitter.on('error', e => done(e instanceof Error ? e : new Error(String(e))));
  });
}

// ─── concatWithTransitions ───────────────────────────────────────────────────

export type TransitionType = 'fade' | 'dissolve' | 'wipeleft' | 'wiperight' | 'wipeup' | 'wipedown' | 'slideleft' | 'slideright' | 'slideup' | 'slidedown' | 'circlecrop' | 'rectcrop' | 'distance' | 'fadeblack' | 'fadewhite' | 'radial' | 'smoothleft' | 'smoothright' | 'smoothup' | 'smoothdown' | 'pixelize' | 'diagtl' | 'diagtr' | 'diagbl' | 'diagbr' | 'hlslice' | 'hrslice' | 'vuslice' | 'vdslice' | 'zoomin' | 'fadegrays' | 'wipetl' | 'wipetr' | 'wipebl' | 'wipebr' | 'cycle' | 'random';

export interface ConcatWithTransitionsOptions {
  /** Input video files */
  inputs: string[];
  /** Output file path */
  output: string;
  /** Transition type. Default: 'fade' */
  transition?: TransitionType;
  /** Transition duration in seconds. Default: 1 */
  duration?: number;
  /** Video codec. Default: 'libx264' */
  videoCodec?: string;
  /** Audio codec. Default: 'aac' */
  audioCodec?: string;
  /** Output framerate */
  fps?: string;
  /** Output resolution (e.g. '1920x1080') */
  resolution?: string;
  /** Audio format filter params. Default: 'sample_fmts=s16:sample_rates=44100:channel_layouts=stereo'. Set to empty string to skip. */
  audioFormat?: string;
  /** Enable progress callback */
  onProgress?: (percent: number) => void;
  /** ffmpeg binary override */
  binary?: string;
}

/**
 * Shared `-filter_complex` builder for transition concatenation.
 *
 * Two invariants matter here:
 *
 * 1. **Label namespaces must not overlap.** Per-input scale/pad links write to
 *    `v{i}`; xfade results are written to a separate `x{i}` namespace (audio
 *    does the same with `a{i}` → `atmp{i}` → `outa`). Letting xfade write back
 *    to `v{i+1}` redefines the next input's pad label and ffmpeg aborts with
 *    exit code 234.
 * 2. **No trailing `;`.** Segments are joined rather than each terminated with
 *    `;`. ffmpeg < 5 parses the empty trailing filterchain as a filter with an
 *    empty name and fails with `No such filter: ''`.
 *
 * The final video label is `[x{n-1}]` and the final audio label is `[outa]`.
 */
function buildTransitionGraph(
  n: number,
  parts: {
    scaleFpsFilter: string;
    transition: TransitionType;
    duration: number;
    offsets: number[];
    audioFormat: string;
  },
): string {
  const { scaleFpsFilter, transition, duration, offsets, audioFormat } = parts;
  const segments: string[] = [];

  // Normalize every input to a common size/rate.
  for (let i = 0; i < n; i++) {
    segments.push(`[${i}:v]${scaleFpsFilter}[v${i}]`);
  }

  // Chain the xfades. Input 0 feeds the first xfade; each xfade output feeds the next.
  for (let i = 0; i < n - 1; i++) {
    const left = i === 0 ? 'v0' : `x${i}`;
    segments.push(
      `[${left}][v${i + 1}]xfade=transition=${transition}:duration=${duration}:offset=${offsets[i] ?? 0}[x${i + 1}]`,
    );
  }

  // Audio: format every input, then chain acrossfades so no output is orphaned.
  for (let i = 0; i < n; i++) {
    segments.push(`[${i}:a]${audioFormat ? `aformat=${audioFormat}` : 'anull'}[a${i}]`);
  }
  if (n === 1) {
    segments.push('[a0]anull[outa]');
  } else {
    let prev = 'a0';
    for (let i = 1; i < n; i++) {
      const label = i < n - 1 ? `atmp${i}` : 'outa';
      segments.push(`[${prev}][a${i}]acrossfade=d=${duration}:curve1=tri:curve2=tri[${label}]`);
      prev = label;
    }
  }

  return segments.join(';');
}

/**
 * Concatenate videos with transitions (the `xfade` filter's transition names).
 *
 * @example
 * // Simple crossfade transition
 * await concatWithTransitions({
 *   inputs: ['clip1.mp4', 'clip2.mp4', 'clip3.mp4'],
 *   output: 'merged.mp4',
 *   transition: 'fade',
 *   duration: 1
 * });
 *
 * @example
 * // With xfade transitions
 * await concatWithTransitions({
 *   inputs: ['intro.mp4', 'main.mp4', 'outro.mp4'],
 *   output: 'video.mp4',
 *   transition: 'fadewhite',
 *   duration: 0.5,
 *   fps: '30',
 *   resolution: '1920x1080'
 * });
 */
export async function concatWithTransitions(opts: ConcatWithTransitionsOptions): Promise<void> {
  const {
    inputs,
    output,
    transition = 'fade',
    duration = 1,
    videoCodec = 'libx264',
    audioCodec = 'aac',
    fps,
    resolution,
    onProgress,
    binary = resolveBinary(),
  } = opts;

  if (inputs.length < 2) {
    throw new Error('concatWithTransitions requires at least 2 input files');
  }

  const n = inputs.length;

  // Probe actual durations of all inputs for correct transition offset calculation
  const probeBinary = resolveProbe();
  const durations = await Promise.all(inputs.map(async inp => {
    try {
      const result = await probeAsync(inp, { binary: probeBinary });
      const dur = result.format?.duration;
      return dur !== undefined ? parseFloat(dur) : 0;
    } catch {
      // @ts-ignore - Deno check doesn't include console in its lib
      console.warn(`concatWithTransitions: failed to probe "${inp}", using default duration`);
      return 5;
    }
  }));

  // Build input args
  const inputArgs: string[] = [];
  for (const inp of inputs) {
    inputArgs.push('-i', inp);
  }

  // Build filter_complex
  // Use xfade filter for transitions between clips
  const scaleFpsFilter = `scale=${resolution ? resolution + ':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2' : 'iw:ih'}${fps ? `,fps=${fps}` : ''}`;

  // Xfade offsets from the probed durations.
  const offsets: number[] = [];
  let cumulativeOffset = 0;
  for (let i = 0; i < n - 1; i++) {
    cumulativeOffset += (durations[i] ?? 5) - duration;
    offsets.push(Math.max(0, cumulativeOffset));
  }

  const audioFormatFilter = opts.audioFormat !== '' ? (opts.audioFormat ?? 'sample_fmts=s16:sample_rates=44100:channel_layouts=stereo') : '';
  const filterComplex = buildTransitionGraph(n, {
    scaleFpsFilter,
    transition,
    duration,
    offsets,
    audioFormat: audioFormatFilter,
  });

  const args: string[] = [
    '-y',
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', `[x${n - 1}]`,
    '-map', '[outa]',
    '-c:v', videoCodec,
    '-c:a', audioCodec,
    '-shortest',
    output,
  ];

  if (onProgress) {
    // The parser only produces a percentage when it knows the total length, and
    // the durations were just probed, so pass them on: without this `onProgress`
    // never fires and every callback field is undefined.
    const totalDurationUs = durations.reduce((a, b) => a + b, 0) * 1_000_000;
    const proc = spawnFFmpeg({ binary, args, parseProgress: true, totalDurationUs });
    proc.emitter.on('progress', (info) => {
      if (info.percent !== undefined) {
        onProgress(info.percent);
      }
    });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; proc.kill(); reject(new Error('concatWithTransitions timed out')); } }, 3600000);
      proc.emitter.on('end', () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } });
      proc.emitter.on('error', (err) => { if (!settled) { settled = true; clearTimeout(timer); reject(err); } });
    });
  } else {
    await runFFmpeg({ binary, args });
  }
}

/**
 * Build xfade filter arguments (for dry-run / inspection).
 */
export function buildConcatTransitionArgs(
  inputs: string[],
  output: string,
  transition: TransitionType,
  duration: number,
  videoCodec: string = 'libx264',
  audioCodec: string = 'aac',
  fps?: string,
  resolution?: string,
  audioFormat?: string,
  durations?: number[],
): string[] {
  const n = inputs.length;
  const inputArgs: string[] = [];
  for (const inp of inputs) inputArgs.push('-i', inp);

  const scaleFpsFilter = `scale=${resolution ? resolution + ':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2' : 'iw:ih'}${fps ? `,fps=${fps}` : ''}`;

  // Dedicated `x{i}` output labels keep xfade results from colliding with the
  // `v{i}` scale/pad labels of the inputs.
  const offsets: number[] = [];
  let cumulativeOffset = 0;
  for (let i = 0; i < n - 1; i++) {
    const clipDuration = durations?.[i] ?? duration * 2;
    cumulativeOffset += clipDuration - duration;
    offsets.push(cumulativeOffset);
  }

  const filterComplex = buildTransitionGraph(n, {
    scaleFpsFilter,
    transition,
    duration,
    offsets,
    audioFormat: audioFormat ?? 'sample_fmts=s16:sample_rates=44100:channel_layouts=stereo',
  });

  return [
    '-y',
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', `[x${n - 1}]`,
    '-map', '[outa]',
    '-c:v', videoCodec,
    '-c:a', audioCodec,
    '-shortest',
    output,
  ];
}
