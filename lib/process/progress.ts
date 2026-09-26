import type { ProgressInfo } from '../types/progress.ts';

/**
 * FFmpeg emits progress as a block of key=value pairs terminated by
 * "progress=continue" or "progress=end" when -progress is passed.
 * This parser accumulates lines and yields a ProgressInfo on each
 * complete block.
 */

type PartialProgress = Partial<Record<string, string>>;

/** Upper bound on keys held in an in-progress block (see ProgressParser.push). */
const MAX_PROGRESS_KEYS = 64;

/**
 * Parse an integer from a progress field.
 * FFmpeg reports "N/A" for counters it does not track on every code path, and
 * `parseInt('N/A')` yields NaN — which then poisons `percent` and every
 * downstream arithmetic on ProgressInfo. Fall back to 0 instead.
 */
function parseIntSafe(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === 'N/A') return 0;
  const n = parseInt(trimmed, 10);
  return Number.isNaN(n) ? 0 : n;
}

function parseFloatSafe(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === 'N/A') return 0;
  const n = parseFloat(trimmed);
  return Number.isNaN(n) ? 0 : n;
}

function parseSpeed(raw: string): number {
  // "2.50x" → 2.5,  "N/A" → 0
  if (raw === 'N/A' || raw === '') return 0;
  const stripped = raw.replace('x', '');
  const n = parseFloat(stripped);
  return isNaN(n) ? 0 : n;
}

function parseSize(raw: string): number {
  if (raw === 'N/A' || raw === '') return 0;

  // Try pure integer first (raw byte count, no unit)
  const trimmed = raw.trim();
  const pureNum = parseInt(trimmed, 10);
  if (!isNaN(pureNum) && String(pureNum) === trimmed) return pureNum;

  // Parse with optional unit: "4096kB", "1.23MB", "4096 KiB"
  const m = /^(\d+(?:\.\d+)?)\s*(kB|KiB|MB|MiB|GB|GiB)?$/i.exec(trimmed);
  if (m === null) {
    const n = parseInt(trimmed.replace(/[^0-9]/g, ''), 10);
    return isNaN(n) ? 0 : n;
  }
  const value = parseFloat(m[1] ?? '0');
  const unit = (m[2] ?? '').toLowerCase();
  switch (unit) {
    case 'kb':
    case 'kib':
      return Math.round(value * 1024);
    case 'mb':
    case 'mib':
      return Math.round(value * 1024 * 1024);
    case 'gb':
    case 'gib':
      return Math.round(value * 1024 * 1024 * 1024);
    default:
      return Math.round(value);
  }
}

/**
 * Convert a progress block (key→value map) to a ProgressInfo.
 */
function buildProgress(
  block: PartialProgress,
  totalDurationUs?: number,
): ProgressInfo {
  const outTimeUs = parseIntSafe(block['out_time_us'] ?? block['out_time_ms']);
  const progressVal = block['progress'] ?? 'continue';
  const progress: 'continue' | 'end' = progressVal === 'continue' || progressVal === 'end' ? progressVal : 'continue';

  const info: ProgressInfo = {
    frame: parseIntSafe(block['frame']),
    fps: parseFloatSafe(block['fps']),
    bitrate: block['bitrate'] ?? 'N/A',
    totalSize: parseSize(block['total_size'] ?? '0'),
    outTimeUs,
    outTime: block['out_time'] ?? '00:00:00.000000',
    dupFrames: parseIntSafe(block['dup_frames']),
    dropFrames: parseIntSafe(block['drop_frames']),
    speed: parseSpeed(block['speed'] ?? 'N/A'),
    progress,
  };

  if (totalDurationUs !== undefined && totalDurationUs > 0) {
    info.percent = Math.max(0, Math.min(100, (outTimeUs / totalDurationUs) * 100));
  }

  return info;
}

/**
 * Stateful parser: call push(line) for each stderr line.
 * When a complete block is ready, onProgress is called.
 */
export class ProgressParser {
  private block: PartialProgress = {};
  private readonly onProgress: (info: ProgressInfo) => void;
  private readonly totalDurationUs: number | undefined;

  constructor(
    onProgress: (info: ProgressInfo) => void,
    totalDurationUs?: number,
  ) {
    this.onProgress = onProgress;
    this.totalDurationUs = totalDurationUs;
  }

  push(line: string): void {
    const eq = line.indexOf('=');
    if (eq === -1) return;

    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();

    // Bound the block: if ffmpeg never emits `progress=` (e.g. -progress was
    // not passed, or the run aborts), every key=value stderr line would
    // otherwise accumulate here for the lifetime of the process.
    if (this.block[key] === undefined && Object.keys(this.block).length >= MAX_PROGRESS_KEYS) {
      return;
    }

    this.block[key] = value;

    if (key === 'progress') {
      this.onProgress(buildProgress(this.block, this.totalDurationUs));
      this.block = {};
    }
  }
}

/**
 * Convenience: parse a complete stderr dump (e.g. from a test fixture)
 * and return all ProgressInfo blocks found.
 */
export function parseAllProgress(
  stderrOutput: string,
  totalDurationUs?: number,
): ProgressInfo[] {
  const results: ProgressInfo[] = [];
  const parser = new ProgressParser((info) => results.push(info), totalDurationUs);
  for (const line of stderrOutput.split('\n')) {
    parser.push(line);
  }
  return results;
}
