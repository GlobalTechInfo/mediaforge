import process from 'node:process';
import path from 'node:path';
import { spawnSync, spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { FFmpegError } from '../errors.ts';

/** The ffmpeg/ffprobe binary does not exist at the configured path. */
export class BinaryNotFoundError extends FFmpegError {
  constructor(binary: string) {
    super(
      `FFmpeg binary not found: "${binary}". ` +
        'Set the path via ffmpeg().setBinary() or the FFMPEG_PATH environment variable.',
      'BINARY_NOT_FOUND',
    );
  }
}

/** The binary exists but cannot be executed (missing permission, wrong format). */
export class BinaryNotExecutableError extends FFmpegError {
  constructor(binary: string) {
    super(`FFmpeg binary is not executable: "${binary}"`, 'BINARY_NOT_EXECUTABLE');
  }
}

/**
 * Resolve the ffmpeg binary path.
 * Priority: explicit path → FFMPEG_PATH env → 'ffmpeg' on PATH
 */
export function resolveBinary(explicit?: string): string {
  const candidate = explicit ?? process.env['FFMPEG_PATH'] ?? 'ffmpeg';
  return candidate;
}

/**
 * Resolve the ffprobe binary path.
 * Priority: explicit path → FFPROBE_PATH env → 'ffprobe' on PATH
 */
export function resolveProbe(explicit?: string): string {
  return explicit ?? process.env['FFPROBE_PATH'] ?? 'ffprobe';
}

/**
 * Validate that a binary exists and is executable.
 * Throws BinaryNotFoundError or BinaryNotExecutableError on failure.
 */
export function validateBinary(binaryPath: string): void {
  // For absolute/relative paths, check directly.
  // For plain names (no path separator), rely on exec to find them on PATH.
  if (path.isAbsolute(binaryPath) || binaryPath.includes('/') || binaryPath.includes('\\')) {
    try {
      accessSync(binaryPath, constants.F_OK);
    } catch {
      throw new BinaryNotFoundError(binaryPath);
    }
    try {
      accessSync(binaryPath, constants.X_OK);
    } catch {
      throw new BinaryNotExecutableError(binaryPath);
    }
  } else {
    // Plain name — do a quick version check to confirm it resolves on PATH.
    // Use spawnSync (never throws) so we can inspect the error code uniformly
    // across Node.js and Deno. On both runtimes, a missing binary sets
    // result.error.code === 'ENOENT'; any other failure means it was found
    // but not executable / crashed, which is BinaryNotExecutableError.
    //
    // The 15s ceiling matters: without it, a binary that starts but then hangs
    // blocks the event loop indefinitely. SIGKILL because a wedged process is
    // unlikely to be handling SIGTERM.
    const result = spawnSync(binaryPath, ['-version'], {
      stdio: 'pipe',
      timeout: 15_000,
      killSignal: 'SIGKILL',
    });
    if (result.error) {
      const code = (result.error as { code?: string }).code;
      if (code === 'ENOENT') throw new BinaryNotFoundError(binaryPath);
      throw new BinaryNotExecutableError(binaryPath);
    }
  }
}

/**
 * Return true if the binary can be found and executed.
 */
export function isBinaryAvailable(binaryPath: string): boolean {
  try {
    validateBinary(binaryPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Async variant - returns true if the binary can be spawned successfully.
 * Non-blocking and safe for server environments.
 */
export function isBinaryAvailableAsync(binaryPath: string, timeoutMs = 5000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(binaryPath, ['-version'], { stdio: 'ignore' });
    } catch {
      // spawn() throws synchronously on invalid input (e.g. an embedded NUL).
      // The signature promises a boolean, so resolve false rather than reject.
      resolve(false);
      return;
    }
    const timer = setTimeout(() => { child.kill(); resolve(false); }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    child.on('error', () => { clearTimeout(timer); resolve(false); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}

/**
 * Detect Deno runtime for platform-adaptive behavior.
 */
export function isDeno(): boolean {
  return typeof (globalThis as Record<string, unknown>)['Deno'] !== 'undefined';
}
