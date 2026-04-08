import { runFFmpeg } from '../process/spawn.ts';
import { resolveBinary } from '../utils/binary.ts';
import type { SpawnOptions } from '../process/spawn.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';

export interface TwoPassOptions {
  input: string;
  output: string;
  videoCodec: string;
  videoBitrate: string;
  audioCodec?: string;
  audioBitrate?: string;
  passlogfile?: string;
  binary?: string;
  extraOutputArgs?: string[];
  extraInputArgs?: string[];
  overwrite?: boolean;
  onPass1Complete?: () => void;
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
  const ts = Date.now();
  const passlog = opts.passlogfile ?? join(tmpdir(), `mediaforge-passlog-${ts}`);

  // Write pass 1 to a real temp MKV instead of -f null /dev/null.
  // On ARM Linux (Android Termux FFmpeg 8.x, Ubuntu ARM FFmpeg 7.x) the null
  // muxer drops frames before they reach the encoder stats writer so the
  // passlog .log is never created and pass 2 fails with:
  //   "ratecontrol_init: can't open stats file"
  // MKV is streamable (no moov-atom seek) so it works on all platforms.
  const pass1TempOut = join(tmpdir(), `mediaforge-pass1-${ts}.mkv`);

  const inputArgs = ['-i', opts.input, ...(opts.extraInputArgs ?? [])];
  const videoArgs: string[] = [];
  if (opts.videoCodec) videoArgs.push('-c:v', opts.videoCodec);
  if (opts.videoBitrate) videoArgs.push('-b:v', opts.videoBitrate);
  const extraOut = opts.extraOutputArgs ?? [];

  try {
    // ── Pass 1 ──────────────────────────────────────────────────────────────
    const pass1Args: string[] = [
      '-y',
      ...inputArgs,
      ...videoArgs,
      '-pass', '1',
      '-passlogfile', passlog,
      '-an',
      '-f', 'matroska',
      ...extraOut,
      pass1TempOut,
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
    } else {
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
    cleanPasslog(passlog);
    tryUnlink(pass1TempOut);
  }
}

function runSpawn(binary: string, args: string[]): Promise<void> {
  const spawnOpts: SpawnOptions = { binary, args };
  return runFFmpeg(spawnOpts);
}

function tryUnlink(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // Best effort
  }
}

function cleanPasslog(prefix: string): void {
  for (const suffix of ['-0.log', '-0.log.mbtree', '.log', '.log.mbtree']) {
    tryUnlink(prefix + suffix);
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
  const pass1TempOut = join(tmpdir(), `mediaforge-pass1.mkv`);

  const inputArgs = ['-i', opts.input, ...(opts.extraInputArgs ?? [])];
  const videoArgs: string[] = [];
  if (opts.videoCodec) videoArgs.push('-c:v', opts.videoCodec);
  if (opts.videoBitrate) videoArgs.push('-b:v', opts.videoBitrate);
  const extraOut = opts.extraOutputArgs ?? [];

  const pass1: string[] = [
    '-y',
    ...inputArgs,
    ...videoArgs,
    '-pass', '1',
    '-passlogfile', passlog,
    '-an',
    '-f', 'matroska',
    ...extraOut,
    pass1TempOut,
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
