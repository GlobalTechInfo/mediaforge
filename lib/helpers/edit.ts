import { FFmpegBuilder } from '../FFmpeg.ts';
import { runFFmpeg } from '../process/spawn.ts';
import { resolveBinary } from '../utils/binary.ts';

// ─── trimVideo ────────────────────────────────────────────────────────────────

export interface TrimOptions {
  input: string;
  output: string;
  /** Start time: seconds or 'HH:MM:SS[.mmm]' */
  start?: number | string;
  /** End time: seconds or 'HH:MM:SS[.mmm]' */
  end?: number | string;
  /** Duration from start (alternative to end) */
  duration?: number | string;
  /**
   * When true (default): stream-copy — instant, no quality loss, may be off by a keyframe.
   * When false: re-encode with libx264/aac — frame-accurate but slower.
   */
  copy?: boolean;
  videoCodec?: string;
  audioCodec?: string;
  binary?: string;
}

/**
 * Trim a video to a time range.
 *
 * @example
 * // Stream copy (instant)
 * await trimVideo({ input: 'in.mp4', output: 'out.mp4', start: 10, end: 40 });
 *
 * @example
 * // Frame-accurate re-encode
 * await trimVideo({ input: 'in.mp4', output: 'out.mp4', start: '00:00:10', duration: 30, copy: false });
 */
export async function trimVideo(opts: TrimOptions): Promise<void> {
  const {
    input, output,
    start, end, duration,
    copy = true,
    videoCodec = 'libx264',
    audioCodec = 'aac',
    binary = resolveBinary(),
  } = opts;

  const builder = new FFmpegBuilder(input).setBinary(binary).overwrite().output(output);

  if (start !== undefined) builder.seekInput(start);
  if (end !== undefined && duration === undefined) {
    // Calculate duration from start+end
    const s = typeof start === 'number' ? start : 0;
    const e = typeof end === 'number' ? end : parseFloat(String(end));
    builder.duration(e - s);
  }
  if (duration !== undefined) builder.duration(duration);

  if (copy) {
    builder.videoCodec('copy').audioCodec('copy');
  } else {
    builder.videoCodec(videoCodec).audioCodec(audioCodec);
  }

  await builder.run();
}

// ─── changeSpeed ──────────────────────────────────────────────────────────────

export interface ChangeSpeedOptions {
  input: string;
  output: string;
  /**
   * Speed multiplier. 2.0 = double speed, 0.5 = half speed.
   * Video: 0.25–4.0 (setpts). Audio: 0.5–2.0 per atempo pass (chained for extremes).
   */
  speed: number;
  videoCodec?: string;
  audioCodec?: string;
  /** Extra output options e.g. ['-preset', 'ultrafast'] */
  outputArgs?: string[];
  binary?: string;
}

/**
 * Change playback speed of a video, keeping audio pitch-corrected.
 * Chains multiple atempo filters for speed values outside 0.5–2.0.
 *
 * @example
 * await changeSpeed({ input: 'in.mp4', output: 'out.mp4', speed: 2.0 });
 * await changeSpeed({ input: 'in.mp4', output: 'out.mp4', speed: 0.25 }); // 4x slow-mo
 */
export async function changeSpeed(opts: ChangeSpeedOptions): Promise<void> {
  const {
    input, output,
    speed,
    videoCodec = 'libx264',
    audioCodec = 'aac',
    outputArgs = [],
    binary = resolveBinary(),
  } = opts;

  if (speed <= 0) throw new Error('speed must be > 0');

  const vFilter = `setpts=${(1 / speed).toFixed(6)}*PTS`;
  const atempoFilters = buildAtempoChain(speed);

  const builder = new FFmpegBuilder(input).setBinary(binary)
    .overwrite()
    .output(output)
    .videoFilter(vFilter)
    .audioFilter(atempoFilters)
    .videoCodec(videoCodec)
    .audioCodec(audioCodec);
  if (outputArgs.length > 0) builder.addOutputOption(...outputArgs);
  await builder.run();
}

/** Build a chain of atempo filters for any speed value */
export function buildAtempoChain(speed: number): string {
  const filters: string[] = [];
  let remaining = speed;
  if (remaining > 1) {
    while (remaining > 2.0) { filters.push('atempo=2.0'); remaining /= 2.0; }
    filters.push(`atempo=${remaining.toFixed(6)}`);
  } else {
    while (remaining < 0.5) { filters.push('atempo=0.5'); remaining /= 0.5; }
    filters.push(`atempo=${remaining.toFixed(6)}`);
  }
  return filters.join(',');
}

// ─── extractAudio ─────────────────────────────────────────────────────────────

export interface ExtractAudioOptions {
  input: string;
  output: string;
  /** Stream index. Default: 0 (first audio track) */
  streamIndex?: number;
  /** Audio codec. Defaults: mp3 → libmp3lame, m4a → aac, flac → flac, wav → pcm_s16le, else copy */
  codec?: string;
  bitrate?: string | number;
  sampleRate?: number;
  channels?: number;
  binary?: string;
}

/**
 * Extract the audio track from a video or audio file.
 *
 * @example
 * await extractAudio({ input: 'video.mp4', output: 'audio.mp3' });
 * await extractAudio({ input: 'video.mp4', output: 'audio.flac', codec: 'flac' });
 */
export async function extractAudio(opts: ExtractAudioOptions): Promise<void> {
  const {
    input, output,
    streamIndex = 0,
    bitrate,
    sampleRate,
    channels,
    binary = resolveBinary(),
  } = opts;

  // Auto-detect codec from output extension if not specified
  const codec = opts.codec ?? inferAudioCodec(output);

  const builder = new FFmpegBuilder(input).setBinary(binary)
    .overwrite()
    .output(output)
    .noVideo()
    .map(`0:a:${streamIndex}`)
    .audioCodec(codec);

  if (bitrate !== undefined) builder.audioBitrate(bitrate);
  if (sampleRate !== undefined) builder.audioSampleRate(sampleRate);
  if (channels !== undefined) builder.audioChannels(channels);

  await builder.run();
}

function inferAudioCodec(outputPath: string): string {
  const ext = outputPath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'mp3': return 'libmp3lame';
    case 'aac': case 'm4a': return 'aac';
    case 'flac': return 'flac';
    case 'ogg': return 'libvorbis';
    case 'opus': return 'libopus';
    case 'wav': return 'pcm_s16le';
    case 'wma': return 'wmav2';
    default: return 'copy';
  }
}

// ─── replaceAudio ─────────────────────────────────────────────────────────────

export interface ReplaceAudioOptions {
  /** Video input file (video track taken from here) */
  video: string;
  /** Audio input file (audio track taken from here) */
  audio: string;
  output: string;
  /** Codec for the output video stream. Default: 'copy' */
  videoCodec?: string;
  /** Codec for the output audio stream. Default: 'copy' */
  audioCodec?: string;
  /** Trim output to the shorter of the two inputs */
  shortest?: boolean;
  binary?: string;
}

/**
 * Replace (or add) the audio track of a video with audio from another file.
 *
 * @example
 * await replaceAudio({ video: 'video.mp4', audio: 'music.mp3', output: 'out.mp4' });
 */
export async function replaceAudio(opts: ReplaceAudioOptions): Promise<void> {
  const {
    video, audio, output,
    videoCodec = 'copy',
    audioCodec = 'copy',
    shortest = true,
    binary = resolveBinary(),
  } = opts;

  const builder = new FFmpegBuilder([video, audio]).setBinary(binary)
    .overwrite()
    .output(output)
    .map('0:v:0')
    .map('1:a:0')
    .videoCodec(videoCodec)
    .audioCodec(audioCodec);

  if (shortest) builder.addOutputOption('-shortest');

  await builder.run();
}

// ─── mixAudio ─────────────────────────────────────────────────────────────────

export interface MixAudioOptions {
  /** Input files — all audio tracks will be mixed together */
  inputs: string[];
  output: string;
  /** Per-input volume weights, 0.0–1.0+. Default: 1.0 for each */
  weights?: number[];
  /** Duration mode: 'longest' | 'shortest' | 'first'. Default: 'longest' */
  duration?: 'longest' | 'shortest' | 'first';
  audioCodec?: string;
  bitrate?: string | number;
  binary?: string;
}

/**
 * Mix multiple audio tracks together into a single output.
 *
 * @example
 * await mixAudio({ inputs: ['voice.mp3', 'music.mp3'], output: 'mixed.mp3', weights: [1.0, 0.3] });
 */
export async function mixAudio(opts: MixAudioOptions): Promise<void> {
  const {
    inputs, output,
    weights,
    duration = 'longest',
    audioCodec = 'libmp3lame',
    bitrate,
    binary = resolveBinary(),
  } = opts;

  if (inputs.length < 2) throw new Error('mixAudio requires at least 2 inputs');

  const inputsArg = inputs.map((_, i) => `[${i}:a]`).join('');
  let amixFilter = `${inputsArg}amix=inputs=${inputs.length}:duration=${duration}`;
  if (weights !== undefined) amixFilter += `:weights=${weights.join(' ')}`;
  amixFilter += '[aout]';

  const builder = new FFmpegBuilder(inputs[0]!).setBinary(binary).overwrite();
  for (let i = 1; i < inputs.length; i++) builder.input(inputs[i]!);

  builder
    .complexFilter(amixFilter)
    .output(output)
    .map('[aout]')
    .noVideo()
    .audioCodec(audioCodec);

  if (bitrate !== undefined) builder.audioBitrate(bitrate);

  await builder.run();
}

// ─── loopVideo ────────────────────────────────────────────────────────────────

export interface LoopVideoOptions {
  input: string;
  output: string;
  /** Number of times to loop (1 = play twice total, -1 = infinite). Default: 1 */
  loops?: number;
  /** Total output duration limit in seconds (useful with loops: -1) */
  duration?: number | string;
  videoCodec?: string;
  audioCodec?: string;
  binary?: string;
}

/**
 * Loop a video file N times.
 *
 * @example
 * await loopVideo({ input: 'clip.mp4', output: 'looped.mp4', loops: 3 });
 * await loopVideo({ input: 'bg.mp4', output: '1hour.mp4', loops: -1, duration: 3600 });
 */
export async function loopVideo(opts: LoopVideoOptions): Promise<void> {
  const {
    input, output,
    loops = 1,
    duration,
    videoCodec = 'copy',
    audioCodec = 'copy',
    binary = resolveBinary(),
  } = opts;

  const builder = new FFmpegBuilder().setBinary(binary)
    .overwrite()
    .input(input, { extraArgs: ['-stream_loop', String(loops)] })
    .output(output)
    .videoCodec(videoCodec)
    .audioCodec(audioCodec);

  if (duration !== undefined) builder.duration(duration);

  await builder.run();
}

// ─── deinterlace ──────────────────────────────────────────────────────────────

export interface DeinterlaceOptions {
  input: string;
  output: string;
  /** yadif mode: 0=frame, 1=field, 2=frame (send-frame), 3=field (send-frame). Default: 0 */
  mode?: 0 | 1 | 2 | 3;
  /** Parity: -1=auto, 0=TFF, 1=BFF. Default: -1 */
  parity?: -1 | 0 | 1;
  /** Deint: 0=all frames, 1=interlaced only. Default: 0 */
  deint?: 0 | 1;
  videoCodec?: string;
  audioCodec?: string;
  /** Extra output options e.g. ['-preset', 'ultrafast'] */
  outputArgs?: string[];
  binary?: string;
}

/**
 * Deinterlace a video using the yadif filter.
 *
 * @example
 * await deinterlace({ input: 'interlaced.ts', output: 'progressive.mp4' });
 */
export async function deinterlace(opts: DeinterlaceOptions): Promise<void> {
  const {
    input, output,
    mode = 0, parity = -1, deint = 0,
    videoCodec = 'libx264',
    audioCodec = 'copy',
    outputArgs = [],
    binary = resolveBinary(),
  } = opts;

  const builder = new FFmpegBuilder(input).setBinary(binary)
    .overwrite()
    .output(output)
    .videoFilter(`yadif=${mode}:${parity}:${deint}`)
    .videoCodec(videoCodec)
    .audioCodec(audioCodec);
  if (outputArgs.length > 0) builder.addOutputOption(...outputArgs);
  await builder.run();
}

// ─── cropToRatio ──────────────────────────────────────────────────────────────

export interface CropToRatioOptions {
  input: string;
  output: string;
  /** Target aspect ratio as 'W:H' string (e.g. '16:9', '1:1', '9:16') */
  ratio: string;
  videoCodec?: string;
  audioCodec?: string;
  /** Extra output options e.g. ['-preset', 'ultrafast'] */
  outputArgs?: string[];
  binary?: string;
}

/**
 * Center-crop a video to a target aspect ratio.
 * Uses FFmpeg expressions so no probe step is needed.
 *
 * @example
 * await cropToRatio({ input: 'wide.mp4', output: 'square.mp4', ratio: '1:1' });
 * await cropToRatio({ input: 'landscape.mp4', output: 'portrait.mp4', ratio: '9:16' });
 */
export async function cropToRatio(opts: CropToRatioOptions): Promise<void> {
  const { input, output, ratio, videoCodec = 'libx264', audioCodec = 'copy', outputArgs = [], binary = resolveBinary() } = opts;
  const [rw, rh] = ratio.split(':').map(Number);
  if (!rw || !rh) throw new Error(`Invalid ratio: ${ratio}`);

  // Crop to target ratio while maximising the kept area:
  // new_w = min(iw, ih * rw/rh), new_h = min(ih, iw * rh/rw), centered
  const cropFilter =
    `crop=w='min(iw\\,ih*${rw}/${rh})':h='min(ih\\,iw*${rh}/${rw})':x='(iw-out_w)/2':y='(ih-out_h)/2'`;

  const builder = new FFmpegBuilder(input).setBinary(binary)
    .overwrite()
    .output(output)
    .videoFilter(cropFilter)
    .videoCodec(videoCodec)
    .audioCodec(audioCodec);
  if (outputArgs.length > 0) builder.addOutputOption(...outputArgs);
  await builder.run();
}

// ─── stackVideos ──────────────────────────────────────────────────────────────

export interface StackVideosOptions {
  inputs: string[];
  output: string;
  /** 'hstack' = side by side, 'vstack' = top/bottom, 'xstack' = grid layout */
  direction?: 'hstack' | 'vstack' | 'xstack';
  /** For xstack: grid columns (e.g. 2 for 2×2). Default: ceil(sqrt(n)) */
  columns?: number;
  videoCodec?: string;
  audioCodec?: string;
  /** Extra output options e.g. ['-preset', 'ultrafast'] */
  outputArgs?: string[];
  binary?: string;
}

/**
 * Stack multiple videos side-by-side, top-to-bottom, or in a grid.
 *
 * @example
 * await stackVideos({ inputs: ['a.mp4', 'b.mp4'], output: 'side.mp4', direction: 'hstack' });
 * await stackVideos({ inputs: ['a.mp4','b.mp4','c.mp4','d.mp4'], output: 'grid.mp4', direction: 'xstack', columns: 2 });
 */
export async function stackVideos(opts: StackVideosOptions): Promise<void> {
  const {
    inputs, output,
    direction = 'hstack',
    videoCodec = 'libx264',
    audioCodec = 'copy',
    outputArgs = [],
    binary = resolveBinary(),
  } = opts;

  if (inputs.length < 2) throw new Error('stackVideos requires at least 2 inputs');

  const labeled = inputs.map((_, i) => `[${i}:v]`).join('');

  let filter: string;
  if (direction === 'xstack') {
    const cols = opts.columns ?? Math.ceil(Math.sqrt(inputs.length));
    // Build layout string: '0_0|w0_0|0_h0|w0_h0|...'
    const layout: string[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      // x: sum of widths of preceding columns (use input index from row 0 — all inputs are same size)
      const x = col === 0 ? '0' : Array.from({ length: col }, (_, c) => `w${c}`).join('+');
      // y: sum of heights of preceding rows (use first input of each row)
      const y = row === 0 ? '0' : Array.from({ length: row }, (_, r) => `h${r * cols}`).join('+');
      layout.push(`${x}_${y}`);
    }
    filter = `${labeled}xstack=inputs=${inputs.length}:layout=${layout.join('|')}[v]`;
  } else {
    filter = `${labeled}${direction}=inputs=${inputs.length}[v]`;
  }

  const builder = new FFmpegBuilder(inputs[0]!).setBinary(binary).overwrite();
  for (let i = 1; i < inputs.length; i++) builder.input(inputs[i]!);

  builder
    .complexFilter(filter)
    .output(output)
    .map('[v]')
    .map('0:a?')
    .videoCodec(videoCodec)
    .audioCodec(audioCodec);

  if (outputArgs.length > 0) builder.addOutputOption(...outputArgs);
  await builder.run();
}

// ─── generateSprite ──────────────────────────────────────────────────────────

export interface SpriteOptions {
  input: string;
  /** Output image path (.jpg or .png) */
  output: string;
  /** Number of thumbnail columns in the sprite grid. Default: 5 */
  columns?: number;
  /** Total number of thumbnails. Default: 25 */
  count?: number;
  /** Width of each thumbnail in pixels. Default: 160 */
  thumbWidth?: number;
  binary?: string;
}

/**
 * Generate a sprite sheet of video thumbnails (for seek preview in players).
 * Returns the tile dimensions for use in a VTT file.
 *
 * @example
 * const info = await generateSprite({ input: 'video.mp4', output: 'sprites.jpg' });
 * // info.columns, info.rows, info.thumbWidth, info.thumbHeight
 */
export async function generateSprite(opts: SpriteOptions): Promise<{
  columns: number; rows: number; thumbWidth: number; thumbHeight: number;
}> {
  const {
    input, output,
    columns = 5,
    count = 25,
    thumbWidth = 160,
    binary = resolveBinary(),
  } = opts;

  const rows = Math.ceil(count / columns);
  const _fps = `1/${Math.max(1, Math.floor(1))}`;

  // Scale each frame to thumbWidth, maintain aspect ratio, then tile
  const filter =
    `fps=1,scale=${thumbWidth}:-1,` +
    `tile=${columns}x${rows}`;

  await runFFmpeg({
    binary,
    args: [
      '-y', '-i', input,
      '-vf', filter,
      '-frames:v', '1',
      '-qscale:v', '3',
      output,
    ],
  });

  // We don't know the actual height without probing — return -1 for height
  return { columns, rows, thumbWidth, thumbHeight: -1 };
}

// ─── applyLUT ─────────────────────────────────────────────────────────────────

export interface ApplyLutOptions {
  input: string;
  output: string;
  /** Path to .cube or .3dl LUT file */
  lut: string;
  /** Interpolation: 'trilinear' | 'tetrahedral'. Default: 'trilinear' */
  interp?: 'trilinear' | 'tetrahedral' | 'nearest';
  videoCodec?: string;
  audioCodec?: string;
  /** Extra output options e.g. ['-preset', 'ultrafast'] */
  outputArgs?: string[];
  binary?: string;
}

/**
 * Apply a 3D LUT colour grade to a video.
 *
 * @example
 * await applyLUT({ input: 'raw.mp4', output: 'graded.mp4', lut: 'film.cube' });
 */
export async function applyLUT(opts: ApplyLutOptions): Promise<void> {
  const {
    input, output, lut,
    interp = 'trilinear',
    videoCodec = 'libx264',
    audioCodec = 'copy',
    outputArgs = [],
    binary = resolveBinary(),
  } = opts;

  const escapedLut = lut.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const filter = `lut3d='${escapedLut}':interp=${interp}`;

  const builder = new FFmpegBuilder(input).setBinary(binary)
    .overwrite()
    .output(output)
    .videoFilter(filter)
    .videoCodec(videoCodec)
    .audioCodec(audioCodec);
  if (outputArgs.length > 0) builder.addOutputOption(...outputArgs);
  await builder.run();
}

// ─── stabilizeVideo ───────────────────────────────────────────────────────────

export interface StabilizeOptions {
  input: string;
  output: string;
  /** Smoothing strength 1–100. Default: 10 */
  smoothing?: number;
  /** Max correction in pixels. Default: -1 (no limit) */
  maxShift?: number;
  /** Max rotation in degrees. Default: -1 (no limit) */
  maxAngle?: number;
  /** Crop black borders: 0=keep, 1=crop (default: 0) */
  crop?: 0 | 1;
  videoCodec?: string;
  audioCodec?: string;
  binary?: string;
}

/**
 * Stabilize a shaky video using a two-pass vidstab process.
 * Pass 1: analyse motion → write to a temporary .trf file.
 * Pass 2: apply stabilization transforms.
 *
 * @example
 * await stabilizeVideo({ input: 'shaky.mp4', output: 'stable.mp4', smoothing: 15 });
 */
export async function stabilizeVideo(opts: StabilizeOptions): Promise<void> {
  const {
    input, output,
    smoothing = 10,
    maxShift = -1,
    maxAngle = -1,
    crop = 0,
    videoCodec = 'libx264',
    audioCodec = 'copy',
    binary = resolveBinary(),
  } = opts;

  const trfPath = `${output}.vidstab.trf`;

  // Pass 1: detect motion
  const detectFilter = `vidstabdetect=stepsize=6:shakiness=8:accuracy=9:result='${trfPath}'`;
  await runFFmpeg({
    binary,
    args: ['-y', '-i', input, '-vf', detectFilter, '-f', 'null', '-'],
  });

  // Pass 2: apply transforms
  const transformParts = [`vidstabtransform=input='${trfPath}':smoothing=${smoothing}`];
  if (maxShift >= 0) transformParts.push(`maxshift=${maxShift}`);
  if (maxAngle >= 0) transformParts.push(`maxangle=${maxAngle}`);
  transformParts.push(`crop=${crop === 1 ? 'black' : 'keep'}`);
  const transformFilter = transformParts.join(':');

  await new FFmpegBuilder(input).setBinary(binary)
    .overwrite()
    .output(output)
    .videoFilter(transformFilter)
    .videoCodec(videoCodec)
    .audioCodec(audioCodec)
    .run();

  // Clean up temp file
  try { const { unlinkSync } = await import('node:fs'); unlinkSync(trfPath); } catch { /* best effort */ }
}

// ─── streamToUrl ──────────────────────────────────────────────────────────────

export interface StreamToUrlOptions {
  input: string;
  /** Destination URL: rtmp://, srt://, udp://, etc. */
  url: string;
  /** Output format. Default: inferred from URL (flv for rtmp, mpegts for udp/srt) */
  format?: string;
  videoCodec?: string;
  videoBitrate?: string | number;
  audioCodec?: string;
  audioBitrate?: string | number;
  /** Extra output options */
  outputOptions?: string[];
  binary?: string;
}

/**
 * Stream a file to an RTMP, SRT, UDP, or other live destination.
 *
 * @example
 * await streamToUrl({ input: 'video.mp4', url: 'rtmp://live.twitch.tv/app/STREAM_KEY' });
 * await streamToUrl({ input: 'video.mp4', url: 'srt://server:1234', videoCodec: 'libx264' });
 */
export async function streamToUrl(opts: StreamToUrlOptions): Promise<void> {
  const {
    input, url,
    videoCodec = 'copy',
    audioCodec = 'copy',
    binary = resolveBinary(),
  } = opts;

  const format = opts.format ?? inferStreamFormat(url);

  const builder = new FFmpegBuilder(input).setBinary(binary)
    .addGlobalOption('-re')  // read at native frame rate
    .output(url)
    .outputFormat(format)
    .videoCodec(videoCodec)
    .audioCodec(audioCodec);

  if (opts.videoBitrate !== undefined) builder.videoBitrate(opts.videoBitrate);
  if (opts.audioBitrate !== undefined) builder.audioBitrate(opts.audioBitrate);
  if (opts.outputOptions) builder.addOutputOption(...opts.outputOptions);

  await builder.run();
}

function inferStreamFormat(url: string): string {
  if (url.startsWith('rtmp://') || url.startsWith('rtmps://')) return 'flv';
  if (url.startsWith('srt://') || url.startsWith('udp://') || url.startsWith('rtp://')) return 'mpegts';
  return 'flv';
}
