import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnFFmpeg, runFFmpeg } from '../process/spawn.js';
import { resolveBinary } from '../utils/binary.js';
import type { FFmpegProcess } from '../process/spawn.js';

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
    fs.copyFileSync(inputs[0]!, output);
    return;
  }

  // Write concat list file
  const tmpList = path.join(os.tmpdir(), `ffmpeg-concat-${Date.now()}.txt`);
  const listContent = inputs
    .map(f => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`)
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
    fs.unlinkSync(tmpList);
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
export function concatFiles(opts: ConcatOptions): FFmpegProcess {
  const {
    inputs,
    output,
    binary = resolveBinary(),
  } = opts;

  // Simple concat filter approach
  const n = inputs.length;
  const inputArgs: string[] = [];
  for (const inp of inputs) inputArgs.push('-i', inp);

  let filterComplex = '';
  for (let i = 0; i < n; i++) filterComplex += `[${i}:v][${i}:a]`;
  filterComplex += `concat=n=${n}:v=1:a=1[v][a]`;

  const args: string[] = [
    '-y',
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', '[v]',
    '-map', '[a]',
    '-c:v', 'libx264',
    '-c:a', 'aac',
    output,
  ];

  return spawnFFmpeg({ binary, args });
}

/**
 * Build the concat demuxer file content without running ffmpeg.
 * Useful for inspection or custom piping.
 */
export function buildConcatList(files: string[]): string {
  return files
    .map(f => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`)
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

  // Create xfade transitions
  // xfade=transition:duration:offset for each transition point
  const transitionOffsets: string[] = [];
  let currentOffset = 0;

  for (let i = 0; i < n - 1; i++) {
    const nextInput = i + 1;
    // Get duration of current clip (would need probe for exact duration)
    // For now, use fixed duration - transition happens at end of each clip
    const clipDuration = duration * 2; // Assume 2x transition duration for each clip
    currentOffset += clipDuration - duration;
    transitionOffsets.push(`[v${i}][v${nextInput}]xfade=transition=${transition}:duration=${duration}:offset=${currentOffset}[v${i + 1}];`);
  }

  filterComplex += transitionOffsets.join('');

  // Add audio crossfade using acrossfade filter
  // For simplicity, just concatenate audio for now
  for (let i = 0; i < n; i++) {
    filterComplex += `[${i}:a]aformat=sample_fmts=s16:sample_rates=44100:channel_layouts=stereo[a${i}];`;
  }

  // Audio concat
  let audioConcat = '';
  for (let i = 0; i < n; i++) {
    audioConcat += `[a${i}]`;
  }
  audioConcat += `concat=n=${n}:v=0:a=1[outa]`;

  filterComplex += audioConcat;

  const args: string[] = [
    '-y',
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', `[v${n - 1}]`,
    '-map', '[outa]',
    '-c:v', videoCodec,
    '-c:a', audioCodec,
    '-shortest',
    output,
  ];

  if (onProgress) {
    const { spawnFFmpeg } = await import('../process/spawn.js');
    const proc = spawnFFmpeg({ binary, args, parseProgress: true });
    proc.emitter.on('progress', (info) => {
      if (info.percent !== undefined) {
        onProgress(info.percent);
      }
    });
    await new Promise<void>((resolve, reject) => {
      proc.emitter.on('end', resolve);
      proc.emitter.on('error', reject);
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
  resolution?: string
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
  let currentOffset = 0;

  for (let i = 0; i < n - 1; i++) {
    const nextInput = i + 1;
    const clipDuration = duration * 2;
    currentOffset += clipDuration - duration;
    transitionOffsets.push(`[v${i}][v${nextInput}]xfade=transition=${transition}:duration=${duration}:offset=${currentOffset}[v${i + 1}];`);
  }

  filterComplex += transitionOffsets.join('');

  for (let i = 0; i < n; i++) {
    filterComplex += `[${i}:a]aformat=sample_fmts=s16:sample_rates=44100:channel_layouts=stereo[a${i}];`;
  }

  let audioConcat = '';
  for (let i = 0; i < n; i++) {
    audioConcat += `[a${i}]`;
  }
  audioConcat += `concat=n=${n}:v=0:a=1[outa]`;

  filterComplex += audioConcat;

  return [
    '-y',
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', `[v${n - 1}]`,
    '-map', '[outa]',
    '-c:v', videoCodec,
    '-c:a', audioCodec,
    '-shortest',
    output,
  ];
}
