import { FFmpegBuilder } from '../FFmpeg.ts';
import { runFFmpeg } from '../process/spawn.ts';
import { resolveBinary } from '../utils/binary.ts';
import { escapeFilterValue } from '../utils/filter.ts';

export interface BurnSubtitlesOptions {
  /** Input video */
  input: string;
  /** Subtitle file (.srt, .ass, .vtt, etc.) */
  subtitleFile: string;
  /** Output file */
  output: string;
  /** Font size override */
  fontSize?: number;
  /** Font name override */
  fontName?: string;
  /** Primary color (ASS format, e.g. '&H00FFFFFF&') */
  primaryColor?: string;
  /** Video codec. Default: 'libx264' */
  videoCodec?: string;
  /** ffmpeg binary override */
  binary?: string;
}

/**
 * Burn (hardcode) subtitles into a video.
 *
 * @example
 * await burnSubtitles({
 *   input: 'video.mp4',
 *   subtitleFile: 'subs.srt',
 *   output: 'video-subbed.mp4',
 *   fontSize: 24,
 * });
 */
export async function burnSubtitles(opts: BurnSubtitlesOptions): Promise<void> {
  const {
    input,
    subtitleFile,
    output,
    fontSize,
    fontName,
    primaryColor,
    videoCodec = 'libx264',
    binary = resolveBinary(),
  } = opts;

  const escapedPath = escapeFilterValue(subtitleFile);
  let filter = `subtitles='${escapedPath}'`;

  const styles: string[] = [];
  if (fontSize)     styles.push(`FontSize=${fontSize}`);
  if (fontName)     styles.push(`FontName=${fontName}`);
  if (primaryColor) styles.push(`PrimaryColour=${primaryColor}`);
  if (styles.length > 0) filter += `:force_style='${styles.join(',')}'`;

  await new FFmpegBuilder(input)
    .output(output)
    .videoFilter(filter)
    .videoCodec(videoCodec)
    .audioCodec('copy')
    .setBinary(binary)
    .run();
}

export interface ExtractSubtitlesOptions {
  /** Input file */
  input: string;
  /** Output subtitle file (.srt, .ass, etc.) */
  output: string;
  /** Stream index. Default: 0 */
  streamIndex?: number;
  /** ffmpeg binary override */
  binary?: string;
}

/**
 * Extract a subtitle stream from a container to a file.
 *
 * @example
 * await extractSubtitles({ input: 'video.mkv', output: 'subs.srt' });
 */
export async function extractSubtitles(opts: ExtractSubtitlesOptions): Promise<void> {
  const { input, output, streamIndex = 0, binary = resolveBinary() } = opts;
  await runFFmpeg({
    binary,
    args: ['-y', '-i', input, '-map', `0:s:${streamIndex}`, output],
  });
}

// ─── Subtitle conversion ────────────────────────────────────────────────────

/** Subtitle containers ffmpeg's mov/mp4 muxer accepts. */
export type SubtitleFormat = 'srt' | 'ass' | 'ssa' | 'vtt' | 'webvtt' | 'mov_text' | 'text' | 'subrip';

/**
 * Codec name for a target subtitle format.
 *
 * `mov_text` is the only subtitle codec MP4 supports; everything else in an
 * MP4 has to stay in a sidecar file. Returning the codec rather than the file
 * extension keeps `convertSubtitles` honest about that.
 */
export function subtitleCodecFor(format: SubtitleFormat): string {
  const map: Record<SubtitleFormat, string> = {
    srt: 'srt',
    subrip: 'srt',
    ass: 'ass',
    ssa: 'ssa',
    vtt: 'webvtt',
    webvtt: 'webvtt',
    mov_text: 'mov_text',
    text: 'text',
  };
  const codec = map[format];
  if (!codec) {
    throw new Error(`Unknown subtitle format "${format}". Valid: ${Object.keys(map).join(', ')}`);
  }
  return codec;
}

/** File extension ffmpeg expects for a subtitle format. */
export function subtitleExtensionFor(format: SubtitleFormat): string {
  switch (format) {
    case 'mov_text': return '.m4v';
    case 'webvtt':
    case 'vtt': return '.vtt';
    case 'ass':
    case 'ssa': return '.ass';
    case 'text': return '.txt';
    default: return '.srt';
  }
}

export interface ConvertSubtitlesOptions {
  /** Input video or subtitle-bearing file. */
  input: string;
  /** Output file. Extension should match `format`. */
  output: string;
  /** Target subtitle format. Default: 'srt' */
  format?: SubtitleFormat;
  /** Which subtitle stream to convert. Default: 0 */
  streamIndex?: number;
  /**
   * Shift all cue timings by this many seconds. Positive is later.
   * Mutually exclusive with `fixDuration`.
   */
  shiftSeconds?: number;
  /**
   * Rescale cue timings so each cue's duration matches its on-screen duration
   * (`-fix_sub_duration`). Often needed after a VFR → CFR conversion, where
   * subtitle timing drifts out of sync with the video.
   */
  fixDuration?: boolean;
  /** Burn the subtitles in as well as converting them. Default: false */
  burn?: boolean;
  videoCodec?: string;
  binary?: string;
}

/**
 * Convert, retime and/or burn subtitles.
 *
 * Wraps the three subtitle jobs that keep coming up separately — format
 * conversion, timing correction, and burning — in one call.
 */
export async function convertSubtitles(opts: ConvertSubtitlesOptions): Promise<void> {
  const {
    input,
    output,
    format = 'srt',
    streamIndex = 0,
    shiftSeconds,
    fixDuration = false,
    burn = false,
    videoCodec = 'libx264',
    binary = resolveBinary(),
  } = opts;

  if (shiftSeconds !== undefined && fixDuration) {
    throw new Error('convertSubtitles: shiftSeconds and fixDuration cannot both be set — pick one timing fix');
  }
  if (shiftSeconds !== undefined && !Number.isFinite(shiftSeconds)) {
    throw new RangeError(`convertSubtitles: shiftSeconds must be a finite number, got ${shiftSeconds}`);
  }

  if (burn) {
    // Burning needs the subtitles as a file on disk, so convert to a temp
    // sidecar first and then hand that to the existing burn implementation.
    const { mkdtempSync, rmSync } = await import('node:fs');
    const os = await import('node:os');
    const pathMod = await import('node:path');
    const tmpDir = mkdtempSync(pathMod.join(os.tmpdir(), 'mediaforge-subs-'));
    const sidecar = pathMod.join(tmpDir, `converted${subtitleExtensionFor(format)}`);
    try {
      await convertSubtitles({ input, output: sidecar, format, streamIndex, ...(shiftSeconds !== undefined ? { shiftSeconds } : {}), ...(fixDuration ? { fixDuration } : {}), binary });
      await burnSubtitles({ input, subtitleFile: sidecar, output, videoCodec, binary });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    return;
  }

  const args: string[] = ['-y'];

  if (shiftSeconds !== undefined) {
    // Applied on input so it affects the decoded subtitle stream.
    args.push('-itsoffset', String(shiftSeconds));
  }
  args.push('-i', input);

  const filters: string[] = [];
  if (fixDuration) filters.push('fix_sub_duration');

  const codec = subtitleCodecFor(format);
  args.push('-map', `0:s:${streamIndex}`, '-c:s', codec);
  if (filters.length > 0) args.push('-vf', filters.join(','));
  args.push(output);

  await runFFmpeg({ binary, args });
}

export interface FixSubtitleDurationOptions {
  input: string;
  output: string;
  format?: SubtitleFormat;
  streamIndex?: number;
  binary?: string;
}

/**
 * Rescale subtitle timings after a frame-rate conversion.
 *
 * `fix_sub_duration` rewrites each cue's end time to match how long it was
 * actually displayed, which is the fix for subtitles that drift out of sync
 * after a VFR → CFR or a speed change.
 */
export async function fixSubtitleDuration(opts: FixSubtitleDurationOptions): Promise<void> {
  const { input, output, format = 'srt', streamIndex = 0, binary = resolveBinary() } = opts;
  await runFFmpeg({
    binary,
    args: ['-y', '-i', input, '-map', `0:s:${streamIndex}`, '-c:s', subtitleCodecFor(format), '-vf', 'fix_sub_duration', output],
  });
}

// ─── Arg builders ─────────────────────────────────────────────────────────────

export function buildBurnSubtitlesFilter(
  subtitleFile: string,
  fontSize?: number,
  fontName?: string,
  primaryColor?: string,
): string {
  const escapedPath = escapeFilterValue(subtitleFile);
  let filter = `subtitles='${escapedPath}'`;
  const styles: string[] = [];
  if (fontSize)     styles.push(`FontSize=${fontSize}`);
  if (fontName)     styles.push(`FontName=${fontName}`);
  if (primaryColor) styles.push(`PrimaryColour=${primaryColor}`);
  if (styles.length > 0) filter += `:force_style='${styles.join(',')}'`;
  return filter;
}
