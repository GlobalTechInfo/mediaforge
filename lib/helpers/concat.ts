import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdtempSync, realpathSync } from 'node:fs';
import { spawnFFmpeg, runFFmpeg } from '../process/spawn.ts';
import { resolveBinary, resolveProbe } from '../utils/binary.ts';
import { probeAsync } from '../probe/ffprobe.ts';
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

export function concatFiles(opts: ConcatFilesOptions): FFmpegProcess {
  const {
    inputs,
    output,
    videoCodec = 'libx264',
    audioCodec = 'aac',
    copy: useCopy,
    binary = resolveBinary(),
  } = opts;

  // Simple concat filter approach
  const n = inputs.length;
  const inputArgs: string[] = [];
  for (const inp of inputs) inputArgs.push('-i', inp);

  let filterComplex = '';
  for (let i = 0; i < n; i++) filterComplex += `[${i}:v][${i}:a?]`;
  filterComplex += `concat=n=${n}:v=1:a=1[v][a]`;

  const args: string[] = [
    '-y',
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', '[v]',
    '-map', '[a]',
    ...(useCopy ? ['-c', 'copy'] : ['-c:v', videoCodec, '-c:a', audioCodec]),
    output,
  ];

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

// ─── concatWithTransitions ───────────────────────────────────────────────────

export type TransitionType = 'crossfade' | 'xfade' | 'fade' | 'dissolve' | 'wipeleft' | 'wiperight' | 'wipeup' | 'wipedown' | 'slideleft' | 'slideright' | 'slideup' | 'slidedown' | 'circlecrop' | 'rectcrop' | 'distance' | 'fadeblack' | 'fadewhite' | 'radial' | 'smoothleft' | 'smoothright' | 'smoothup' | 'smoothdown' | 'pixelize' | 'diagtl' | 'diagtr' | 'diagbl' | 'diagbr' | 'hlslice' | 'hrslice' | 'vuslice' | 'vdslice' | 'zoomin' | 'fadegrays' | 'wipetl' | 'wipetr' | 'wipebl' | 'wipebr' | 'cycle' | 'random';

export interface ConcatWithTransitionsOptions {
  /** Input video files */
  inputs: string[];
  /** Output file path */
  output: string;
  /** Transition type. Default: 'crossfade' */
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
 * Concatenate videos with transitions (crossfade/xfade).
 *
 * @example
 * // Simple crossfade transition
 * await concatWithTransitions({
 *   inputs: ['clip1.mp4', 'clip2.mp4', 'clip3.mp4'],
 *   output: 'merged.mp4',
 *   transition: 'crossfade',
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
    transition = 'crossfade',
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
  let filterComplex = '';

  // First, scale and fps all inputs to same size
  const scaleFpsFilter = `scale=${resolution ? resolution + ':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2' : 'iw:ih'}${fps ? `,fps=${fps}` : ''}`;

  // Create scale filters for each input
  for (let i = 0; i < n; i++) {
    filterComplex += `[${i}:v]${scaleFpsFilter}[v${i}];`;
  }

  // Create xfade transitions using probed durations
  const transitionOffsets: string[] = [];
  let cumulativeOffset = 0;

  for (let i = 0; i < n - 1; i++) {
    cumulativeOffset += (durations[i] ?? 5) - duration;
    const nextInput = i + 1;
    transitionOffsets.push(`[v${i}][v${nextInput}]xfade=transition=${transition}:duration=${duration}:offset=${Math.max(0, cumulativeOffset)}[v${i + 1}];`);
  }

  filterComplex += transitionOffsets.join('');

  // Add audio crossfade using acrossfade filter
  const audioFormatFilter = opts.audioFormat !== '' ? (opts.audioFormat ?? 'sample_fmts=s16:sample_rates=44100:channel_layouts=stereo') : '';
  for (let i = 0; i < n; i++) {
    filterComplex += `[${i}:a]${audioFormatFilter ? `aformat=${audioFormatFilter}` : 'anull'}[a${i}];`;
  }

  // Audio acrossfade transitions — chain sequentially so no output is orphaned
  if (n === 1) {
    filterComplex += `[a0]anull[outa]`;
  } else {
    let prev = `a0`;
    for (let i = 1; i < n; i++) {
      const label = i < n - 1 ? `atmp${i}` : `outa`;
      filterComplex += `[${prev}][a${i}]acrossfade=d=${duration}:curve1=tri:curve2=tri[${label}];`;
      prev = label;
    }
  }

  const args: string[] = [
    '-y',
    ...inputArgs,
    '-filter_complex', filterComplex,
    `-map`, `[v${n - 1}]`,
    '-map', '[outa]',
    '-c:v', videoCodec,
    '-c:a', audioCodec,
    '-shortest',
    output,
  ];

  if (onProgress) {
    const proc = spawnFFmpeg({ binary, args, parseProgress: true });
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

  let filterComplex = '';
  for (let i = 0; i < n; i++) {
    filterComplex += `[${i}:v]${scaleFpsFilter}[v${i}];`;
  }

  const transitionOffsets: string[] = [];
  let cumulativeOffset = 0;

  for (let i = 0; i < n - 1; i++) {
    const nextInput = i + 1;
    const clipDuration = durations?.[i] ?? duration * 2;
    cumulativeOffset += clipDuration - duration;
    transitionOffsets.push(`[v${i}][v${nextInput}]xfade=transition=${transition}:duration=${duration}:offset=${cumulativeOffset}[v${i + 1}];`);
  }

  filterComplex += transitionOffsets.join('');

  const afmt = audioFormat ?? 'sample_fmts=s16:sample_rates=44100:channel_layouts=stereo';
  for (let i = 0; i < n; i++) {
    filterComplex += `[${i}:a]${afmt ? `aformat=${afmt}` : 'anull'}[a${i}];`;
  }

  if (n === 1) {
    filterComplex += `[a0]anull[outa]`;
  } else {
    let prev = `a0`;
    for (let i = 1; i < n; i++) {
      const label = i < n - 1 ? `atmp${i}` : `outa`;
      filterComplex += `[${prev}][a${i}]acrossfade=d=${duration}:curve1=tri:curve2=tri[${label}];`;
      prev = label;
    }
  }

  return [
    '-y',
    ...inputArgs,
    '-filter_complex', filterComplex,
    `-map`, `[v${n - 1}]`,
    '-map', '[outa]',
    '-c:v', videoCodec,
    '-c:a', audioCodec,
    '-shortest',
    output,
  ];
}
