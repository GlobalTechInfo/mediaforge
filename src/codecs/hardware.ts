/**
 * Hardware acceleration codec option interfaces.
 * Covers everything in the v7 (NVENC/VAAPI) and v8 (MediaCodec/Vulkan) dumps.
 * Runtime availability is always probed — never hardcoded by platform.
 */

// ─── NVENC (NVIDIA GPU, v6+ when compiled with CUDA) ─────────────────────────

/** Codecs available via NVENC */
export type NvencVideoCodec = 'h264_nvenc' | 'hevc_nvenc' | 'av1_nvenc';

/**
 * Typed options for NVENC encoders (h264_nvenc, hevc_nvenc, av1_nvenc).
 * Derived from `ffmpeg -h encoder=h264_nvenc` dump.
 */
export interface NvencOptions {
  /** Encoding preset — performance vs quality tradeoff */
  preset?: 'default' | 'slow' | 'medium' | 'fast' | 'hp' | 'hq' | 'bd'
    | 'p1' | 'p2' | 'p3' | 'p4' | 'p5' | 'p6' | 'p7';
  /** Tuning info for content type */
  tune?: 'hq' | 'll' | 'ull' | 'lossless';
  /** Rate control mode */
  rcMode?: 'constqp' | 'vbr' | 'cbr' | 'cbr_ld_hq' | 'cbr_hq' | 'vbr_hq';
  /** Constant QP for constqp mode */
  constqp?: number;
  /** Target bitrate in kbps */
  bitrate?: number;
  /** Max bitrate in kbps */
  maxrate?: number;
  /** Bufsize in kbps */
  bufsize?: number;
  /** CQ value for vbr/cbr modes (quality target), 0–51 */
  cq?: number;
  /** QP for I/P/B frames */
  qpI?: number;
  qpP?: number;
  qpB?: number;
  /** Number of B-frames */
  bFrames?: number;
  /** Reference frames */
  refs?: number;
  /** GOP size */
  gopSize?: number;
  /** AQ (temporal/spatial) strength 1–15 */
  aqStrength?: number;
  /** Enable temporal AQ */
  temporalAq?: boolean;
  /** Enable weighted prediction */
  weightedPred?: boolean;
  /** H.264 level */
  level?: string;
  /** H.264 profile (h264_nvenc only) */
  profile?: 'baseline' | 'main' | 'high' | 'high444p';
  /** Lookahead frames */
  rcLookahead?: number;
  /** Force CUDA device index */
  gpuDevice?: number;
}

/** Build ffmpeg arg list for NVENC */
export function nvencToArgs(opts: NvencOptions, codec = 'h264_nvenc'): string[] {
  const args: string[] = ['-c:v', codec];
  if (opts.preset !== undefined) args.push('-preset', opts.preset);
  if (opts.tune !== undefined) args.push('-tune', opts.tune);
  if (opts.rcMode !== undefined) args.push('-rc', opts.rcMode);
  if (opts.constqp !== undefined) args.push('-constqp', String(opts.constqp));
  if (opts.bitrate !== undefined) args.push('-b:v', `${opts.bitrate}k`);
  if (opts.maxrate !== undefined) args.push('-maxrate', `${opts.maxrate}k`);
  if (opts.bufsize !== undefined) args.push('-bufsize', `${opts.bufsize}k`);
  if (opts.cq !== undefined) args.push('-cq', String(opts.cq));
  if (opts.qpI !== undefined) args.push('-qp:v', String(opts.qpI));
  if (opts.bFrames !== undefined) args.push('-bf', String(opts.bFrames));
  if (opts.refs !== undefined) args.push('-refs', String(opts.refs));
  if (opts.gopSize !== undefined) args.push('-g', String(opts.gopSize));
  if (opts.aqStrength !== undefined) args.push('-aq-strength', String(opts.aqStrength));
  if (opts.temporalAq !== undefined) args.push('-temporal-aq', opts.temporalAq ? '1' : '0');
  if (opts.weightedPred !== undefined) args.push('-weighted_pred', opts.weightedPred ? '1' : '0');
  if (opts.level !== undefined) args.push('-level', opts.level);
  if (opts.profile !== undefined) args.push('-profile:v', opts.profile);
  if (opts.rcLookahead !== undefined) args.push('-rc-lookahead', String(opts.rcLookahead));
  if (opts.gpuDevice !== undefined) args.push('-gpu', String(opts.gpuDevice));
  return args;
}

// ─── VAAPI (Linux GPU — VA-API, v6+ when compiled with VAAPI) ────────────────

/** Codecs available via VAAPI */
export type VaapiVideoCodec = 'h264_vaapi' | 'hevc_vaapi' | 'av1_vaapi'
  | 'vp8_vaapi' | 'vp9_vaapi' | 'mjpeg_vaapi' | 'mpeg2_vaapi';

/** VAAPI device options */
export interface VaapiDeviceOptions {
  /** DRM render node path, e.g. '/dev/dri/renderD128' */
  device?: string;
}

/**
 * Typed options for VAAPI encoders.
 * Derived from `ffmpeg -h encoder=h264_vaapi` dump.
 */
export interface VaapiOptions {
  /** CRF/QP value, 0–52 */
  qp?: number;
  /** Target bitrate in kbps */
  bitrate?: number;
  /** Max bitrate in kbps */
  maxrate?: number;
  /** Keyframe interval */
  keyintMax?: number;
  /** B-frames */
  bFrames?: number;
  /** Reference frames */
  refs?: number;
  /** H.264 profile (h264_vaapi only) */
  profile?: string;
  /** H.264/HEVC level */
  level?: number;
  /** Rate control mode */
  rcMode?: 'CQP' | 'CBR' | 'VBR' | 'ICQ' | 'QVBR' | 'AVBR';
}

/** Build ffmpeg arg list for VAAPI */
export function vaapiToArgs(opts: VaapiOptions, codec = 'h264_vaapi'): string[] {
  const args: string[] = ['-c:v', codec];
  if (opts.qp !== undefined) args.push('-qp', String(opts.qp));
  if (opts.bitrate !== undefined) args.push('-b:v', `${opts.bitrate}k`);
  if (opts.maxrate !== undefined) args.push('-maxrate', `${opts.maxrate}k`);
  if (opts.keyintMax !== undefined) args.push('-g', String(opts.keyintMax));
  if (opts.bFrames !== undefined) args.push('-bf', String(opts.bFrames));
  if (opts.refs !== undefined) args.push('-refs', String(opts.refs));
  if (opts.profile !== undefined) args.push('-profile:v', opts.profile);
  if (opts.level !== undefined) args.push('-level', String(opts.level));
  if (opts.rcMode !== undefined) args.push('-rc_mode', opts.rcMode);
  return args;
}

// ─── MediaCodec (Android/v8+ when compiled with MediaCodec) ─────────────────

/** Video codecs available via Android MediaCodec */
export type MediaCodecVideoCodec =
  | 'h264_mediacodec' | 'hevc_mediacodec' | 'av1_mediacodec'
  | 'mpeg4_mediacodec' | 'vp8_mediacodec' | 'vp9_mediacodec';

/** Audio codecs available via Android MediaCodec */
export type MediaCodecAudioCodec =
  | 'aac_mediacodec' | 'amrnb_mediacodec' | 'amrwb_mediacodec' | 'mp3_mediacodec';

/** All MediaCodec codecs */
export type MediaCodecCodec = MediaCodecVideoCodec | MediaCodecAudioCodec;

/**
 * Typed options for MediaCodec encoders (v8+).
 * Derived from `ffmpeg -h encoder=h264_mediacodec` dump.
 */
export interface MediaCodecOptions {
  /** Use NDK MediaCodec API instead of Java API */
  ndkCodec?: boolean;
  /** Bitrate in kbps */
  bitrate?: number;
  /** I-frame interval in seconds */
  iFrameInterval?: number;
  /** Level */
  level?: number;
}

/** Build ffmpeg arg list for MediaCodec */
export function mediacodecToArgs(opts: MediaCodecOptions, codec = 'h264_mediacodec'): string[] {
  const args: string[] = ['-c:v', codec];
  if (opts.ndkCodec === true) args.push('-ndk_codec', '1');
  if (opts.bitrate !== undefined) args.push('-b:v', `${opts.bitrate}k`);
  if (opts.iFrameInterval !== undefined) args.push('-i_qfactor', String(opts.iFrameInterval));
  if (opts.level !== undefined) args.push('-level', String(opts.level));
  return args;
}

// ─── Vulkan (v8+ cross-platform GPU) ─────────────────────────────────────────

/** Video codecs available via Vulkan compute */
export type VulkanVideoCodec = 'h264_vulkan' | 'hevc_vulkan' | 'av1_vulkan' | 'ffv1_vulkan';

/**
 * Typed options for Vulkan encoders (v8+).
 */
export interface VulkanOptions {
  /** Target bitrate in kbps */
  bitrate?: number;
  /** CRF/QP value */
  qp?: number;
  /** Keyframe interval */
  gopSize?: number;
  /** Number of B-frames */
  bFrames?: number;
}

/** Build ffmpeg arg list for Vulkan */
export function vulkanToArgs(opts: VulkanOptions, codec = 'h264_vulkan'): string[] {
  const args: string[] = ['-c:v', codec];
  if (opts.bitrate !== undefined) args.push('-b:v', `${opts.bitrate}k`);
  if (opts.qp !== undefined) args.push('-qp', String(opts.qp));
  if (opts.gopSize !== undefined) args.push('-g', String(opts.gopSize));
  if (opts.bFrames !== undefined) args.push('-bf', String(opts.bFrames));
  return args;
}

// ─── QSV (Intel Quick Sync, when compiled with MFX/oneVPL) ──────────────────

/** Video codecs via Intel QSV */
export type QsvVideoCodec = 'h264_qsv' | 'hevc_qsv' | 'av1_qsv' | 'vp9_qsv' | 'mpeg2_qsv';

/**
 * Typed options for QSV encoders.
 */
export interface QsvOptions {
  /** Preset: veryfast, faster, fast, medium, slow, slower, veryslow */
  preset?: 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow';
  /** CRF value */
  globalQuality?: number;
  /** Target bitrate in kbps */
  bitrate?: number;
  /** Max bitrate in kbps */
  maxrate?: number;
  /** GOP size */
  gopSize?: number;
  /** B-frames */
  bFrames?: number;
  /** Low latency mode */
  lowLatency?: boolean;
}

/** Build ffmpeg arg list for QSV */
export function qsvToArgs(opts: QsvOptions, codec = 'h264_qsv'): string[] {
  const args: string[] = ['-c:v', codec];
  if (opts.preset !== undefined) args.push('-preset', opts.preset);
  if (opts.globalQuality !== undefined) args.push('-global_quality', String(opts.globalQuality));
  if (opts.bitrate !== undefined) args.push('-b:v', `${opts.bitrate}k`);
  if (opts.maxrate !== undefined) args.push('-maxrate', `${opts.maxrate}k`);
  if (opts.gopSize !== undefined) args.push('-g', String(opts.gopSize));
  if (opts.bFrames !== undefined) args.push('-bf', String(opts.bFrames));
  if (opts.lowLatency === true) args.push('-low_delay_brc', '1');
  return args;
}
