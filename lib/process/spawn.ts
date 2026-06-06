import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { FFmpegEmitter } from './events.ts';
import { ProgressParser } from './progress.ts';
import { trackChild } from '../helpers/process.ts';
import { captureStderr } from '../utils/stderr.ts';

export interface SpawnOptions {
  /** Path to the ffmpeg binary */
  binary: string;
  /** Full argument list */
  args: string[];
  /** If true, emit progress= events by parsing stderr key=value blocks */
  parseProgress?: boolean;
  /** Known total duration in microseconds (for percent calculation) */
  totalDurationUs?: number;
  /** Working directory for the spawned process */
  cwd?: string;
  /** Timeout in milliseconds. If exceeded, the process is killed and an error is emitted. */
  timeout?: number;
}

export interface FFmpegProcess {
  /** Typed event emitter — attach listeners before calling run() */
  readonly emitter: FFmpegEmitter;
  /** The underlying ChildProcess (available after start) */
  readonly child: ChildProcess;
  /** stdin of the child process */
  readonly stdin: Writable | null;
  /** stdout of the child process (useful for pipe output) */
  readonly stdout: Readable | null;
  /** Kill the process with an optional signal */
  kill(signal?: NodeJS.Signals): void;
}

export class FFmpegSpawnError extends Error {
  constructor(
    public readonly exitCode: number | null,
    public readonly signal: string | null,
    public readonly stderrOutput: string,
  ) {
    super(
      `FFmpeg exited with code ${exitCode ?? signal ?? 'unknown'}:\n${stderrOutput.slice(-2000)}`,
    );
    this.name = 'FFmpegSpawnError';
  }
}

/**
 * Spawn an ffmpeg child process and wire up all event handling.
 * Returns an FFmpegProcess immediately (process is already running).
 *
 * @example
 * const proc = spawnFFmpeg({ binary: 'ffmpeg', args: [...], parseProgress: true });
 * proc.emitter.on('progress', (info) => console.log(info.percent));
 * await new Promise((res, rej) => {
 *   proc.emitter.on('end', res);
 *   proc.emitter.on('error', rej);
 * });
 */
export function spawnFFmpeg(opts: SpawnOptions): FFmpegProcess {
  const { binary, args, parseProgress = false, totalDurationUs, cwd, timeout } = opts;

  let child: ChildProcess;
  try {
    child = spawn(binary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
    });
  } catch (err) {
    throw new Error(
      `Failed to spawn ffmpeg: ${(err as Error).message}. Ensure the ffmpeg binary exists and is executable.`,
    );
  }

  trackChild(child);

  const emitter = new FFmpegEmitter();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  if (timeout !== undefined && timeout > 0) {
    timeoutHandle = setTimeout(() => {
      emitter.emit('error', new Error(`ffmpeg timed out after ${timeout}ms`));
      child.kill('SIGTERM');
    }, timeout);
    if (typeof timeoutHandle.unref === 'function') timeoutHandle.unref();
  }

  const progressParser = parseProgress
    ? new ProgressParser(
        (info) => emitter.emit('progress', info),
        totalDurationUs,
      )
    : null;

  emitter.emit('start', args);

  let closeStderr: (() => void) | undefined;

  if (child.stderr !== null) {
    const captured = captureStderr(child.stderr, emitter, progressParser);
    closeStderr = captured.close;
  }

  child.on('close', (code: number | null, signal: string | null) => {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    closeStderr?.();
    if (code === 0) {
      emitter.emit('end');
    } else {
      const stderr = ''; // stderr already streamed via emitter
      emitter.emit('error', new FFmpegSpawnError(code, signal, stderr));
    }
  });

  child.on('error', (err: Error) => {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    emitter.emit('error', err);
  });

  return {
    emitter,
    child,
    stdin: child.stdin,
    stdout: child.stdout,
    kill(signal: NodeJS.Signals = 'SIGTERM') {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      child.kill(signal);
    },
  };
}

/**
 * Spawn ffmpeg and return a Promise that resolves when the process exits
 * successfully, or rejects with FFmpegSpawnError on failure.
 */
export function runFFmpeg(opts: SpawnOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const proc = spawnFFmpeg(opts);
    proc.emitter.on('end', resolve);
    proc.emitter.on('error', reject);
  });
}
