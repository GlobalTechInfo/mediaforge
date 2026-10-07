import { spawn, type ChildProcess } from 'node:child_process';
import process from 'node:process';
import type { Readable, Writable } from 'node:stream';
import { FFmpegEmitter } from './events.ts';
import { ProgressParser } from './progress.ts';
import { trackChild, registerExitCleanup } from '../helpers/process.ts';
import { captureStderr } from '../utils/stderr.ts';
import {
  FFmpegAbortError,
  FFmpegError,
  FFmpegSpawnError,
  FFmpegTimeoutError,
} from '../errors.ts';
import {
  emitDiagnostic,
  logDebug,
  type DiagnosticHook,
  type MediaForgeLogger,
  type RetryOptions,
} from '../observability.ts';

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
  /**
   * Abort the encode from the outside.
   *
   * When the signal fires the child is killed with the same escalating
   * sequence a timeout uses, and the process emits an
   * {@link FFmpegAbortError}. A signal that is *already* aborted causes
   * {@link spawnFFmpeg} to throw before any process is created, so a
   * cancelled request never leaves a stray ffmpeg behind.
   */
  signal?: AbortSignal;
  /**
   * Milliseconds to wait after `SIGTERM` before escalating to `SIGKILL`.
   * Defaults to 2000. Set to 0 to kill immediately.
   *
   * Escalation is not optional in practice: a child that installs a `SIGTERM`
   * handler (or ignores the signal) otherwise survives a cancel or a timeout
   * indefinitely.
   */
  killGracePeriodMs?: number;
  /**
   * Kill the child's entire process group rather than just the process.
   * Defaults to true on POSIX, where it is what makes grandchildren die too.
   * Ignored on Windows.
   */
  killProcessGroup?: boolean;
  /**
   * Register this child with the library's exit/SIGINT/SIGTERM cleanup so it
   * cannot outlive the host process. Defaults to true.
   *
   * Turn it off only when the caller owns the child's lifetime.
   */
  autoCleanup?: boolean;
  /** Receives structured lifecycle events for this child. */
  onDiagnostic?: DiagnosticHook;
  /** Emit a debug log line when the child starts. */
  logger?: MediaForgeLogger;
  /**
   * How to wire the child's standard streams.
   *
   * Defaults to all pipes, which is what the event API needs. Override it when
   * the caller manages the streams directly — notably a CLI piping ffmpeg's
   * output to its own stdout, which must use `inherit`: a piped stdout nobody
   * drains fills the 64 KiB OS buffer and deadlocks ffmpeg mid-encode.
   */
  stdio?: {
    stdin?: 'pipe' | 'ignore' | 'inherit';
    stdout?: 'pipe' | 'ignore' | 'inherit';
    stderr?: 'pipe' | 'ignore' | 'inherit';
  };
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

/** Options accepted by {@link FFmpegBuilder.run} and {@link FFmpegBuilder.spawn}. */
export interface RunOptions {
  /** Parse `-progress` blocks into `progress` events. */
  parseProgress?: boolean;
  /** Known total duration in microseconds, used to compute `info.percent`. */
  totalDurationUs?: number;
  /** Kill the encode after this many milliseconds. */
  timeout?: number;
  /** Cancel the encode from the outside. */
  signal?: AbortSignal;
  /** Milliseconds between SIGTERM and the SIGKILL escalation. Defaults to 2000. */
  killGracePeriodMs?: number;
  /** Kill the child's whole process group. Defaults to true on POSIX. */
  killProcessGroup?: boolean;
  /**
   * Retry the run on failure. Off by default: an ffmpeg failure is nearly
   * always deterministic, so retrying usually just burns the same CPU twice.
   *
   * Only safe when the output is written atomically — otherwise a retry
   * operates on the truncated file the failed attempt left behind.
   *
   * @see withAtomicOutput
   */
  retry?: RetryOptions;
  /** Log lifecycle events. Defaults to the library-wide logger. */
  logger?: MediaForgeLogger;
  /** Receives structured lifecycle events. Defaults to the library-wide hook. */
  onDiagnostic?: DiagnosticHook;
  /**
   * Reject before spawning when an input path does not exist, is unreadable, or
   * is a directory. Defaults to false.
   *
   * Off by default because this library accepts ffmpeg input syntax — URLs,
   * `pipe:0`, `lavfi:` graphs, `concat:` lists — that is not a filesystem path,
   * and guessing wrong would break working calls. Turn it on for a service that
   * only ever accepts local paths.
   */
  validate?: boolean;
}

// Re-exported so `mediaforge/.../process/spawn.js` keeps resolving this class,
// which lived here before the taxonomy moved to errors.ts.
export { FFmpegSpawnError };

const isPosix = process.platform !== 'win32';
const DEFAULT_GRACE_MS = 2000;

/**
 * Signal a child, preferring its whole process group on POSIX.
 *
 * `detached: true` makes the child a process-group leader, so `kill(-pid)`
 * reaches anything it spawned. Without this a helper that ffmpeg launched can
 * survive the cancel.
 */
function signalChild(child: ChildProcess, signal: NodeJS.Signals, useGroup: boolean): void {
  if (useGroup && isPosix && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      // ESRCH means the group is already gone, which is the outcome we wanted.
      // Anything else (EPERM, or a pid we cannot signal) falls back to the
      // direct kill below rather than leaving the child running.
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Already exited. Nothing to do.
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
  const {
    binary,
    parseProgress = false,
    totalDurationUs,
    cwd,
    timeout,
    signal,
    killGracePeriodMs = DEFAULT_GRACE_MS,
    killProcessGroup = isPosix,
    autoCleanup = true,
  } = opts;

  // Refuse before spawning. Cancelling work that has not started should cost
  // nothing, and this is the only way to guarantee no child is left behind by a
  // request that was already cancelled when it arrived.
  if (signal?.aborted === true) {
    throw new FFmpegAbortError(signal.reason);
  }

  // ffmpeg only writes the key=value progress blocks when it is asked to, and
  // they have to land on stderr for the parser to see them. A caller that
  // enabled `parseProgress` almost certainly meant to receive them, so add the
  // flag here unless the argv already carries it.
  const args =
    parseProgress && !opts.args.includes('-progress')
      ? [...opts.args, '-progress', 'pipe:2']
      : opts.args;

  let child: ChildProcess;
  try {
    const stdio = opts.stdio ?? {};
    child = spawn(binary, args, {
      stdio: [
        stdio.stdin ?? 'pipe',
        stdio.stdout ?? 'pipe',
        stdio.stderr ?? 'pipe',
      ],
      cwd,
      // A new process group on POSIX is what makes group signalling possible.
      // `windowsHide` keeps Windows from flashing a console window instead,
      // since `detached` is not used there.
      detached: killProcessGroup && isPosix,
      windowsHide: true,
    });
  } catch (err) {
    throw new FFmpegError(
      `Failed to spawn ffmpeg: ${(err as Error).message}. ` +
        'Ensure the ffmpeg binary exists and is executable.',
      'SPAWN_FAILED',
      { cause: err },
    );
  }

  trackChild(child);
  if (autoCleanup) registerExitCleanup(child);

  // A per-call hook wins over the process-wide one, so a single job can be
  // traced without reconfiguring the library.
  const diagnostic = opts.onDiagnostic;
  emitDiagnostic({ type: 'spawn', binary, args, pid: child.pid });

  const emitter = new FFmpegEmitter();
  const startedAt = Date.now();
  let settled = false;
  let killGraceTimer: ReturnType<typeof setTimeout> | undefined;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const progressParser = parseProgress
    ? new ProgressParser(
        (info) => {
          emitDiagnostic({
            type: 'progress',
            percent: info.percent,
            fps: info.fps,
            speed: info.speed,
            outTimeUs: info.outTimeUs,
          });
          emitter.emit('progress', info);
        },
        totalDurationUs,
      )
    : null;

  let closeStderr: (() => void) | undefined;
  let capturedStderr: { stderrLines: string[]; close: () => void } | undefined;

  if (child.stderr !== null) {
    capturedStderr = captureStderr(child.stderr, emitter, progressParser);
    closeStderr = capturedStderr.close;
  }

  // Release the stderr reader exactly once, on every exit path. A settled
  // handler would otherwise early-return and leak the readline interface and
  // its stream listeners.
  let stderrClosed = false;
  const releaseStderr = (): void => {
    if (stderrClosed) return;
    stderrClosed = true;
    closeStderr?.();
  };

  const stderrSnapshot = (): string => capturedStderr?.stderrLines.join('\n') ?? '';

  const clearTimers = (): void => {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    if (killGraceTimer !== undefined) clearTimeout(killGraceTimer);
    timeoutHandle = undefined;
    killGraceTimer = undefined;
  };

  /**
   * Terminate the child, escalating to SIGKILL if it does not go quietly.
   *
   * SIGTERM alone is not sufficient: a child that traps or ignores the signal
   * stays alive forever, which on a timeout would mean the process never exits
   * and the caller's promise hangs with it.
   */
  const terminate = (): void => {
    signalChild(child, 'SIGTERM', killProcessGroup);
    if (killGracePeriodMs <= 0) {
      signalChild(child, 'SIGKILL', killProcessGroup);
      return;
    }
    killGraceTimer = setTimeout(() => {
      // Only escalate if the child is somehow still running; 'close' clears
      // this handle first on a clean shutdown.
      if (child.exitCode === null && child.signalCode === null) {
        signalChild(child, 'SIGKILL', killProcessGroup);
      }
    }, killGracePeriodMs);
    if (typeof killGraceTimer.unref === 'function') killGraceTimer.unref();
  };

  if (timeout !== undefined && timeout > 0) {
    timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearTimers();
      const stderrOutput = stderrSnapshot();
      releaseStderr();
      emitter.emit('error', new FFmpegTimeoutError(timeout, stderrOutput));
      terminate();
    }, timeout);
    if (typeof timeoutHandle.unref === 'function') timeoutHandle.unref();
  }

  const onAbort = (): void => {
    if (settled) return;
    settled = true;
    clearTimers();
    const stderrOutput = stderrSnapshot();
    releaseStderr();
    emitter.emit('error', new FFmpegAbortError(signal?.reason, stderrOutput));
    terminate();
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  // Defer so callers can attach listeners to the returned FFmpegProcess before
  // 'start' fires. Emitting synchronously here made the event unobservable.
  queueMicrotask(() => {
    emitDiagnostic({ type: 'start', binary, args });
    logDebug('spawned ffmpeg', { pid: child.pid, args });
    if (diagnostic !== undefined) {
      try {
        diagnostic({ type: 'start', binary, args });
      } catch {
        // An observer must never break the job it observes.
      }
    }
    emitter.emit('start', args);
  });

  child.on('close', (code: number | null, signalName: string | null) => {
    if (settled) return;
    settled = true;
    clearTimers();
    signal?.removeEventListener('abort', onAbort);
    releaseStderr();
    const stderrOutput = stderrSnapshot();
    if (code === 0) {
      emitDiagnostic({ type: 'end', durationMs: Date.now() - startedAt, exitCode: 0 });
      emitter.emit('end');
    } else {
      const error = new FFmpegSpawnError(code, signalName, stderrOutput, [binary, ...args]);
      emitDiagnostic({
        type: 'error',
        durationMs: Date.now() - startedAt,
        code: error.code,
        message: error.message,
      });
      emitter.emit('error', error);
    }
  });

  child.on('error', (err: Error) => {
    if (settled) return;
    settled = true;
    clearTimers();
    signal?.removeEventListener('abort', onAbort);
    releaseStderr();
    emitter.emit('error', err);
  });

  return {
    emitter,
    child,
    stdin: child.stdin,
    stdout: child.stdout,
    /** Terminate the child, defaulting to an escalating SIGTERM. */
    kill(signalName: NodeJS.Signals = 'SIGTERM') {
      clearTimers();
      signalChild(child, signalName, killProcessGroup);
    },
  };
}

/**
 * Spawn ffmpeg and return a Promise that resolves when the process exits
 * successfully, or rejects with FFmpegSpawnError on failure.
 *
 * Rejects with {@link FFmpegTimeoutError} when a timeout elapses and with
 * {@link FFmpegAbortError} when `opts.signal` fires.
 */
export function runFFmpeg(opts: SpawnOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const proc = spawnFFmpeg(opts);
    proc.emitter.on('end', resolve);
    proc.emitter.on('error', reject);
  });
}