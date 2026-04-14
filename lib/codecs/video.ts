import type { PixelFormat } from '../types/codecs.ts';

/**
 * Typed options for the libx264 encoder.
 * All options derived directly from `ffmpeg -h encoder=libx264` dump.
 */
export interface X264Options {
  /** Encoding preset. Slower = better compression. Default: medium */
  preset?: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast'
    | 'medium' | 'slow' | 'slower' | 'veryslow' | 'placebo';
  /** Visual tune. Optimize for content type or special use case. */
  tune?: 'film' | 'animation' | 'grain' | 'stillimage' | 'fastdecode' | 'zerolatency';
  /** H.264 profile */
  profile?: 'baseline' | 'main' | 'high' | 'high10' | 'high422' | 'high444';
  /** Constant Rate Factor, 0–51. Lower = better quality. Ignored if qp or bitrate set. */
  crf?: number;
  /** Constant QP mode, -1 means disabled. Overrides crf. */
  qp?: number;
  /** Number of B-frames, 0–16 */
  bFrames?: number;
  /** B-frame pyramid mode */
  bPyramid?: 'none' | 'strict' | 'normal';
  /** Adaptive quantization mode: 0=disabled, 1=VAQ, 2=auto-VAQ, 3=LADSAQ */
  aqMode?: 0 | 1 | 2 | 3;
  /** AQ strength, 0–3.0 */
  aqStrength?: number;
  /** Weighted prediction for P-frames: 0=none, 1=blind, 2=smart */
  weightp?: 0 | 1 | 2;
  /** Number of reference frames, 1–16 */
  refs?: number;
  /** Subpel motion estimation quality, 1–11 */
  subq?: number;
  /** Motion estimation method */
  me?: 'dia' | 'hex' | 'umh' | 'esa' | 'tesa';
  /** ME range, 4–1000 */
  meRange?: number;
  /** Trellis quantization: 0=disabled, 1=final MB, 2=all MBs */
  trellis?: 0 | 1 | 2;
  /** Deblocking filter parameters as "alpha:beta", e.g. "0:0" */
  deblock?: string;
  /** NAL HRD model for CBR/VBR signaling */
  nalHrd?: 'none' | 'vbr' | 'cbr';
  /** Target video bitrate in kbps (VBV/ABR mode) */
  bitrate?: number;
  /** Maximum bitrate, kbps */
  maxrate?: number;
  /** Bufsize for VBV, kbps */
  bufsize?: number;
  /** Minimum QP */
  qpMin?: number;
  /** Maximum QP */
  qpMax?: number;
  /** GOP size (keyframe interval) */
  keyintMax?: number;
  /** Min keyframe interval */
  keyintMin?: number;
  /** Scene cut threshold, -1 to disable */
  scenecutThreshold?: number;
  /** Pass raw x264 option string, e.g. "ratetol=1.0:qcomp=0.7" */
  x264Params?: string;
  /** Forced pixel format */
  pixFmt?: PixelFormat;
}

/**
 * Typed options for the libx265 (HEVC) encoder.
 * Derived from `ffmpeg -h encoder=libx265` dump.
 */
export interface X265Options {
  /** Encoding preset */
  preset?: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast'
    | 'medium' | 'slow' | 'slower' | 'veryslow' | 'placebo';
  /** Visual tune */
  tune?: 'psnr' | 'ssim' | 'grain' | 'zerolatency' | 'fastdecode' | 'animation';
  /** H.265 profile */
  profile?: 'main' | 'main10' | 'main12' | 'main422-10' | 'main422-12'
    | 'main444-8' | 'main444-10' | 'main444-12';
  /** Constant Rate Factor, 0–51 */
  crf?: number;
  /** Constant QP, -1 = disabled */
  qp?: number;
  /** Target bitrate in kbps */
  bitrate?: number;
  /** Maximum bitrate in kbps */
  maxrate?: number;
  /** VBV buffer size */
  bufsize?: number;
  /** Keyframe interval */
  keyintMax?: number;
  /** Number of B-frames */
  bFrames?: number;
  /** Number of reference frames */
  refs?: number;
  /** Enable Dolby Vision encoding (v8+ only) */
  dolbyVision?: boolean;
  /** Pass raw x265 option string */
  x265Params?: string;
  /** Forced pixel format */
  pixFmt?: PixelFormat;
}

/**
 * Typed options for the libsvtav1 (SVT-AV1) encoder.
 * Derived from `ffmpeg -h encoder=libsvtav1` dump.
 */
export interface SvtAv1Options {
  /** Preset: -2 (highest quality) to 13 (fastest). Default: 10 */
  preset?: number;
  /** Constant Rate Factor, 1–63. Lower = better quality. */
  crf?: number;
  /** QP value, 1–63 */
  qp?: number;
  /** Target bitrate in kbps */
  bitrate?: number;
  /** Number of B-frames in a mini-GoP, 0–30 */
  bFrames?: number;
  /** Keyframe interval */
  keyintMax?: number;
  /** Enable scene change detection */
  enableSceneDetect?: boolean;
  /** Enable Dolby Vision encoding (v8+ only) */
  dolbyVision?: boolean;
  /** Pass raw SVT-AV1 option string */
  svtav1Params?: string;
  /** Forced pixel format */
  pixFmt?: PixelFormat;
}

/**
 * Typed options for the libvpx-vp9 encoder.
 * Derived from `ffmpeg -h encoder=libvpx-vp9` dump.
 */
export interface Vp9Options {
  /** Constant bitrate target in kbps */
  bitrate?: number;
  /** Minimum bitrate in kbps */
  minrate?: number;
  /** Maximum bitrate in kbps */
  maxrate?: number;
  /** Constant Quality CRF value, 0–63 */
  crf?: number;
  /** Quality/speed tradeoff: 0 (best quality) to 5 (fastest) */
  quality?: 'best' | 'good' | 'realtime';
  /** CPU-used (speed setting), 0–5 (best to fastest) */
  cpuUsed?: number;
  /** Number of tile columns (log2), 0–6 */
  tileColumns?: number;
  /** Number of tile rows (log2), 0–2 */
  tileRows?: number;
  /** Enable row-based multi-threading */
  rowMt?: boolean;
  /** AQ mode: 0=off, 1=variance, 2=complexity, 3=cyclic */
  aqMode?: 0 | 1 | 2 | 3;
  /** Lag in frames for alternate reference frames, 0–25 */
  lagInFrames?: number;
  /** Enable auto alt-ref frames */
  autoAltRef?: boolean;
  /** Number of alternate reference frames, 1–6 */
  arnrMaxFrames?: number;
  /** Two-pass encode pass number: 1 or 2 */
  pass?: 1 | 2;
  /** Two-pass stats file path */
  passlogfile?: string;
  /** Keyframe interval */
  keyintMax?: number;
  /** Forced pixel format */
  pixFmt?: PixelFormat;
}

/**
 * Serialize X264Options to ffmpeg argument array.
 * Emits codec args that follow -c:v libx264.
 */
export function x264ToArgs(opts: X264Options): string[] {
  const args: string[] = ['-c:v', 'libx264'];
  if (opts.preset !== undefined) args.push('-preset', opts.preset);
  if (opts.tune !== undefined) args.push('-tune', opts.tune);
  if (opts.profile !== undefined) args.push('-profile:v', opts.profile);
  if (opts.crf !== undefined) args.push('-crf', String(opts.crf));
  if (opts.qp !== undefined) args.push('-qp', String(opts.qp));
  if (opts.bFrames !== undefined) args.push('-bf', String(opts.bFrames));
  if (opts.bPyramid !== undefined) args.push('-b_strategy', opts.bPyramid === 'none' ? '0' : '1');
  if (opts.aqMode !== undefined) args.push('-aq-mode', String(opts.aqMode));
  if (opts.aqStrength !== undefined) args.push('-aq-strength', String(opts.aqStrength));
  if (opts.weightp !== undefined) args.push('-weightp', String(opts.weightp));
  if (opts.refs !== undefined) args.push('-refs', String(opts.refs));
  if (opts.subq !== undefined) args.push('-subq', String(opts.subq));
  if (opts.me !== undefined) args.push('-me_method', opts.me);
  if (opts.meRange !== undefined) args.push('-me_range', String(opts.meRange));
  if (opts.trellis !== undefined) args.push('-trellis', String(opts.trellis));
  if (opts.deblock !== undefined) args.push('-deblock', opts.deblock);
  if (opts.nalHrd !== undefined) args.push('-nal-hrd', opts.nalHrd);
  if (opts.bitrate !== undefined) args.push('-b:v', `${opts.bitrate}k`);
  if (opts.maxrate !== undefined) args.push('-maxrate', `${opts.maxrate}k`);
  if (opts.bufsize !== undefined) args.push('-bufsize', `${opts.bufsize}k`);
  if (opts.qpMin !== undefined) args.push('-qmin', String(opts.qpMin));
  if (opts.qpMax !== undefined) args.push('-qmax', String(opts.qpMax));
  if (opts.keyintMax !== undefined) args.push('-g', String(opts.keyintMax));
  if (opts.keyintMin !== undefined) args.push('-keyint_min', String(opts.keyintMin));
  if (opts.scenecutThreshold !== undefined) args.push('-sc_threshold', String(opts.scenecutThreshold));
  if (opts.x264Params !== undefined) args.push('-x264-params', opts.x264Params);
  if (opts.pixFmt !== undefined) args.push('-pix_fmt', opts.pixFmt);
  return args;
}

/**
 * Serialize X265Options to ffmpeg argument array.
 */
export function x265ToArgs(opts: X265Options): string[] {
  const args: string[] = ['-c:v', 'libx265'];
  if (opts.preset !== undefined) args.push('-preset', opts.preset);
  if (opts.tune !== undefined) args.push('-tune', opts.tune);
  if (opts.profile !== undefined) args.push('-profile:v', opts.profile);
  if (opts.crf !== undefined) args.push('-crf', String(opts.crf));
  if (opts.qp !== undefined) args.push('-qp', String(opts.qp));
  if (opts.bitrate !== undefined) args.push('-b:v', `${opts.bitrate}k`);
  if (opts.maxrate !== undefined) args.push('-maxrate', `${opts.maxrate}k`);
  if (opts.bufsize !== undefined) args.push('-bufsize', `${opts.bufsize}k`);
  if (opts.keyintMax !== undefined) args.push('-g', String(opts.keyintMax));
  if (opts.bFrames !== undefined) args.push('-bf', String(opts.bFrames));
  if (opts.refs !== undefined) args.push('-refs', String(opts.refs));
  if (opts.dolbyVision === true) args.push('-dolbyvision', '1');
  if (opts.x265Params !== undefined) args.push('-x265-params', opts.x265Params);
  if (opts.pixFmt !== undefined) args.push('-pix_fmt', opts.pixFmt);
  return args;
}

/**
 * Serialize SvtAv1Options to ffmpeg argument array.
 */
export function svtav1ToArgs(opts: SvtAv1Options): string[] {
  const args: string[] = ['-c:v', 'libsvtav1'];
  if (opts.preset !== undefined) args.push('-preset', String(opts.preset));
  if (opts.crf !== undefined) args.push('-crf', String(opts.crf));
  if (opts.qp !== undefined) args.push('-qp', String(opts.qp));
  if (opts.bitrate !== undefined) args.push('-b:v', `${opts.bitrate}k`);
  if (opts.bFrames !== undefined) args.push('-bf', String(opts.bFrames));
  if (opts.keyintMax !== undefined) args.push('-g', String(opts.keyintMax));
  if (opts.enableSceneDetect !== undefined) args.push('-svtav1-params', `scd=${opts.enableSceneDetect ? 1 : 0}`);
  if (opts.dolbyVision === true) args.push('-dolbyvision', '1');
  if (opts.svtav1Params !== undefined) args.push('-svtav1-params', opts.svtav1Params);
  if (opts.pixFmt !== undefined) args.push('-pix_fmt', opts.pixFmt);
  return args;
}

/**
 * Serialize Vp9Options to ffmpeg argument array.
 */
export function vp9ToArgs(opts: Vp9Options): string[] {
  const args: string[] = ['-c:v', 'libvpx-vp9'];
  if (opts.bitrate !== undefined) args.push('-b:v', `${opts.bitrate}k`);
  if (opts.minrate !== undefined) args.push('-minrate', `${opts.minrate}k`);
  if (opts.maxrate !== undefined) args.push('-maxrate', `${opts.maxrate}k`);
  if (opts.crf !== undefined) args.push('-crf', String(opts.crf));
  if (opts.quality !== undefined) args.push('-quality', opts.quality);
  if (opts.cpuUsed !== undefined) args.push('-cpu-used', String(opts.cpuUsed));
  if (opts.tileColumns !== undefined) args.push('-tile-columns', String(opts.tileColumns));
  if (opts.tileRows !== undefined) args.push('-tile-rows', String(opts.tileRows));
  if (opts.rowMt !== undefined) args.push('-row-mt', opts.rowMt ? '1' : '0');
  if (opts.aqMode !== undefined) args.push('-aq-mode', String(opts.aqMode));
  if (opts.lagInFrames !== undefined) args.push('-lag-in-frames', String(opts.lagInFrames));
  if (opts.autoAltRef !== undefined) args.push('-auto-alt-ref', opts.autoAltRef ? '1' : '0');
  if (opts.arnrMaxFrames !== undefined) args.push('-arnr-maxframes', String(opts.arnrMaxFrames));
  if (opts.pass !== undefined) args.push('-pass', String(opts.pass));
  if (opts.passlogfile !== undefined) args.push('-passlogfile', opts.passlogfile);
  if (opts.keyintMax !== undefined) args.push('-g', String(opts.keyintMax));
  if (opts.pixFmt !== undefined) args.push('-pix_fmt', opts.pixFmt);
  return args;
}

// Alias for camelCase import compatibility
export { svtav1ToArgs as svtAv1ToArgs };

// ─── Additional Video Codec Helpers ──────────────────────────────────────────

/**
 * Typed options for the Apple ProRes encoder (prores_ks).
 * Available in both FFmpeg v7 and v8 (including Android Termux).
 */
export interface ProResOptions {
  /**
   * ProRes profile:
   *  0 = Proxy,  1 = LT,  2 = Standard,  3 = HQ,
   *  4 = 4444,   5 = 4444 XQ
   */
  profile?: 0 | 1 | 2 | 3 | 4 | 5;
  /** Bits per raw sample (10 or 12). Default: 10 */
  bits?: 10 | 12;
  /** Vendor tag written into the stream. Default: 'apl0' */
  vendor?: string;
  /** Disable alpha channel in 4444 profile */
  alphaQuality?: number;
  /** Motion estimation mode: 'fixed' | 'adaptive' */
  mbs?: 'fixed' | 'adaptive';
}

export function proResToArgs(opts: ProResOptions = {}, encoder: 'prores' | 'prores_aw' | 'prores_ks' = 'prores_ks'): string[] {
  const args: string[] = ['-c:v', encoder];
  if (opts.profile !== undefined) args.push('-profile:v', String(opts.profile));
  if (opts.bits !== undefined) args.push('-bits_per_raw_sample', String(opts.bits));
  if (opts.vendor !== undefined) args.push('-vendor', opts.vendor);
  if (opts.alphaQuality !== undefined) args.push('-alpha_quality', String(opts.alphaQuality));
  if (opts.mbs !== undefined) args.push('-mbs_per_slice', opts.mbs === 'adaptive' ? '0' : '8');
  return args;
}

/**
 * Typed options for the Avid DNxHD / DNxHR encoder.
 * Used in professional post-production workflows.
 * Available in both FFmpeg v7 and v8.
 */
export interface DnxhdOptions {
  /**
   * DNxHD quality/bitrate profile string, e.g.:
   *   'dnxhd_1080p_36', 'dnxhd_1080i_145', 'dnxhr_hq', 'dnxhr_444'
   * Use `-c:v dnxhd -profile:v dnxhr_hq` for DNxHR (higher res).
   */
  profile?: string;
  /** Target bitrate in kbps (alternative to profile) */
  bitrate?: number;
  /** Pixel format: yuv422p, yuv422p10le, yuv444p10le */
  pixFmt?: 'yuv422p' | 'yuv422p10le' | 'yuv444p10le';
}

export function dnxhdToArgs(opts: DnxhdOptions = {}): string[] {
  const args: string[] = ['-c:v', 'dnxhd'];
  if (opts.profile !== undefined) args.push('-profile:v', opts.profile);
  if (opts.bitrate !== undefined) args.push('-b:v', `${opts.bitrate}k`);
  if (opts.pixFmt !== undefined) args.push('-pix_fmt', opts.pixFmt);
  return args;
}

/**
 * Typed options for the MJPEG (Motion JPEG) encoder.
 * Widely supported — both FFmpeg v7 (via mjpeg_vaapi on Linux) and v8.
 * Common use: frame-accurate editing, surveillance, WebRTC.
 */
export interface MjpegOptions {
  /** Constant quality 1–31 (lower = better). Default: 5 */
  qscale?: number;
  /** Huffman table: default | optimal */
  huffman?: 'default' | 'optimal';
  /** Force pixel format: yuvj420p | yuvj422p | yuvj444p */
  pixFmt?: 'yuvj420p' | 'yuvj422p' | 'yuvj444p';
}

export function mjpegToArgs(opts: MjpegOptions = {}): string[] {
  const args: string[] = ['-c:v', 'mjpeg'];
  if (opts.qscale !== undefined) args.push('-q:v', String(opts.qscale));
  if (opts.huffman !== undefined) args.push('-huffman', opts.huffman);
  if (opts.pixFmt !== undefined) args.push('-pix_fmt', opts.pixFmt);
  return args;
}

/**
 * Typed options for the MPEG-2 Video encoder.
 * Used for broadcast, DVD, Blu-ray, and ATSC/DVB delivery.
 * Available in both FFmpeg v7 and v8.
 */
export interface Mpeg2Options {
  /** Constant bitrate in kbps */
  bitrate?: number;
  /** Maximum bitrate in kbps (VBR cap) */
  maxrate?: number;
  /** VBV buffer size in kbps */
  bufsize?: number;
  /** GOP size (keyframe interval). Default: 12 */
  gopSize?: number;
  /** MPEG-2 profile: 'main' | 'high' | '4:2:2' | 'simple' */
  profile?: 'main' | 'high' | 'simple';
  /** MPEG-2 level: 'main' | 'high' | 'low' | 'high1440' */
  level?: 'main' | 'high' | 'low' | 'high1440';
  /** Interlaced encoding */
  interlaced?: boolean;
}

export function mpeg2ToArgs(opts: Mpeg2Options = {}): string[] {
  const args: string[] = ['-c:v', 'mpeg2video'];
  if (opts.bitrate !== undefined) args.push('-b:v', `${opts.bitrate}k`);
  if (opts.maxrate !== undefined) args.push('-maxrate', `${opts.maxrate}k`);
  if (opts.bufsize !== undefined) args.push('-bufsize', `${opts.bufsize}k`);
  if (opts.gopSize !== undefined) args.push('-g', String(opts.gopSize));
  if (opts.profile !== undefined) args.push('-profile:v', opts.profile);
  if (opts.level !== undefined) args.push('-level', opts.level);
  if (opts.interlaced === true) args.push('-flags', '+ildct+ilme');
  return args;
}

/**
 * Typed options for the MPEG-4 Part 2 encoder (libxvid / mpeg4).
 * Legacy format — widely compatible. Available in both v7 and v8.
 * Use libxvid encoder string for Xvid, mpeg4 for FFmpeg native.
 */
export interface Mpeg4Options {
  /** Target bitrate in kbps */
  bitrate?: number;
  /** Maximum bitrate in kbps */
  maxrate?: number;
  /** Constant quality: 1–31 (lower = better) */
  qscale?: number;
  /** GOP size. Default: 250 */
  gopSize?: number;
  /** Number of B-frames */
  bFrames?: number;
  /** Motion estimation method */
  me?: 'zero' | 'full' | 'log' | 'phods' | 'epzs' | 'x1' | 'hex' | 'umh' | 'iter' | 'dia' | 'mediancut';
}

export function mpeg4ToArgs(opts: Mpeg4Options = {}, encoder: 'mpeg4' | 'libxvid' = 'mpeg4'): string[] {
  const args: string[] = ['-c:v', encoder];
  if (opts.bitrate !== undefined) args.push('-b:v', `${opts.bitrate}k`);
  if (opts.maxrate !== undefined) args.push('-maxrate', `${opts.maxrate}k`);
  if (opts.qscale !== undefined) args.push('-q:v', String(opts.qscale));
  if (opts.gopSize !== undefined) args.push('-g', String(opts.gopSize));
  if (opts.bFrames !== undefined) args.push('-bf', String(opts.bFrames));
  if (opts.me !== undefined) args.push('-me_method', opts.me);
  return args;
}

/**
 * Typed options for the libvpx VP8 encoder.
 * Open-source, royalty-free. Both v7 and v8 include libvpx.
 * Widely supported in WebM containers and WebRTC.
 */
export interface Vp8Options {
  /** Target bitrate in kbps */
  bitrate?: number;
  /** Min bitrate in kbps */
  minrate?: number;
  /** Max bitrate in kbps */
  maxrate?: number;
  /** Constant quality CRF 4–63 */
  crf?: number;
  /** Speed / quality tradeoff: 0 (best) to 5 (fastest) */
  cpuUsed?: number;
  /** Quality mode */
  quality?: 'best' | 'good' | 'realtime';
  /** Keyframe interval */
  keyintMax?: number;
}

export function vp8ToArgs(opts: Vp8Options = {}): string[] {
  const args: string[] = ['-c:v', 'libvpx'];
  if (opts.bitrate !== undefined) args.push('-b:v', `${opts.bitrate}k`);
  if (opts.minrate !== undefined) args.push('-minrate', `${opts.minrate}k`);
  if (opts.maxrate !== undefined) args.push('-maxrate', `${opts.maxrate}k`);
  if (opts.crf !== undefined) args.push('-crf', String(opts.crf));
  if (opts.cpuUsed !== undefined) args.push('-cpu-used', String(opts.cpuUsed));
  if (opts.quality !== undefined) args.push('-quality', opts.quality);
  if (opts.keyintMax !== undefined) args.push('-g', String(opts.keyintMax));
  return args;
}

/**
 * Typed options for the Ogg Theora encoder (libtheora).
 * Open-source, patent-free. Available in both v7 and v8.
 */
export interface TheoraOptions {
  /** Quality 0–10 (higher = better). Default: 7 */
  qscale?: number;
  /** Target bitrate in kbps (overrides quality) */
  bitrate?: number;
}

export function theoraToArgs(opts: TheoraOptions = {}): string[] {
  const args: string[] = ['-c:v', 'libtheora'];
  if (opts.qscale !== undefined) args.push('-q:v', String(opts.qscale));
  else if (opts.bitrate !== undefined) args.push('-b:v', `${opts.bitrate}k`);
  return args;
}

/**
 * Typed options for the FFV1 lossless video encoder.
 * Open standard — excellent for archival. Available in both v7 and v8.
 */
export interface Ffv1Options {
  /** Codec version: 0, 1, or 3. Default: 3 */
  version?: 0 | 1 | 3;
  /** Error correction level: 0 (none) to 3 (maximum). Default: 0 */
  coder?: 0 | 1 | 2;
  /** Context model: 0 or 1 */
  context?: 0 | 1;
  /** Number of slices (for threading). Powers of 2: 4, 8, 16, ... */
  slices?: number;
  /** Enable slice CRC for error detection */
  sliceCrc?: boolean;
}

export function ffv1ToArgs(opts: Ffv1Options = {}): string[] {
  const args: string[] = ['-c:v', 'ffv1'];
  if (opts.version !== undefined) args.push('-level', String(opts.version));
  if (opts.coder !== undefined) args.push('-coder', String(opts.coder));
  if (opts.context !== undefined) args.push('-context', String(opts.context));
  if (opts.slices !== undefined) args.push('-slices', String(opts.slices));
  if (opts.sliceCrc !== undefined) args.push('-slicecrc', opts.sliceCrc ? '1' : '0');
  return args;
}
