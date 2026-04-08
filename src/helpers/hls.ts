/**
 * HLS and DASH packaging helpers.
 * Each helper returns a fully configured FFmpegBuilder — call .run() to execute.
 */

import { FFmpegBuilder } from '../FFmpeg.js';

// ─── HLS ──────────────────────────────────────────────────────────────────────

export interface HlsOptions {
  /** Input file path */
  input: string;
  /** Output directory for HLS segments. Must exist. */
  outputDir: string;
  /** Playlist filename. Default: 'playlist.m3u8' */
  playlistName?: string;
  /** Segment duration in seconds. Default: 6 */
  segmentDuration?: number;
  /** Segment filename pattern. Default: 'segment%03d.ts' */
  segmentFilename?: string;
  /** Number of segments to keep in playlist. 0=all. Default: 0 */
  hlsListSize?: number;
  /** HLS version. Default: 3 */
  hlsVersion?: 3 | 4 | 5 | 6 | 7;
  /** Video codec. Default: 'libx264' */
  videoCodec?: string;
  /** Video bitrate. Default: '2M' */
  videoBitrate?: string;
  /** Audio codec. Default: 'aac' */
  audioCodec?: string;
  /** Audio bitrate. Default: '128k' */
  audioBitrate?: string;
  /** HLS flags (comma-separated). Common: 'delete_segments', 'append_list', 'split_by_time' */
  hlsFlags?: string;
  /** Keyframe interval (must align with segment duration × fps). Default: 48 */
  gopSize?: number;
  /** Force IDR frame at each segment boundary */
  forceKeyFrames?: string;
  /** CRF value for VBR quality mode */
  crf?: number;
  /** Fast start (moov atom at beginning). Applied per segment. */
  movflags?: string;
  /** Encryption key info file for AES-128 */
  hlsKeyInfoFile?: string;
  /** Path to ffmpeg binary */
  binary?: string;
}

/**
 * Create an HLS packaging builder.
 * Produces a .m3u8 playlist and .ts segment files.
 *
 * @example
 * await hlsPackage({
 *   input: 'input.mp4',
 *   outputDir: './hls',
 *   segmentDuration: 6,
 *   videoCodec: 'libx264',
 *   videoBitrate: '2M',
 * }).run();
 */
export function hlsPackage(opts: HlsOptions): FFmpegBuilder {
  const {
    input,
    outputDir,
    playlistName = 'playlist.m3u8',
    segmentDuration = 6,
    segmentFilename = 'segment%03d.ts',
    hlsListSize = 0,
    hlsVersion: _hlsVersion = 3,
    videoCodec = 'libx264',
    videoBitrate = '2M',
    audioCodec = 'aac',
    audioBitrate = '128k',
    hlsFlags,
    gopSize = 48,
    forceKeyFrames,
    crf,
    movflags,
    hlsKeyInfoFile,
    binary,
  } = opts;

  const outputPath = `${outputDir}/${playlistName}`;
  const segmentPath = `${outputDir}/${segmentFilename}`;

  const builder = new FFmpegBuilder(input)
    .overwrite()
    .output(outputPath)
    .outputFormat('hls')
    .videoCodec(videoCodec)
    .videoBitrate(videoBitrate)
    .audioCodec(audioCodec)
    .audioBitrate(audioBitrate)
    .addOutputOption('-g', String(gopSize))
    .addOutputOption('-sc_threshold', '0')
    .addOutputOption('-hls_time', String(segmentDuration))
    .addOutputOption('-hls_list_size', String(hlsListSize))
    .addOutputOption('-hls_segment_filename', segmentPath);

  if (crf !== undefined) builder.addOutputOption('-crf', String(crf));
  if (movflags !== undefined) builder.addOutputOption('-movflags', movflags);
  if (forceKeyFrames !== undefined)
    builder.addOutputOption('-force_key_frames', forceKeyFrames);
  if (hlsFlags !== undefined)
    builder.addOutputOption('-hls_flags', hlsFlags);
  if (hlsKeyInfoFile !== undefined)
    builder.addOutputOption('-hls_key_info_file', hlsKeyInfoFile);

  if (binary !== undefined) builder.setBinary(binary);
  return builder;
}

// ─── Adaptive HLS (multi-bitrate) ────────────────────────────────────────────

export interface HlsVariant {
  /** Variant label, used in segment filename prefix and bandwidth value */
  label: string;
  /** Video bitrate for this variant, e.g. '4M', '2M', '800k' */
  videoBitrate: string;
  /** Output resolution, e.g. '1920x1080', '1280x720', '854x480' */
  resolution: string;
  /** Audio bitrate, e.g. '192k', '128k', '96k' */
  audioBitrate?: string;
  /** CRF for this variant */
  crf?: number;
}

export interface AdaptiveHlsOptions {
  input: string;
  outputDir: string;
  /** Variants to encode (renditions). Sorted highest→lowest bitrate. */
  variants: HlsVariant[];
  /** Segment duration in seconds. Default: 6 */
  segmentDuration?: number;
  /** HLS version. Default: 3 */
  hlsVersion?: 3 | 4 | 5 | 6 | 7;
  /** Video codec. Default: 'libx264' */
  videoCodec?: string;
  /** Audio codec. Default: 'aac' */
  audioCodec?: string;
  /** Variant playlist filename pattern. Default: '%v/playlist.m3u8' */
  variantPlaylist?: string;
  /** Segment filename pattern. Default: '%v/segment%03d.ts' */
  segmentPattern?: string;
  /** Master playlist filename. Default: 'master.m3u8' */
  masterPlaylist?: string;
  /** HLS flags */
  hlsFlags?: string;
  binary?: string;
}

/**
 * Create a multi-bitrate adaptive HLS builder using ffmpeg's stream_loop and
 * filter_complex for multi-output in a single pass.
 *
 * Returns the FFmpegBuilder with all streams and maps configured.
 *
 * @example
 * await adaptiveHls({
 *   input: 'input.mp4',
 *   outputDir: './hls',
 *   variants: [
 *     { label: '1080p', videoBitrate: '4M', resolution: '1920x1080' },
 *     { label: '720p',  videoBitrate: '2M', resolution: '1280x720'  },
 *     { label: '480p',  videoBitrate: '800k', resolution: '854x480' },
 *   ],
 * }).run();
 */
export function adaptiveHls(opts: AdaptiveHlsOptions): FFmpegBuilder {
  const {
    input,
    outputDir,
    variants,
    segmentDuration = 6,
    hlsVersion: _hlsVersion = 3,
    videoCodec = 'libx264',
    audioCodec = 'aac',
    variantPlaylist = '%v/playlist.m3u8',
    segmentPattern = '%v/segment%03d.ts',
    masterPlaylist = 'master.m3u8',
    hlsFlags,
    binary,
  } = opts;

  // Build filter_complex: split video to N scaled streams + split audio to N streams
  const vSplit = `[0:v]split=${variants.length}${variants.map((_, i) => `[v${i}]`).join('')}`;
  const aSplit = `[0:a]asplit=${variants.length}${variants.map((_, i) => `[a${i}]`).join('')}`;
  const scaleFilters = variants.map((v, i) => {
    const [w, h] = v.resolution.replace('x', ':').split(':');
    return `[v${i}]scale=${w ?? '-2'}:${h ?? '-2'}[vout${i}]`;
  });

  const filterComplex = [vSplit, aSplit, ...scaleFilters].join(';');

  const builder = new FFmpegBuilder(input)
    .overwrite()
    .complexFilter(filterComplex);

  // Map each variant stream to an output
  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];
    if (variant === undefined) continue;
    const outputPlaylist = `${outputDir}/${variantPlaylist.replace('%v', variant.label)}`;
    const segmentFile = `${outputDir}/${segmentPattern.replace('%v', variant.label)}`;

    builder
      .output(outputPlaylist)
      .outputFormat('hls')
      .map(`[vout${i}]`)
      .map(`[a${i}]`)
      .videoCodec(videoCodec)
      .videoBitrate(variant.videoBitrate)
      .audioCodec(audioCodec)
      .audioBitrate(variant.audioBitrate ?? '128k');

    if (variant.crf !== undefined) builder.crf(variant.crf);

    builder
      .addOutputOption('-hls_time', String(segmentDuration))
      .addOutputOption('-hls_list_size', '0')
      .addOutputOption('-hls_segment_filename', segmentFile)
      .addOutputOption('-g', String(segmentDuration * 30)) // approximate
      .addOutputOption('-sc_threshold', '0');

    if (hlsFlags !== undefined) builder.addOutputOption('-hls_flags', hlsFlags);
    builder.addOutputOption('-master_pl_name', masterPlaylist);
  }

  if (binary !== undefined) builder.setBinary(binary);
  return builder;
}

// ─── DASH ─────────────────────────────────────────────────────────────────────

export interface DashOptions {
  /** Input file path */
  input: string;
  /** Output MPD file path */
  output: string;
  /** Segment duration in seconds. Default: 4 */
  segmentDuration?: number;
  /** Window size (number of segments to keep). 0=all. Default: 0 */
  windowSize?: number;
  /** Video codec. Default: 'libx264' */
  videoCodec?: string;
  /** Video bitrate. Default: '2M' */
  videoBitrate?: string;
  /** Audio codec. Default: 'aac' */
  audioCodec?: string;
  /** Audio bitrate. Default: '128k' */
  audioBitrate?: string;
  /** Use ISOFF segment template. Default: true */
  useTemplate?: boolean;
  /** Use timeline in segment template. Default: true */
  useTimeline?: boolean;
  /** Minimum buffer time in seconds. Default: 1.5 */
  minBufferTime?: number;
  /** Additional DASH-specific options */
  dashFlags?: string;
  /** Initialization segment filename pattern */
  initSegmentName?: string;
  /** Segment filename pattern */
  mediaSegmentName?: string;
  binary?: string;
}

/**
 * Create a DASH packaging builder.
 * Produces an .mpd manifest and DASH segments.
 *
 * @example
 * await dashPackage({
 *   input: 'input.mp4',
 *   output: './dash/manifest.mpd',
 *   segmentDuration: 4,
 *   videoCodec: 'libx264',
 *   videoBitrate: '2M',
 * }).run();
 */
export function dashPackage(opts: DashOptions): FFmpegBuilder {
  const {
    input,
    output,
    segmentDuration = 4,
    windowSize = 0,
    videoCodec = 'libx264',
    videoBitrate = '2M',
    audioCodec = 'aac',
    audioBitrate = '128k',
    useTemplate = true,
    useTimeline = true,
    minBufferTime = 1.5,
    dashFlags,
    initSegmentName,
    mediaSegmentName,
    binary,
  } = opts;

  const builder = new FFmpegBuilder(input)
    .overwrite()
    .output(output)
    .outputFormat('dash')
    .videoCodec(videoCodec)
    .videoBitrate(videoBitrate)
    .audioCodec(audioCodec)
    .audioBitrate(audioBitrate)
    .addOutputOption('-seg_duration', String(segmentDuration))
    .addOutputOption('-window_size', String(windowSize))
    .addOutputOption('-min_buffer_time', String(minBufferTime));

  if (useTemplate)
    builder.addOutputOption('-use_template', '1');
  if (useTimeline)
    builder.addOutputOption('-use_timeline', '1');
  if (dashFlags !== undefined)
    builder.addOutputOption('-dash_flags', dashFlags);
  if (initSegmentName !== undefined)
    builder.addOutputOption('-init_seg_name', initSegmentName);
  if (mediaSegmentName !== undefined)
    builder.addOutputOption('-media_seg_name', mediaSegmentName);

  if (binary !== undefined) builder.setBinary(binary);
  return builder;
}

// ─── Arg builders (testable without ffmpeg) ───────────────────────────────────

export function buildHlsArgs(input: string, outputDir: string, opts: HlsOptions): string[] {
  const segDuration = opts.segmentDuration ?? 6;
  const playlistName = opts.playlistName ?? 'playlist.m3u8';
  const args: string[] = ['-y', '-i', input];
  if (opts.videoCodec) args.push('-c:v', opts.videoCodec);
  if (opts.audioBitrate) args.push('-b:a', opts.audioBitrate);
  if (opts.videoBitrate) args.push('-b:v', opts.videoBitrate);
  // -f hls MUST appear before any hls_* output-private options
  args.push('-f', 'hls');
  args.push(
    '-hls_time', String(segDuration),
    '-hls_list_size', String(opts.hlsListSize ?? 0),
  );
  if (opts.hlsFlags) args.push('-hls_flags', opts.hlsFlags);
  args.push(`${outputDir}/${playlistName}`);
  return args;
}

export function buildDashArgs(input: string, outputPath: string, opts: DashOptions): string[] {
  const args: string[] = ['-y', '-i', input];
  if (opts.videoCodec) args.push('-c:v', opts.videoCodec);
  if (opts.audioCodec) args.push('-c:a', opts.audioCodec);
  if (opts.videoBitrate) args.push('-b:v', opts.videoBitrate);
  if (opts.audioBitrate) args.push('-b:a', opts.audioBitrate);
  args.push('-f', 'dash');
  if (opts.segmentDuration) args.push('-seg_duration', String(opts.segmentDuration));
  args.push(outputPath);
  return args;
}
