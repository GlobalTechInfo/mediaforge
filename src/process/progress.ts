import type { ProgressInfo } from '../types/progress.js';

/**
 * FFmpeg emits progress as a block of key=value pairs terminated by
 * "progress=continue" or "progress=end" when -progress is passed.
 * This parser accumulates lines and yields a ProgressInfo on each
 * complete block.
 */

type PartialProgress = Partial<Record<string, string>>;

function parseSpeed(raw: string): number {
  // "2.50x" → 2.5,  "N/A" → 0
  if (raw === 'N/A' || raw === '') return 0;
  const stripped = raw.replace('x', '');
  const n = parseFloat(stripped);
  return isNaN(n) ? 0 : n;
}

function parseSize(raw: string): number {
  // "4096kB" or "4096KiB" or "1234567"
  if (raw === 'N/A' || raw === '') return 0;
  const m = /^(\d+(?:\.\d+)?)\s*(kB|KiB|MB|MiB|GB|GiB)?$/i.exec(raw);
  if (m === null) {
    const n = parseInt(raw, 10);
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
  const outTimeUs = parseInt(block['out_time_us'] ?? block['out_time_ms'] ?? '0', 10);
  const progress = (block['progress'] ?? 'continue') as 'continue' | 'end';

  const info: ProgressInfo = {
    frame: parseInt(block['frame'] ?? '0', 10),
    fps: parseFloat(block['fps'] ?? '0'),
    bitrate: block['bitrate'] ?? 'N/A',
    totalSize: parseSize(block['total_size'] ?? '0'),
    outTimeUs,
    outTime: block['out_time'] ?? '00:00:00.000000',
    dupFrames: parseInt(block['dup_frames'] ?? '0', 10),
    dropFrames: parseInt(block['drop_frames'] ?? '0', 10),
    speed: parseSpeed(block['speed'] ?? 'N/A'),
    progress,
  };

  if (totalDurationUs !== undefined && totalDurationUs > 0) {
    info.percent = Math.min(100, (outTimeUs / totalDurationUs) * 100);
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
