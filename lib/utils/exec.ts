/**
 * Bounded execution of the ffmpeg/ffprobe binaries.
 *
 * Every call to the binary used to be an unbounded `execFileSync`: no timeout,
 * so a wedged or hung binary blocked the event loop permanently and the calling
 * promise never settled. That matters most on a server, where one unhealthy
 * binary takes down request handling for every other caller.
 *
 * Both helpers here default to {@link DEFAULT_EXEC_TIMEOUT_MS} and accept an
 * `AbortSignal`, and both normalise failure into an {@link FFmpegError}.
 */
import { execFileSync, spawn } from 'node:child_process';
import process from 'node:process';
import { FFmpegError, FFmpegTimeoutError } from '../errors.ts';

const isPosix = process.platform !== 'win32';

/**
 * Kill a child, preferring its whole process group on POSIX.
 *
 * Signalling only the direct child is not enough when it forked: the grandchild
 * survives, keeps the inherited stdout pipe open, and the parent's streams never
 * reach EOF.
 */
function killTree(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (isPosix && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      // ESRCH: already gone, which is the outcome we wanted. Anything else
      // (EPERM, or an un-signalable pid) falls through to the direct kill.
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Already exited.
  }
}

/**
 * Default ceiling for a metadata call (`-version`, `-i … -print_format json`).
 *
 * A healthy ffmpeg answers `-version` in single-digit milliseconds. Ten seconds
 * is far beyond any legitimate answer and short enough that a hang becomes a
 * diagnosable error rather than a stuck process.
 */
export const DEFAULT_EXEC_TIMEOUT_MS = 10_000;

/** Maximum bytes of output retained from either stream. */
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

export interface ExecOptions {
  /** Milliseconds before the child is killed. Defaults to 10s. */
  timeoutMs?: number;
  /** Abort the call from the outside. */
  signal?: AbortSignal;
}

/**
 * Run a binary and return its stdout, bounded by a timeout.
 *
 * Blocking. Prefer {@link execAsync} on a server, where a synchronous call
 * stalls the event loop for every other request for the duration.
 *
 * Known limitation: `execFileSync` signals only the direct child. A binary that
 * forks a long-lived grandchild which inherits the stdout pipe will keep that
 * pipe open past the timeout, so the call returns late even though the timeout
 * fired. Neither `ffmpeg -version` nor `ffprobe` does this, and the async path
 * below is immune because it kills the whole process group.
 *
 * @throws {FFmpegTimeoutError} when the timeout elapses
 * @throws {FFmpegError} with code `SPAWN_FAILED` when the binary cannot run
 */
export function execBounded(binary: string, args: string[], options: ExecOptions = {}): string {
  const timeoutMs = options.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;

  if (options.signal?.aborted === true) {
    // execFileSync has no abort support, so refuse before spending the timeout.
    throw new FFmpegError(`\`${binary}\` was aborted before it ran`, 'ABORTED', {
      cause: options.signal.reason,
    });
  }

  try {
    return execFileSync(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: timeoutMs,
      // SIGKILL rather than the default SIGTERM: a process that has wedged is
      // unlikely to be handling signals any more, and execFileSync's `timeout`
      // only issues one signal.
      killSignal: 'SIGKILL',
      maxBuffer: MAX_OUTPUT_BYTES,
    });
  } catch (error) {
    throw translateExecError(binary, args, error, timeoutMs);
  }
}

/**
 * Non-blocking counterpart to {@link execBounded}.
 *
 * Resolves with stdout, or rejects with an {@link FFmpegError}.
 */
export function execAsync(
  binary: string,
  args: string[],
  options: ExecOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;

  return new Promise<string>((resolve, reject) => {
    if (options.signal?.aborted === true) {
      reject(
        new FFmpegError(`\`${binary}\` was aborted before it ran`, 'ABORTED', {
          cause: options.signal.reason,
        }),
      );
      return;
    }

    let child: ReturnType<typeof spawn>;
    try {
      // A new process group on POSIX so a timeout can take down a forked
      // grandchild that is still holding the stdout pipe open. Killing only the
      // direct child is what makes `execFileSync` return late in that case.
      child = spawn(binary, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: isPosix,
        windowsHide: true,
      });
    } catch (error) {
      reject(
        new FFmpegError(
          `Failed to run "${binary}": ${(error as Error).message}`,
          'SPAWN_FAILED',
          { cause: error },
        ),
      );
      return;
    }

    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      finish(new FFmpegTimeoutError(timeoutMs, stderr));
      killTree(child, 'SIGKILL');
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    const onAbort = (): void => {
      finish(
        new FFmpegError(`\`${binary}\` was aborted`, 'ABORTED', {
          cause: options.signal?.reason,
        }),
      );
      killTree(child, 'SIGKILL');
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    function cleanup(): void {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
    function finish(error?: Error): void {
      if (settled) return;
      settled = true;
      cleanup();
      if (error === undefined) {
        resolve(Buffer.concat(stdout).toString('utf8'));
      } else {
        reject(error);
      }
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdoutBytes >= MAX_OUTPUT_BYTES) return;
      stdoutBytes += chunk.length;
      stdout.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 8192) stderr += chunk.toString('utf8');
    });

    child.on('error', (error: Error) => {
      // `spawn` reports a missing or unexecutable binary through an 'error'
      // event rather than by throwing, so this path has to classify it exactly
      // as `translateExecError` does for the sync case — otherwise the same
      // missing binary reports `SPAWN_FAILED` async and `BINARY_NOT_FOUND`
      // sync, and a caller cannot handle both.
      finish(classifySpawnFailure(binary, error));
    });

    child.on('close', (code: number | null) => {
      if (settled) return;
      if (code === 0) {
        finish();
        return;
      }
      finish(
        new FFmpegError(
          `"${binary} ${args.join(' ')}" exited with code ${code ?? 'null'}` +
            (stderr.trim() === '' ? '' : `\n${stderr.trim().slice(-2000)}`),
          'EXIT_NONZERO',
        ),
      );
    });
  });
}

/**
 * Classify a spawn failure that surfaced as an OS-level error code.
 *
 * Shared by the sync and async paths so a missing binary reports the same code
 * whichever entry point the caller used.
 */
function classifySpawnFailure(binary: string, error: unknown): FFmpegError {
  const code = (error as { code?: string }).code;
  if (code === 'ENOENT') {
    return new FFmpegError(
      `FFmpeg binary not found: "${binary}". ` +
        'Set the path via ffmpeg().setBinary() or the FFMPEG_PATH environment variable.',
      'BINARY_NOT_FOUND',
      { cause: error },
    );
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new FFmpegError(`FFmpeg binary is not executable: "${binary}"`, 'BINARY_NOT_EXECUTABLE', {
      cause: error,
    });
  }
  return new FFmpegError(`Failed to run "${binary}": ${(error as Error).message}`, 'SPAWN_FAILED', {
    cause: error,
  });
}

/**
 * Turn whatever `execFileSync` threw into a typed error.
 *
 * `execFileSync` signals a timeout with `error.signal === 'SIGTERM'` (or the
 * configured killSignal) and a genuine non-zero exit with `error.status`, so the
 * two are distinguishable without guessing from the message.
 */
function translateExecError(
  binary: string,
  args: string[],
  error: unknown,
  timeoutMs: number,
): FFmpegError {
  const err = error as {
    status?: number | null;
    signal?: string | null;
    code?: string;
    message?: string;
    stderr?: string | Buffer;
  };

  // A killed-by-timeout exec reports the kill signal and no status.
  if (err.signal !== undefined && err.signal !== null && (err.status === undefined || err.status === null)) {
    return new FFmpegTimeoutError(timeoutMs, decodeStderr(err.stderr));
  }

  if (err.code !== undefined && err.code !== null && (err.status === undefined || err.status === null)) {
    return classifySpawnFailure(binary, error);
  }

  return new FFmpegError(
    `"${binary} ${args.join(' ')}" failed: ${err.message ?? 'unknown error'}` +
      (decodeStderr(err.stderr).trim() === '' ? '' : `\n${decodeStderr(err.stderr).trim().slice(-2000)}`),
    'SPAWN_FAILED',
    { cause: error },
  );
}

function decodeStderr(raw: string | Buffer | undefined): string {
  if (raw === undefined) return '';
  return typeof raw === 'string' ? raw : raw.toString('utf8');
}