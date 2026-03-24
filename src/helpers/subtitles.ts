import { FFmpegBuilder } from '../FFmpeg.js';
import { runFFmpeg } from '../process/spawn.js';
import { resolveBinary } from '../utils/binary.js';

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

  // Build subtitle filter with optional style overrides
  const escapedPath = subtitleFile.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
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

// ─── Arg builders ─────────────────────────────────────────────────────────────

export function buildBurnSubtitlesFilter(
  subtitleFile: string,
  fontSize?: number,
  fontName?: string,
  primaryColor?: string,
): string {
  const escapedPath = subtitleFile.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  let filter = `subtitles='${escapedPath}'`;
  const styles: string[] = [];
  if (fontSize)     styles.push(`FontSize=${fontSize}`);
  if (fontName)     styles.push(`FontName=${fontName}`);
  if (primaryColor) styles.push(`PrimaryColour=${primaryColor}`);
  if (styles.length > 0) filter += `:force_style='${styles.join(',')}'`;
  return filter;
}
