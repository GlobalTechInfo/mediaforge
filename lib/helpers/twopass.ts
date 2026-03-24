import { runFFmpeg } from '../process/spawn.ts';
import { resolveBinary } from '../utils/binary.ts';
import type { SpawnOptions } from '../process/spawn.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';

/**
 * Options for a two-pass encode.
 */
export interface TwoPassOptions {
  /** Path to the input file */
  input: string;
  /** Path to the output file */
  output: string;
  /** Video codec, e.g. 'libx264', 'libx265', 'libvpx-vp9' */
  videoCodec: string;
  /** Target video bitrate, e.g. '2M', '4000k' */
  videoBitrate: string;
  /** Audio codec, e.g. 'aac', 'libopus'. Set to 'none' to disable audio in pass 1. */
  audioCodec?: string;
  /** Audio bitrate, e.g. '128k' */
  audioBitrate?: string;
  /** Pass log file prefix (default: temp dir) */
  passlogfile?: string;
  /** Path to ffmpeg binary */
  binary?: string;
  /** Extra output args applied to both passes */
  extraOutputArgs?: string[];
  /** Extra input args */
  extraInputArgs?: string[];
  /** Overwrite output without asking */
  overwrite?: boolean;
  /** Called after pass 1 completes */
  onPass1Complete?: () => void;
  /** Called after pass 2 completes */
  onPass2Complete?: () => void;
}

/**
 * Run a two-pass encode for the given codec.
 * Pass 1: analyse → generate stats file. Pass 2: encode with stats.
 *
 * @example
 * await twoPassEncode({
 *   input: 'input.mp4',
 *   output: 'output.mp4',
 *   videoCodec: 'libx264',
 *   videoBitrate: '2M',
 *   audioCodec: 'aac',
 *   audioBitrate: '128k',
 * });
 */
export async function twoPassEncode(opts: TwoPassOptions): Promise<void> {
  const binary = resolveBinary(opts.binary);
  const passlog = opts.passlogfile ?? join(tmpdir(), `mediaforge-passlog-${Date.now()}`);

  const inputArgs = ['-i', opts.input, ...(opts.extraInputArgs ?? [])];
  const videoArgs = ['-c:v', opts.videoCodec, '-b:v', opts.videoBitrate];
  const extraOut = opts.extraOutputArgs ?? [];

  try {
    // ── Pass 1 ──────────────────────────────────────────────────────────────
    const pass1Args: string[] = [
      '-y',
      ...inputArgs,
      ...videoArgs,
      '-pass', '1',
      '-passlogfile', passlog,
      '-an',           // no audio in pass 1 (saves time)
      '-f', 'null',    // discard output
      ...extraOut,
      '/dev/null',
    ];

    await runSpawn(binary, pass1Args);
    opts.onPass1Complete?.();

    // ── Pass 2 ──────────────────────────────────────────────────────────────
    const audioArgs: string[] = [];
    if (opts.audioCodec !== undefined && opts.audioCodec !== 'none') {
      audioArgs.push('-c:a', opts.audioCodec);
      if (opts.audioBitrate !== undefined) audioArgs.push('-b:a', opts.audioBitrate);
    } else if (opts.audioCodec === 'none') {
      audioArgs.push('-an');
    } else if (opts.audioCodec === undefined) {
      // Default: copy audio in pass 2
      audioArgs.push('-c:a', 'copy');
    }

    const pass2Args: string[] = [
      opts.overwrite !== false ? '-y' : '-n',
      ...inputArgs,
      ...videoArgs,
      '-pass', '2',
      '-passlogfile', passlog,
      ...audioArgs,
      ...extraOut,
      opts.output,
    ];

    await runSpawn(binary, pass2Args);
    opts.onPass2Complete?.();

  } finally {
    // Clean up pass log files regardless of success/failure
    cleanPasslog(passlog);
  }
}

function runSpawn(binary: string, args: string[]): Promise<void> {
  const spawnOpts: SpawnOptions = { binary, args };
  return runFFmpeg(spawnOpts);
}

function cleanPasslog(prefix: string): void {
  // ffmpeg creates prefix-0.log and prefix-0.log.mbtree
  for (const suffix of ['-0.log', '-0.log.mbtree', '.log', '.log.mbtree']) {
    const path = prefix + suffix;
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      // Best effort
    }
  }
}

/**
 * Build pass 1 and pass 2 argument arrays without running them.
 * Useful for manual orchestration or testing.
 */
export function buildTwoPassArgs(opts: TwoPassOptions): {
  pass1: string[];
  pass2: string[];
  passlog: string;
} {
  const binary = opts.binary ?? 'ffmpeg'; void binary;
  const passlog = opts.passlogfile ?? join(tmpdir(), `mediaforge-passlog`);

  const inputArgs = ['-i', opts.input, ...(opts.extraInputArgs ?? [])];
  const videoArgs = ['-c:v', opts.videoCodec, '-b:v', opts.videoBitrate];
  const extraOut = opts.extraOutputArgs ?? [];

  const pass1: string[] = [
    '-y',
    ...inputArgs,
    ...videoArgs,
    '-pass', '1',
    '-passlogfile', passlog,
    '-an',
    '-f', 'null',
    ...extraOut,
    '/dev/null',
  ];

  const audioArgs: string[] = [];
  if (opts.audioCodec !== undefined && opts.audioCodec !== 'none') {
    audioArgs.push('-c:a', opts.audioCodec);
    if (opts.audioBitrate !== undefined) audioArgs.push('-b:a', opts.audioBitrate);
  } else if (opts.audioCodec === undefined) {
    audioArgs.push('-c:a', 'copy');
  }

  const pass2: string[] = [
    opts.overwrite !== false ? '-y' : '-n',
    ...inputArgs,
    ...videoArgs,
    '-pass', '2',
    '-passlogfile', passlog,
    ...audioArgs,
    ...extraOut,
    opts.output,
  ];

  return { pass1, pass2, passlog };
}
