import * as fs from 'fs';
import * as path from 'path';
import { spawnFFmpeg } from '../process/spawn.js';
import { resolveBinary } from '../utils/binary.js';

export interface ScreenshotOptions {
  /** Input file path */
  input: string;
  /** Output folder for screenshots */
  folder: string;
  /** Number of evenly-spaced screenshots (mutually exclusive with timestamps) */
  count?: number;
  /** Specific timestamps to capture, e.g. ['00:00:05', '00:00:10', 50.5] */
  timestamps?: (string | number)[];
  /** Output filename pattern, e.g. 'thumb_%04d.png'. Default: 'screenshot_%04d.png' */
  filename?: string;
  /** Output size, e.g. '1280x720'. Default: source size */
  size?: string;
  /** ffmpeg binary override */
  binary?: string;
}

export interface ScreenshotResult {
  /** Absolute paths to created screenshot files */
  files: string[];
}

function toSeconds(ts: string | number): number {
  if (typeof ts === 'number') return ts;
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return Number(ts);
}

/**
 * Extract screenshots from a video file.
 *
 * @example
 * // 5 evenly-spaced screenshots
 * const { files } = await screenshots({ input: 'video.mp4', folder: './thumbs', count: 5 });
 *
 * @example
 * // At specific timestamps
 * const { files } = await screenshots({
 *   input: 'video.mp4', folder: './thumbs',
 *   timestamps: ['00:00:05', '00:00:30', 90],
 * });
 */
export async function screenshots(opts: ScreenshotOptions): Promise<ScreenshotResult> {
  const {
    input,
    folder,
    count,
    timestamps,
    filename = 'screenshot_%04d.png',
    size,
    binary = resolveBinary(),
  } = opts;

  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

  if (timestamps && timestamps.length > 0) {
    // Per-timestamp mode: one ffmpeg call per timestamp
    const files: string[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i]!;
      const ext = path.extname(filename) || '.png';
      const base = path.basename(filename, ext);
      // Replace %04d style format with index
      const outName = base.replace(/%0?\d*d/, String(i + 1).padStart(4, '0')) + ext;
      const outPath = path.join(folder, outName);

      const args: string[] = ['-y', '-ss', String(toSeconds(ts)), '-i', input, '-vframes', '1'];
      if (size) args.push('-s', size);
      args.push(outPath);

      await new Promise<void>((resolve, reject) => {
        const proc = spawnFFmpeg({ binary, args });
        proc.emitter.on('end', resolve);
        proc.emitter.on('error', reject);
      });

      files.push(outPath);
    }
    return { files };
  }

  if (count && count > 0) {
    // Count mode: use fps filter to extract N evenly-spaced frames
    // Get duration first via ffprobe
    const { probe } = await import('../probe/ffprobe.js');
    const info = probe(input);
    const duration = info.format?.duration ? parseFloat(info.format.duration) : null;

    if (duration === null || duration <= 0) {
      throw new Error(`Cannot determine duration of "${input}" for count-based screenshots`);
    }

    const interval = duration / (count + 1);
    const times = Array.from({ length: count }, (_, i) => interval * (i + 1));
    const { count: _count, ...restOpts } = opts;
    return screenshots({ ...restOpts, timestamps: times });
  }

  // Fallback: single screenshot at 0
  const { count: _count2, ...restOpts2 } = opts;
  return screenshots({ ...restOpts2, timestamps: [0] });
}

/**
 * Extract a single frame at a given timestamp and return it as a Buffer.
 *
 * @example
 * const buf = await frameToBuffer({ input: 'video.mp4', timestamp: 30, format: 'png' });
 * fs.writeFileSync('frame.png', buf);
 */
export interface FrameToBufferOptions {
  input: string;
  timestamp?: string | number;
  format?: 'png' | 'mjpeg' | 'bmp';
  size?: string;
  binary?: string;
}

export async function frameToBuffer(opts: FrameToBufferOptions): Promise<Buffer> {
  const {
    input,
    timestamp = 0,
    format = 'png',
    size,
    binary = resolveBinary(),
  } = opts;

  const args: string[] = [
    '-y',
    '-ss', String(toSeconds(timestamp)),
    '-i', input,
    '-vframes', '1',
    '-f', 'image2pipe',
    '-vcodec', format === 'mjpeg' ? 'mjpeg' : format,
  ];
  if (size) args.push('-s', size);
  args.push('pipe:1');

  return new Promise<Buffer>((resolve, reject) => {
    const proc = spawnFFmpeg({ binary, args });
    const chunks: Buffer[] = [];

    if (proc.stdout) {
      proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    }

    proc.emitter.on('end', () => resolve(Buffer.concat(chunks)));
    proc.emitter.on('error', reject);
  });
}

// ─── Arg builders ─────────────────────────────────────────────────────────────

export function buildScreenshotArgs(input: string, outputPath: string, timestamp: number, size?: string): string[] {
  const args: string[] = ['-y', '-ss', String(timestamp), '-i', input, '-vframes', '1'];
  if (size) args.push('-s', size);
  args.push(outputPath);
  return args;
}

export function buildFrameBufferArgs(input: string, timestamp: number, format: string, size?: string): string[] {
  const args: string[] = ['-y', '-ss', String(timestamp), '-i', input, '-vframes', '1',
    '-f', 'image2pipe', '-vcodec', format === 'mjpeg' ? 'mjpeg' : format];
  if (size) args.push('-s', size);
  args.push('pipe:1');
  return args;
}

export function buildTimestampFilename(pattern: string, index: number, ext: string): string {
  const base = path.basename(pattern, ext);
  return base.replace(/%0?\d*d/, String(index + 1).padStart(4, '0')) + ext;
}
