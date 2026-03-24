import type { Buffer } from 'node:buffer';
import { execFileSync, spawn } from 'node:child_process';
import { resolveProbe } from '../utils/binary.ts';
import type {
  ProbeResult,
  ProbeStream,
  ProbeFormat,
  ProbeChapter,
  ParsedFrameRate,
  VideoStreamSummary,
  AudioStreamSummary,
} from '../types/probe.ts';

// ─── Core probe function ───────────────────────────────────────────────────────

export interface ProbeOptions {
  /** Path to ffprobe binary (default: FFPROBE_PATH env or 'ffprobe') */
  binary?: string;
  /** Include chapter information. Default: true */
  chapters?: boolean;
  /** Timeout in ms. Default: 30000 */
  timeout?: number;
  /** Extra ffprobe args to pass */
  extraArgs?: string[];
}

/**
 * Run ffprobe on a file and return fully typed JSON output.
 * Synchronous version — use `probeAsync` for non-blocking operation.
 *
 * @example
 * const info = probe('input.mp4');
 * console.log(info.format?.duration); // "120.042000"
 * console.log(info.streams[0].codec_name); // "h264"
 */
export function probe(filePath: string, opts: ProbeOptions = {}): ProbeResult {
  const binary = resolveProbe(opts.binary);
  const args = buildProbeArgs(filePath, opts);

  let output: string;
  try {
    output = execFileSync(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: opts.timeout ?? 30000,
    });
  } catch (err: unknown) {
    const msg = (err as Error).message ?? String(err);
    throw new ProbeError(filePath, msg);
  }

  return parseProbeOutput(output, filePath);
}

/**
 * Async version of probe — non-blocking, suitable for server use.
 */
export function probeAsync(
  filePath: string,
  opts: ProbeOptions = {},
): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const binary = resolveProbe(opts.binary);
    const args = buildProbeArgs(filePath, opts);
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new ProbeError(filePath, stderr.slice(-1000)));
        return;
      }
      try {
        resolve(parseProbeOutput(stdout, filePath));
      } catch (e) {
        reject(e);
      }
    });

    child.on('error', (err) => reject(new ProbeError(filePath, err.message)));
  });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function buildProbeArgs(filePath: string, opts: ProbeOptions): string[] {
  const showArgs = ['-show_format', '-show_streams'];
  if (opts.chapters !== false) showArgs.push('-show_chapters');

  return [
    '-v', 'quiet',
    '-print_format', 'json',
    ...showArgs,
    ...(opts.extraArgs ?? []),
    filePath,
  ];
}

function parseProbeOutput(output: string, filePath: string): ProbeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output) as unknown;
  } catch {
    throw new ProbeError(filePath, `Failed to parse ffprobe JSON output: ${output.slice(0, 200)}`);
  }

  if (parsed === null || typeof parsed !== 'object') {
    throw new ProbeError(filePath, 'ffprobe returned non-object JSON');
  }

  const obj = parsed as Record<string, unknown>;
  const result: ProbeResult = {
    streams: (obj['streams'] as ProbeStream[] | undefined) ?? [],
  };
  const fmt = obj['format'] as ProbeFormat | undefined;
  if (fmt !== undefined) result.format = fmt;
  const chs = obj['chapters'] as ProbeChapter[] | undefined;
  if (chs !== undefined) result.chapters = chs;
  return result;
}

// ─── Error class ──────────────────────────────────────────────────────────────

export class ProbeError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly detail: string,
  ) {
    super(`ffprobe failed for "${filePath}": ${detail}`);
    this.name = 'ProbeError';
  }
}

// ─── Derived helpers ──────────────────────────────────────────────────────────

/**
 * Parse an ffprobe fractional frame rate string into a numeric value.
 * e.g. "30000/1001" → { num:30000, den:1001, value:29.97 }
 * e.g. "25/1" → { num:25, den:1, value:25 }
 */
export function parseFrameRate(frStr: string | undefined): ParsedFrameRate | null {
  if (frStr === undefined || frStr === '' || frStr === '0/0') return null;
  const parts = frStr.split('/');
  if (parts.length !== 2) return null;
  const num = parseInt(parts[0] ?? '0', 10);
  const den = parseInt(parts[1] ?? '1', 10);
  if (den === 0) return null;
  return { num, den, value: num / den };
}

/**
 * Parse a duration string from ffprobe (e.g. "120.042000") to a number.
 * Returns null if the value is absent or "N/A".
 */
export function parseDuration(durStr: string | undefined): number | null {
  if (durStr === undefined || durStr === 'N/A' || durStr === '') return null;
  const n = parseFloat(durStr);
  return isNaN(n) ? null : n;
}

/**
 * Parse a bitrate string (e.g. "4200000") to a number.
 */
export function parseBitrate(brStr: string | undefined): number | null {
  if (brStr === undefined || brStr === 'N/A' || brStr === '') return null;
  const n = parseInt(brStr, 10);
  return isNaN(n) ? null : n;
}

/**
 * Get all video streams from a ProbeResult.
 */
export function getVideoStreams(result: ProbeResult): ProbeStream[] {
  return result.streams.filter((s) => s.codec_type === 'video');
}

/**
 * Get all audio streams from a ProbeResult.
 */
export function getAudioStreams(result: ProbeResult): ProbeStream[] {
  return result.streams.filter((s) => s.codec_type === 'audio');
}

/**
 * Get all subtitle streams from a ProbeResult.
 */
export function getSubtitleStreams(result: ProbeResult): ProbeStream[] {
  return result.streams.filter((s) => s.codec_type === 'subtitle');
}

/**
 * Get the first video stream, or null if none exists.
 */
export function getDefaultVideoStream(result: ProbeResult): ProbeStream | null {
  return getVideoStreams(result)[0] ?? null;
}

/**
 * Get the first audio stream, or null if none exists.
 */
export function getDefaultAudioStream(result: ProbeResult): ProbeStream | null {
  return getAudioStreams(result)[0] ?? null;
}

/**
 * Return the total duration of the media in seconds.
 * Prefers format.duration, falls back to the first stream with a duration.
 */
export function getMediaDuration(result: ProbeResult): number | null {
  const fromFormat = parseDuration(result.format?.duration);
  if (fromFormat !== null) return fromFormat;
  for (const stream of result.streams) {
    const d = parseDuration(stream.duration);
    if (d !== null) return d;
  }
  return null;
}

/**
 * Convert total duration in seconds to microseconds (for progress calculation).
 */
export function durationToMicroseconds(seconds: number): number {
  return Math.round(seconds * 1_000_000);
}

/**
 * Build a human-readable summary of a video stream.
 */
export function summarizeVideoStream(s: ProbeStream): VideoStreamSummary {
  const fps = parseFrameRate(s.avg_frame_rate ?? s.r_frame_rate);
  const vss: VideoStreamSummary = {
    index: s.index,
    codec: s.codec_name ?? 'unknown',
    width: s.width ?? 0,
    height: s.height ?? 0,
    fps: fps?.value ?? 0,
    pixFmt: s.pix_fmt ?? 'unknown',
    durationSec: parseDuration(s.duration),
    bitrateBps: parseBitrate(s.bit_rate),
  };
  if (s.profile !== undefined) vss.profile = s.profile;
  if (s.color_space !== undefined) vss.colorSpace = s.color_space;
  return vss;
}

/**
 * Build a human-readable summary of an audio stream.
 */
export function summarizeAudioStream(s: ProbeStream): AudioStreamSummary {
  return {
    index: s.index,
    codec: s.codec_name ?? 'unknown',
    sampleRate: parseInt(s.sample_rate ?? '0', 10),
    channels: s.channels ?? 0,
    channelLayout: s.channel_layout ?? 'unknown',
    durationSec: parseDuration(s.duration),
    bitrateBps: parseBitrate(s.bit_rate),
  };
}

/**
 * Get a stream's language tag, or null if not set.
 */
export function getStreamLanguage(s: ProbeStream): string | null {
  return s.tags?.['language'] ?? null;
}

/**
 * Find a stream by language tag (case-insensitive).
 * Returns the first match, or null.
 */
export function findStreamByLanguage(
  result: ProbeResult,
  lang: string,
  codecType?: 'video' | 'audio' | 'subtitle',
): ProbeStream | null {
  const lowerLang = lang.toLowerCase();
  for (const s of result.streams) {
    if (codecType !== undefined && s.codec_type !== codecType) continue;
    const sl = getStreamLanguage(s)?.toLowerCase();
    if (sl === lowerLang) return s;
  }
  return null;
}

/**
 * Format a duration in seconds to a human-readable HH:MM:SS.mmm string.
 */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

/**
 * Check if a file appears to be HDR (BT.2020 primaries or PQ/HLG transfer).
 */
export function isHdr(result: ProbeResult): boolean {
  const vs = getDefaultVideoStream(result);
  if (vs === null) return false;
  const hdrPrimaries = ['bt2020'];
  const hdrTransfer = ['smpte2084', 'arib-std-b67', 'smpte428', 'bt2020-10', 'bt2020-12'];
  return (
    hdrPrimaries.includes(vs.color_primaries ?? '') ||
    hdrTransfer.includes(vs.color_transfer ?? '')
  );
}

/**
 * Check if a file's video stream is interlaced.
 */
export function isInterlaced(result: ProbeResult): boolean {
  const vs = getDefaultVideoStream(result);
  if (vs === null) return false;
  const fo = vs.field_order;
  return fo !== undefined && fo !== 'progressive' && fo !== 'unknown';
}

/**
 * Get all chapter titles and times as a simple array.
 */
export function getChapterList(result: ProbeResult): Array<{ title: string; startSec: number; endSec: number }> {
  return (result.chapters ?? []).map((ch) => ({
    title: ch.tags?.['title'] ?? `Chapter ${ch.id ?? '?'}`,
    startSec: parseDuration(ch.start_time) ?? 0,
    endSec: parseDuration(ch.end_time) ?? 0,
  }));
}
