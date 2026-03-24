import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { FFmpegEmitter } from './events.ts';
import { ProgressParser } from './progress.ts';

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
  const { binary, args, parseProgress = false, totalDurationUs, cwd } = opts;

  const child = spawn(binary, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd,
  });

  const emitter = new FFmpegEmitter();
  const stderrLines: string[] = [];

  // Progress parser (only active if requested)
  const progressParser = parseProgress
    ? new ProgressParser(
        (info) => emitter.emit('progress', info),
        totalDurationUs,
      )
    : null;

  emitter.emit('start', args);

  // Wire stderr → line-by-line
  if (child.stderr !== null) {
    const rl = createInterface({ input: child.stderr, crlfDelay: Infinity });
    rl.on('line', (line) => {
      stderrLines.push(line);
      emitter.emit('stderr', line);
      progressParser?.push(line);
    });
  }

  // Handle process exit
  child.on('close', (code: number | null, signal: string | null) => {
    if (code === 0 || (code === null && signal === null)) {
      emitter.emit('end');
    } else {
      const stderr = stderrLines.join('\n');
      emitter.emit(
        'error',
        new FFmpegSpawnError(code, signal, stderr),
      );
    }
  });

  child.on('error', (err: Error) => {
    emitter.emit('error', err);
  });

  return {
    emitter,
    child,
    stdin: child.stdin,
    stdout: child.stdout,
    kill(signal: NodeJS.Signals = 'SIGTERM') {
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
