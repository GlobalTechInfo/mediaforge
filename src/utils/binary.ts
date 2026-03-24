import { execFileSync } from 'child_process';
import { accessSync, constants } from 'fs';

export class BinaryNotFoundError extends Error {
  constructor(binary: string) {
    super(
      `FFmpeg binary not found: "${binary}". ` +
        'Set the path via ffmpeg().setBinary() or the FFMPEG_PATH environment variable.',
    );
    this.name = 'BinaryNotFoundError';
  }
}

export class BinaryNotExecutableError extends Error {
  constructor(binary: string) {
    super(`FFmpeg binary is not executable: "${binary}"`);
    this.name = 'BinaryNotExecutableError';
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
  if (binaryPath.includes('/') || binaryPath.includes('\\')) {
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
    // Plain name — do a quick version check to confirm it resolves
    try {
      execFileSync(binaryPath, ['-version'], { stdio: 'pipe' });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
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
