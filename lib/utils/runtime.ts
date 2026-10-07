/**
 * Runtime detection and the permission guidance each runtime needs.
 *
 * A `Deno.errors.NotCapable` or `EACCES` failure is opaque unless you know which
 * runtime raised it. The CLI previously swallowed the real error and printed
 * `Error: could not run "ffmpeg"`, which gave a Deno user nothing to act on —
 * the actual fix is a flag they cannot see.
 */

export type RuntimeName = 'node' | 'deno' | 'bun' | 'unknown';

/** Which JS runtime is this? */
export function detectRuntime(): RuntimeName {
  const g = globalThis as Record<string, unknown>;
  if (typeof g['Deno'] === 'object') return 'deno';
  if (typeof g['Bun'] === 'object') return 'bun';
  if (typeof g['process'] === 'object' && g['process'] !== null) return 'node';
  return 'unknown';
}

/**
 * Extra guidance for a failure to run the ffmpeg binary.
 *
 * Returns an empty string where there is nothing useful to add, so callers can
 * print it unconditionally.
 */
export function runtimePermissionHint(): string {
  switch (detectRuntime()) {
    case 'deno':
      return (
        'Deno requires permissions to run external binaries. Re-run with:\n' +
        '  deno run --allow-run --allow-env --allow-read --allow-write mediaforge ...\n' +
        '  --allow-env  reads FFMPEG_PATH / FFPROBE_PATH\n' +
        '  --allow-run  spawns ffmpeg and ffprobe'
      );
    case 'bun':
      return 'Bun could not start the binary. Check that ffmpeg is installed and on PATH.';
    case 'node':
      return 'Check that ffmpeg is installed and on PATH, or pass --ffmpeg <path>.';
    default:
      return '';
  }
}

/** True when running under Deno. */
export function isDeno(): boolean {
  return detectRuntime() === 'deno';
}