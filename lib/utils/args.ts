/**
 * Utility functions for building FFmpeg argument arrays.
 * All methods are pure — they return new arrays, never mutate.
 */

/** A single argument entry: a flag and optional value */
export interface ArgEntry {
  flag: string;
  value?: string;
}

/**
 * Flatten ArgEntry[] into a string[] suitable for child_process.
 * E.g. [{flag:'-c:v', value:'libx264'}, {flag:'-y'}] → ['-c:v','libx264','-y']
 */
export function flattenArgs(entries: ArgEntry[]): string[] {
  const result: string[] = [];
  for (const entry of entries) {
    result.push(entry.flag);
    if (entry.value !== undefined) result.push(entry.value);
  }
  return result;
}

/**
 * Convert a duration value (string or number of seconds) to an ffmpeg time string.
 * Numbers are passed as-is (ffmpeg accepts seconds as a float).
 * Strings are passed through unchanged.
 */
export function toDuration(value: string | number): string {
  return typeof value === 'number' ? String(value) : value;
}

/**
 * Convert a numeric bitrate to a string if needed.
 * e.g. 2_000_000 → "2000000", "2M" → "2M"
 */
export function toBitrate(value: string | number): string {
  return String(value);
}

/**
 * Build the global option args that appear before any -i.
 */
export function buildGlobalArgs(opts: {
  overwrite?: boolean;
  noOverwrite?: boolean;
  logLevel?: string;
  progress?: boolean;
  statsInterval?: number;
  extraArgs?: string[];
}): string[] {
  const args: string[] = [];

  if (opts.overwrite === true) args.push('-y');
  if (opts.noOverwrite === true) args.push('-n');
  if (opts.logLevel !== undefined) args.push('-loglevel', opts.logLevel);
  if (opts.progress === true) args.push('-progress', 'pipe:2');
  if (opts.statsInterval !== undefined)
    args.push('-stats_period', String(opts.statsInterval));
  if (opts.extraArgs !== undefined) args.push(...opts.extraArgs);

  return args;
}

/**
 * Build the args for a single input entry.
 * These come immediately before the -i flag.
 */
export function buildInputArgs(opts: {
  seekInput?: string | number;
  duration?: string | number;
  to?: string | number;
  format?: string;
  frameRate?: string | number;
  loop?: number;
  extraArgs?: string[];
}): string[] {
  const args: string[] = [];

  if (opts.loop !== undefined) args.push('-loop', String(opts.loop));
  if (opts.format !== undefined) args.push('-f', opts.format);
  if (opts.frameRate !== undefined)
    args.push('-r', String(opts.frameRate));
  if (opts.seekInput !== undefined)
    args.push('-ss', toDuration(opts.seekInput));
  if (opts.to !== undefined) args.push('-to', toDuration(opts.to));
  if (opts.duration !== undefined) args.push('-t', toDuration(opts.duration));
  if (opts.extraArgs !== undefined) args.push(...opts.extraArgs);

  return args;
}

/**
 * Build the args for output options (before the output path).
 */
export function buildOutputArgs(opts: {
  seekOutput?: string | number;
  duration?: string | number;
  to?: string | number;
  format?: string;
  map?: string[];
  extraArgs?: string[];
}): string[] {
  const args: string[] = [];

  if (opts.seekOutput !== undefined)
    args.push('-ss', toDuration(opts.seekOutput));
  if (opts.to !== undefined) args.push('-to', toDuration(opts.to));
  if (opts.duration !== undefined) args.push('-t', toDuration(opts.duration));
  if (opts.format !== undefined) args.push('-f', opts.format);
  if (opts.map !== undefined) {
    for (const m of opts.map) args.push('-map', m);
  }
  if (opts.extraArgs !== undefined) args.push(...opts.extraArgs);

  return args;
}
