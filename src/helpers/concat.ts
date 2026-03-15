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
