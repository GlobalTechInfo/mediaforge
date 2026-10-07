/**
 * Observability.
 *
 * A library that writes to `console` is unusable inside a service: it cannot be
 * silenced, cannot be routed into pino/winston, and cannot be given a
 * correlation id. This module provides the two seams an embedding application
 * actually needs — a structured logger and a diagnostic hook — plus retry with
 * exponential backoff for transient failures.
 */

/** Severity levels, ordered from least to most severe. */
import process from 'node:process';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Structured metadata attached to a log record. */
export type LogMeta = Record<string, unknown>;

/**
 * Minimal logger contract.
 *
 * Deliberately compatible with pino/winston adapters, which need only a level
 * method each. `silentLogger` is the default: the library says nothing unless
 * asked to.
 */
export interface MediaForgeLogger {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
}

/** Discards everything. The default. */
export const silentLogger: MediaForgeLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** Logs to stderr. Useful for a CLI. */
export function stderrLogger(level: LogLevel = 'info'): MediaForgeLogger {
  const threshold = LEVEL_ORDER[level];
  const emit =
    (lvl: LogLevel) =>
    (message: string, meta?: LogMeta): void => {
      if (LEVEL_ORDER[lvl] < threshold) return;
      const suffix = meta === undefined ? '' : ` ${JSON.stringify(meta)}`;
      process.stderr.write(`[mediaforge:${lvl}] ${message}${suffix}\n`);
    };
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}

/**
 * Structured lifecycle events.
 *
 * This is the seam for metrics and tracing: `onDiagnostic` receives one event
 * per job transition, so an application can build a histogram of encode
 * durations without parsing log text.
 */
export type DiagnosticEvent =
  | { type: 'spawn'; binary: string; args: string[]; pid: number | undefined }
  | { type: 'start'; binary: string; args: string[] }
  | { type: 'progress'; percent: number | undefined; fps: number; speed: number; outTimeUs: number }
  | { type: 'end'; durationMs: number; exitCode: number | null }
  | { type: 'error'; durationMs: number; code: string | undefined; message: string }
  | { type: 'retry'; attempt: number; delayMs: number; reason: string };

export type DiagnosticHook = (event: DiagnosticEvent) => void;

let _logger: MediaForgeLogger = silentLogger;
let _onDiagnostic: DiagnosticHook | undefined;

/** Install a process-wide logger. Pass `null` to restore silence. */
export function setLogger(logger: MediaForgeLogger | null): void {
  _logger = logger ?? silentLogger;
}

/** The current logger. */
export function getLogger(): MediaForgeLogger {
  return _logger;
}

/**
 * Install a process-wide diagnostic hook.
 *
 * Only one is kept, because the events describe global process activity rather
 * than anything scoped to a single builder. Per-job context is better carried on
 * the caller's own side.
 */
export function setDiagnosticHook(hook: DiagnosticHook | null): void {
  _onDiagnostic = hook ?? undefined;
}

export function getDiagnosticHook(): DiagnosticHook | undefined {
  return _onDiagnostic;
}

/** Emit a diagnostic event to the installed hook, if any. Never throws. */
export function emitDiagnostic(event: DiagnosticEvent): void {
  const hook = _onDiagnostic;
  if (hook === undefined) return;
  try {
    hook(event);
  } catch {
    // An observer must never be able to fail the job it is observing.
  }
}

/** Log at debug through the installed logger, if a logger supports it. */
export function logDebug(message: string, meta?: LogMeta): void {
  try {
    _logger.debug(message, meta);
  } catch {
    // A logger that throws must not fail the encode.
  }
}

export function logWarn(message: string, meta?: LogMeta): void {
  try {
    _logger.warn(message, meta);
  } catch {
    // See logDebug.
  }
}

// ─── Retry ───────────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Extra attempts after the first. Defaults to 0 (no retry). */
  retries?: number;
  /** First backoff, in ms. Defaults to 250. */
  initialDelayMs?: number;
  /** Upper bound on a single backoff, in ms. Defaults to 10000. */
  maxDelayMs?: number;
  /** Growth factor per attempt. Defaults to 2. */
  factor?: number;
  /**
   * Fraction of the delay to randomise, 0–1. Defaults to 0.2.
   *
   * Without jitter, a fleet of workers that all fail together retries together,
   * which reproduces the overload that caused the failure.
   */
  jitter?: number;
  /**
   * Decide whether a given failure is worth retrying. Defaults to retrying only
   * the transient causes — never a bad argument or a missing file, which would
   * fail identically every time.
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

/** Failure codes that can plausibly succeed on a second attempt. */
const TRANSIENT_CODES = new Set(['TIMEOUT', 'SPAWN_FAILED']);

const defaultShouldRetry = (error: unknown): boolean => {
  const code = (error as { code?: string } | undefined)?.code;
  if (code !== undefined) return TRANSIENT_CODES.has(code);
  // An untyped error — most often an OS-level EAGAIN or EMFILE from a forked
  // process — is worth one more try.
  return true;
};

/** Backoff for attempt `attempt` (0-based), with jitter applied. */
export function retryDelay(attempt: number, options: RetryOptions = {}): number {
  const {
    initialDelayMs = 250,
    maxDelayMs = 10_000,
    factor = 2,
    jitter = 0.2,
  } = options;

  const base = Math.min(initialDelayMs * factor ** attempt, maxDelayMs);
  if (jitter <= 0) return base;
  // Symmetric jitter around `base`, clamped at zero.
  const spread = base * Math.min(jitter, 1);
  return Math.max(0, Math.round(base + (Math.random() * 2 - 1) * spread));
}

/**
 * Run `fn`, retrying transient failures with exponential backoff.
 *
 * Does not retry `ABORTED`: a caller who cancelled wants the work stopped, not
 * resumed.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? 0;
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const isLast = attempt === retries;
      const code = (error as { code?: string } | undefined)?.code;
      if (isLast || code === 'ABORTED' || !shouldRetry(error, attempt)) {
        throw error;
      }
      const delayMs = retryDelay(attempt, options);
      emitDiagnostic({
        type: 'retry',
        attempt: attempt + 1,
        delayMs,
        reason: error instanceof Error ? error.message : String(error),
      });
      logWarn('retrying after failure', { attempt: attempt + 1, delayMs, code });
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}