/**
 * HLS and DASH packaging helpers.
 * Each helper returns a fully configured FFmpegBuilder — call .run() to execute.
 */

import { FFmpegBuilder } from '../FFmpeg.ts';
import { resolveBinary } from '../utils/binary.ts';
import { mkdirSync } from 'node:fs';
import { dirname, basename } from 'node:path';

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
  /**
   * HLS protocol version to write (`-hls_version`), 3-8.
   *
   * This is a top-level hls-muxer option, NOT an `hls_flags` entry — passing
   * `hls_version=3` via `hlsFlags` makes ffmpeg abort with
   * `Unable to parse option value "hls_version=3"`. ffmpeg picks a version
   * automatically when this is omitted.
   */
  hlsVersion?: number;
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
    videoCodec = 'libx264',
    videoBitrate = '2M',
    audioCodec = 'aac',
    audioBitrate = '128k',
    hlsFlags,
    hlsVersion,
    gopSize = 48,
    forceKeyFrames,
    crf,
    movflags,
    hlsKeyInfoFile,
    binary,
  } = opts;

  const outputPath = `${outputDir}/${playlistName}`;
  const segmentPath = `${outputDir}/${segmentFilename}`;

  // ffmpeg's hls muxer does NOT create the output directory. If it is missing,
  // ffmpeg still exits 0 and writes nothing at all — a silent no-op rather than
  // an error. Create it here so the call either works or fails loudly.
  mkdirSync(dirname(outputPath), { recursive: true });
  mkdirSync(dirname(segmentPath), { recursive: true });

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
  if (hlsFlags !== undefined) builder.addOutputOption('-hls_flags', hlsFlags);
  if (hlsVersion !== undefined) {
    if (!Number.isInteger(hlsVersion) || hlsVersion < 3 || hlsVersion > 8) {
      throw new Error(`hlsPackage: hlsVersion must be an integer between 3 and 8, got ${hlsVersion}`);
    }
    builder.addOutputOption('-hls_version', String(hlsVersion));
  }
  if (hlsKeyInfoFile !== undefined) builder.addOutputOption('-hls_key_info_file', hlsKeyInfoFile);

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
    videoCodec = 'libx264',
    audioCodec = 'aac',
    variantPlaylist = '%v.m3u8',
    segmentPattern = '%v_seg%03d.ts',
    masterPlaylist = 'master.m3u8',
    hlsFlags,
    binary,
  } = opts;

  if (variants.length === 0) {
    throw new Error('adaptiveHls requires at least one variant');
  }

  // Validate before building any path or filter string. A missing `resolution`
  // used to blow up as "Cannot read properties of undefined (reading 'replace')"
  // from deep inside the scale-filter construction, and a missing `label` would
  // silently emit "%v.m3u8" with the placeholder unsubstituted.
  variants.forEach((v, i) => {
    if (typeof v?.label !== 'string' || v.label.trim() === '') {
      throw new Error(`adaptiveHls: variant ${i} is missing a non-empty "label"`);
    }
    if (typeof v.resolution !== 'string' || v.resolution.trim() === '') {
      throw new Error(`adaptiveHls: variant "${v.label}" is missing a "resolution" (e.g. "1920x1080")`);
    }
    if (typeof v.videoBitrate !== 'string' || v.videoBitrate.trim() === '') {
      throw new Error(`adaptiveHls: variant "${v.label}" is missing a "videoBitrate" (e.g. "2M")`);
    }
  });

  // Build filter_complex: split video to N scaled streams + split audio to N streams
  const vSplit = `[0:v]split=${variants.length}${variants.map((_, i) => `[v${i}]`).join('')}`;
  const aSplit = `[0:a]asplit=${variants.length}${variants.map((_, i) => `[a${i}]`).join('')}`;
  const scaleFilters = variants.map((v, i) => {
    const parts = v.resolution.replace('x', ':').split(':');
    // Number('') is 0, not NaN, so an incomplete value like "1920x" used to
    // slip through validation and emit scale=1920:0.
    const invalid =
      parts.length !== 2 ||
      parts.some(p => p.trim() === '' || !Number.isFinite(Number(p)) || Number(p) <= 0);
    if (invalid) {
      throw new Error(`Invalid resolution for variant "${v.label}": "${v.resolution}"`);
    }
    const [w, h] = parts;
    return `[v${i}]scale=${w ?? '-2'}:${h ?? '-2'}[vout${i}]`;
  });

  const filterComplex = [vSplit, aSplit, ...scaleFilters].join(';');

  const builder = new FFmpegBuilder(input)
    .overwrite()
    .complexFilter(filterComplex);

  // Create all required directories up front
  const dirs = new Set(variants.flatMap(v => [
    dirname(`${outputDir}/${variantPlaylist.replace('%v', v.label)}`),
    dirname(`${outputDir}/${segmentPattern.replace('%v', v.label)}`),
  ]));
  for (const dir of dirs) mkdirSync(dir, { recursive: true });

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
      .addOutputOption('-force_key_frames', `expr:gte(t,n_forced*${segmentDuration})`)
      .addOutputOption('-sc_threshold', '0');

    if (hlsFlags !== undefined) builder.addOutputOption('-hls_flags', hlsFlags);
    builder.addOutputOption('-master_pl_name', masterPlaylist);
  }

  if (binary !== undefined) builder.setBinary(binary);
  return builder;
}

// ─── var_stream_map ABR ladder ──────────────────────────────────────────────

export interface AbrVariant {
  /** Rendition name, used for the %v substitution in output patterns. */
  name: string;
  /** Output resolution, e.g. '1280x720' */
  resolution: string;
  /** Target video bitrate, e.g. '2M' */
  videoBitrate: string;
  /** Audio bitrate, e.g. '128k' */
  audioBitrate?: string;
}

export interface AbrLadderOptions {
  input: string;
  /** Output playlist pattern; must contain %v, e.g. 'v%v/index.m3u8' */
  outputPattern: string;
  /** Variants, highest bitrate first. */
  variants: AbrVariant[];
  /** Segment length in seconds. Default: 6 */
  segmentDuration?: number;
  videoCodec?: string;
  audioCodec?: string;
  masterPlaylist?: string;
  hlsFlags?: string;
  binary?: string;
}

/**
 * Build the `-var_stream_map` value for a set of variants.
 *
 * Each entry is `v:0,a:0,name:1080p` — video stream 0 paired with audio
 * stream 0 of the *same* split. Returns the joined map and the per-variant
 * stream indices, which the caller needs to know how many streams to create.
 */
export function buildVarStreamMap(variants: AbrVariant[]): { map: string; streamCount: number } {
  if (variants.length === 0) {
    throw new Error('buildVarStreamMap requires at least one variant');
  }
  const parts = variants.map((v, i) => `v:${i},a:${i},name:${v.name}`);
  return { map: parts.join(' '), streamCount: variants.length };
}

/**
 * Validate a set of ABR variants.
 *
 * Shared by `buildAbrLadderArgs` and `abrLadder` so both entry points reject
 * the same inputs — otherwise a bad variant only fails on whichever path you
 * happened to take.
 */
export function validateAbrVariants(variants: AbrVariant[], context = 'abrLadder'): void {
  if (variants.length === 0) {
    throw new Error(`${context} requires at least one variant`);
  }
  for (const [i, v] of variants.entries()) {
    if (typeof v.name !== 'string' || v.name.trim() === '') {
      throw new Error(`${context}: variant ${i} is missing a non-empty "name"`);
    }
    const parts = String(v.resolution ?? '').split('x');
    const valid =
      parts.length === 2 && parts.every(p => p.trim() !== '' && Number.isFinite(Number(p)) && Number(p) > 0);
    if (!valid) {
      throw new Error(`${context}: invalid resolution for variant "${v.name}": "${v.resolution}"`);
    }
    // HLS segments are MPEG-TS, which only carries even dimensions in yuv420p.
    // ffmpeg accepts the odd size here and then dies deep in the encoder with
    // "maybe incorrect parameters such as bit_rate, rate, width or height".
    for (const [axis, p] of [['width', parts[0]], ['height', parts[1]]] as const) {
      if (Number(p) % 2 !== 0) {
        throw new Error(
          `${context}: ${axis} of variant "${v.name}" is ${p}, which is odd. ` +
            'HLS/MPEG-TS requires even dimensions for yuv420p.',
        );
      }
    }
    if (typeof v.videoBitrate !== 'string' || v.videoBitrate.trim() === '') {
      throw new Error(`${context}: variant "${v.name}" is missing a "videoBitrate"`);
    }
  }
}

/**
 * Build the split/scale filtergraph an ABR ladder needs: one input becomes N
 * scaled video streams and N audio streams.
 */
export function buildAbrLadderFilter(opts: { variants: AbrVariant[] }): string {
  const { variants } = opts;
  validateAbrVariants(variants, 'buildAbrLadderFilter');
  const { streamCount } = buildVarStreamMap(variants);
  const filters: string[] = [
    `[0:v]split=${streamCount}${variants.map((_, i) => `[v${i}]`).join('')}`,
    `[0:a]asplit=${streamCount}${variants.map((_, i) => `[a${i}]`).join('')}`,
  ];
  variants.forEach((v, i) => {
    const [w, h] = v.resolution.split('x');
    filters.push(`[v${i}]scale=${w}:${h}[vout${i}]`);
  });
  return filters.join(';');
}

/** Build the complete argv for a single-pass `var_stream_map` ABR ladder. */
export function buildAbrLadderArgs(opts: AbrLadderOptions): string[] {
  const {
    input,
    outputPattern,
    variants,
    segmentDuration = 6,
    videoCodec = 'libx264',
    audioCodec = 'aac',
    masterPlaylist = 'master.m3u8',
    hlsFlags,
  } = opts;  if (!outputPattern.includes('%v')) {
    throw new Error(
      `buildAbrLadderArgs: outputPattern must contain "%v" so each variant gets its own playlist, got "${outputPattern}"`,
    );
  }
  validateAbrVariants(variants, 'buildAbrLadderArgs');

  const { map } = buildVarStreamMap(variants);

  const args: string[] = [
    '-y', '-i', input,
    '-filter_complex', buildAbrLadderFilter({ variants }),
  ];

  variants.forEach((_v, i) => {
    args.push('-map', `[vout${i}]`, '-map', `[a${i}]`);
  });

  args.push(
    '-c:v', videoCodec,
    '-c:a', audioCodec,
    '-f', 'hls',
    '-var_stream_map', map,
    '-hls_time', String(segmentDuration),
    '-hls_list_size', '0',
    '-master_pl_name', masterPlaylist,
  );
  if (hlsFlags) args.push('-hls_flags', hlsFlags);

  // Per-variant bitrates, applied in the same order as the stream map.
  variants.forEach((v, i) => {
    args.push(`-b:v:${i}`, v.videoBitrate);
    args.push(`-b:a:${i}`, v.audioBitrate ?? '128k');
  });

  args.push(outputPattern);
  return args;
}

/**
 * Build a multi-bitrate HLS ladder in a single ffmpeg pass using
 * `-var_stream_map`.
 *
 * Preferred over `adaptiveHls()` for anything that needs per-language audio
 * variants, because the native mechanism handles the stream grouping ffmpeg
 * needs — the N-output + `master_pl_name` approach in `adaptiveHls` cannot.
 */
export function abrLadder(opts: AbrLadderOptions): FFmpegBuilder {
  const {
    input,
    outputPattern,
    variants,
    segmentDuration = 6,
    videoCodec = 'libx264',
    audioCodec = 'aac',
    masterPlaylist = 'master.m3u8',
    hlsFlags,
    binary,
  } = opts;

  if (!outputPattern.includes('%v')) {
    throw new Error(
      `abrLadder: outputPattern must contain "%v" so each variant gets its own playlist, got "${outputPattern}"`,
    );
  }
  validateAbrVariants(variants, 'abrLadder');

  // -master_pl_name is always resolved against the output directory, and ffmpeg
  // prepends that directory even to an absolute path
  // ("/out//abs/master.m3u8" -> "Failed to open master play list file").
  // Passing just the basename therefore puts the master next to the variant
  // playlists, which is where callers expect it.
  const masterName = basename(masterPlaylist);

  const dirs = new Set(variants.map(v => dirname(outputPattern.replace('%v', v.name))));
  for (const dir of dirs) mkdirSync(dir, { recursive: true });

  const builder = new FFmpegBuilder(input)
    .overwrite()
    .complexFilter(buildAbrLadderFilter(opts))
    .output(outputPattern)
    .outputFormat('hls')
    .videoCodec(videoCodec)
    .audioCodec(audioCodec)
    .addOutputOption('-var_stream_map', buildVarStreamMap(variants).map)
    .addOutputOption('-hls_time', String(segmentDuration))
    .addOutputOption('-hls_list_size', '0')
    .addOutputOption('-master_pl_name', masterName);

  if (hlsFlags) builder.addOutputOption('-hls_flags', hlsFlags);

  variants.forEach((v, i) => {
    builder.map(`[vout${i}]`).map(`[a${i}]`);
    builder.addOutputOption(`-b:v:${i}`, v.videoBitrate);
    builder.addOutputOption(`-b:a:${i}`, v.audioBitrate ?? '128k');
  });

  return builder.setBinary(binary ?? resolveBinary());
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
    .addOutputOption('-use_template', useTemplate ? '1' : '0')
    .addOutputOption('-use_timeline', useTimeline ? '1' : '0');

  // The dash muxer will not create the output directory either.
  mkdirSync(dirname(output), { recursive: true });
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

/**
 * Options accepted by {@link buildHlsArgs}. The `input` and `outputDir` fields
 * are supplied as positional arguments, so they are omitted here.
 */
export type BuildHlsOptions = Omit<HlsOptions, 'input' | 'outputDir'>;

/**
 * Options accepted by {@link buildDashArgs}. The `input` and `output` fields
 * are supplied as positional arguments, so they are omitted here.
 */
export type BuildDashOptions = Omit<DashOptions, 'input' | 'output'>;

export function buildHlsArgs(input: string, outputDir: string, opts: BuildHlsOptions = {}): string[] {
  const segDuration = opts.segmentDuration ?? 6;
  const playlistName = opts.playlistName ?? 'playlist.m3u8';
  const args: string[] = ['-y', '-i', input];
  if (opts.videoCodec) args.push('-c:v', opts.videoCodec);
  if (opts.audioCodec) args.push('-c:a', opts.audioCodec);
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

export function buildDashArgs(input: string, outputPath: string, opts: BuildDashOptions = {}): string[] {
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
