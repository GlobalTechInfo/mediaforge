import type { PixelFormat } from '../types/codecs.js';

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
