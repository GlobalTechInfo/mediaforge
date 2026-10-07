/**
 * Error taxonomy.
 *
 * Every error this library throws extends {@link FFmpegError} and carries a
 * stable, machine-readable {@link FFmpegErrorCode}. Services wrapping mediaforge
 * can branch on `err.code` instead of matching on message text, which is the
 * difference between a retry policy that survives a refactor and one that does
 * not.
 *
 * This module deliberately imports nothing from the rest of the library so that
 * every other module may depend on it without creating a cycle.
 */

/**
 * Stable, machine-readable failure classification.
 *
 * These values are part of the public API. New codes may be added; existing
 * ones are not renamed or repurposed.
 */
export type FFmpegErrorCode =
  /** The binary could not be started at all (missing, not executable, bad args). */
  | 'SPAWN_FAILED'
  /** ffmpeg started and exited with a non-zero status. */
  | 'EXIT_NONZERO'
  /** The configured timeout elapsed and the process was killed. */
  | 'TIMEOUT'
  /** An `AbortSignal` fired and the process was killed. */
  | 'ABORTED'
  /** The binary is not present. */
  | 'BINARY_NOT_FOUND'
  /** The binary is present but cannot be executed. */
  | 'BINARY_NOT_EXECUTABLE'
  /** ffprobe failed or produced unusable output. */
  | 'PROBE_FAILED'
  /** The installed binary is too old for a requested feature. */
  | 'VERSION_UNSUPPORTED'
  /** A capability guard rejected the request. */
  | 'GUARD_FAILED'
  /** Arguments or paths failed validation before anything was spawned. */
  | 'VALIDATION_FAILED'
  /** Atomic output was requested for a target that cannot support it. */
  | 'ATOMIC_OUTPUT_UNSUPPORTED';

/** Base class for every error mediaforge raises. */
export class FFmpegError extends Error {
  /** Stable classification for programmatic handling. */
  readonly code: FFmpegErrorCode;

  constructor(message: string, code: FFmpegErrorCode, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.name = new.target.name;
    // Restore the prototype chain. Required when a class extends Error and the
    // build targets ES5-era semantics; harmless and correct under ES2022 too.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * ffmpeg ran and exited with a non-zero status.
 *
 * `message` is a short summary. ffmpeg's own diagnostics are on
 * {@link stderrOutput}, which is capped at the last 2000 characters so an
 * enormous banner cannot dominate an error string.
 */
export class FFmpegSpawnError extends FFmpegError {
  constructor(
    /** Exit status, or null when the process was terminated by a signal. */
    public readonly exitCode: number | null,
    /** Terminating signal, or null for a normal exit. */
    public readonly signal: string | null,
    /** Tail of ffmpeg's stderr, for diagnosis. */
    public readonly stderrOutput: string,
    /** The argv that produced this failure, for reproduction. */
    public readonly command: readonly string[] = [],
  ) {
    super(
      `FFmpeg exited with code ${exitCode ?? signal ?? 'unknown'}` +
        (command.length > 0 ? `\nCommand: ${command.join(' ')}` : '') +
        (stderrOutput.trim() === ''
          ? ''
          : `\n${stderrOutput.trim().slice(-2000)}`),
      'EXIT_NONZERO',
    );
  }
}

/** The configured timeout elapsed; the process was killed. */
export class FFmpegTimeoutError extends FFmpegError {
  constructor(
    /** The timeout that elapsed, in milliseconds. */
    public readonly timeoutMs: number,
    /** Tail of ffmpeg's stderr at the moment of the timeout. */
    public readonly stderrOutput: string = '',
  ) {
    super(
      `ffmpeg timed out after ${timeoutMs}ms and was killed` +
        (stderrOutput.trim() === '' ? '' : `\n${stderrOutput.trim().slice(-2000)}`),
      'TIMEOUT',
    );
  }
}

/** An `AbortSignal` fired; the process was killed on the caller's behalf. */
export class FFmpegAbortError extends FFmpegError {
  constructor(
    /** The `reason` carried by the AbortSignal, when it supplied one. */
    public readonly reason: unknown,
    /** Tail of ffmpeg's stderr at the moment of the abort. */
    public readonly stderrOutput: string = '',
  ) {
    super(
      `ffmpeg was aborted${stderrOutput.trim() === '' ? '' : `\n${stderrOutput.trim().slice(-2000)}`}`,
      'ABORTED',
      { cause: reason },
    );
  }
}

/** Arguments or paths were rejected before any process was spawned. */
export class FFmpegValidationError extends FFmpegError {
  constructor(
    message: string,
    /** The offending argument or path, when a single one is at fault. */
    public readonly field: string = '',
  ) {
    super(message, 'VALIDATION_FAILED');
  }
}

/** One path problem found before a run. */
export interface ValidationIssue {
  /** The argument at fault. */
  target: string;
  /** What is wrong with it. */
  problem: string;
  /** How to fix it. */
  hint: string;
}

/** Atomic output was requested for a target that cannot be renamed into place. */
export class FFmpegAtomicOutputError extends FFmpegError {
  constructor(message: string) {
    super(message, 'ATOMIC_OUTPUT_UNSUPPORTED');
  }
}