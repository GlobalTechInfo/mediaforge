import type { SampleFormat, ChannelLayout } from '../types/codecs.ts';

/**
 * Typed options for the native AAC encoder.
 * Derived from `ffmpeg -h encoder=aac` dump.
 */
export interface AacOptions {
  /** Coding mode: VBR or CBR */
  aacCoder?: 'anmr' | 'twoloop' | 'fast';
  /** VBR quality, 1 (lowest) to 5 (highest). Enables VBR mode. */
  vbr?: 1 | 2 | 3 | 4 | 5;
  /** Target bitrate in kbps (CBR mode) */
  bitrate?: number;
  /** Sample rate */
  sampleRate?: number;
  /** Number of channels */
  channels?: number;
  /** Channel layout */
  channelLayout?: ChannelLayout;
  /** Sample format */
  sampleFmt?: SampleFormat;
}

/**
 * Typed options for libopus encoder.
 * Derived from `ffmpeg -h encoder=libopus` dump.
 */
export interface LibOpusOptions {
  /** Target bitrate in kbps. Recommended: 96–128k stereo music, 24–32k voice. */
  bitrate?: number;
  /** VBR mode: on, off, constrained */
  vbr?: 'on' | 'off' | 'constrained';
  /** Opus application mode */
  application?: 'voip' | 'audio' | 'lowdelay';
  /** Frame size in ms: 2.5, 5, 10, 20, 40, 60 */
  frameDuration?: 2.5 | 5 | 10 | 20 | 40 | 60;
  /** Encoder complexity, 0 (fastest) to 10 (best) */
  compressionLevel?: number;
  /** Packet loss percentage to optimize for, 0–100 */
  packetLoss?: number;
  /** Enable FEC (forward error correction) */
  fec?: boolean;
  /** Enable DTX (discontinuous transmission) */
  dtx?: boolean;
  /** Number of channels */
  channels?: number;
  /** Sample rate (always resampled to 48000 internally) */
  sampleRate?: number;
}

/**
 * Typed options for libmp3lame encoder.
 * Derived from `ffmpeg -h encoder=libmp3lame` dump.
 */
export interface LibMp3LameOptions {
  /** VBR quality, 0 (best) to 9 (worst). Enables VBR. */
  qscale?: number;
  /** Target bitrate in kbps (CBR) */
  bitrate?: number;
  /** Compression level for encoder internals, 0–9 */
  compressionLevel?: number;
  /** Reservoir size */
  reservoir?: boolean;
  /** Joint stereo encoding */
  jointStereo?: boolean;
  /** ABR (average bitrate) mode */
  abr?: boolean;
  /** Sample rate */
  sampleRate?: number;
  /** Channels */
  channels?: number;
}

/**
 * Typed options for libvorbis encoder.
 * Derived from `ffmpeg -h encoder=libvorbis` dump.
 */
export interface LibVorbisOptions {
  /** VBR quality, -1 (lowest) to 10 (highest) */
  qscale?: number;
  /** Target bitrate in kbps (CBR/ABR) */
  bitrate?: number;
  /** Minimum bitrate in kbps */
  minrate?: number;
  /** Maximum bitrate in kbps */
  maxrate?: number;
  /** Cutoff frequency in Hz */
  cutoff?: number;
  /** Sample rate */
  sampleRate?: number;
  /** Channels */
  channels?: number;
}

/**
 * Typed options for the FLAC encoder.
 * Derived from `ffmpeg -h encoder=flac` dump.
 */
export interface FlacOptions {
  /** Compression level, 0 (fastest) to 12 (best compression) */
  compressionLevel?: number;
  /** LPC order */
  lpcOrder?: number;
  /** LPC coefficient precision */
  lpcCoeffPrecision?: number;
  /** Prediction order search method */
  predictionOrderMethod?: 'estimation' | 'two_level' | 'four_level' | 'eight_level' | 'search' | 'log';
  /** Min partition order */
  minPartitionOrder?: number;
  /** Max partition order */
  maxPartitionOrder?: number;
}

/**
 * Typed options for AC-3 encoder.
 */
export interface Ac3Options {
  /** Target bitrate in kbps */
  bitrate?: number;
  /** Dialogue level in dBFS */
  dialogueLevel?: number;
  /** Center mix level */
  centerMixLevel?: number;
  /** Surround mix level */
  surroundMixLevel?: number;
  /** Audio coding mode */
  audioCodingMode?: number;
  /** Channels */
  channels?: number;
  /** Sample rate */
  sampleRate?: number;
}

/**
 * Serialize AacOptions to ffmpeg argument array.
 */
export function aacToArgs(opts: AacOptions): string[] {
  const args: string[] = ['-c:a', 'aac'];
  if (opts.aacCoder !== undefined) args.push('-aac_coder', opts.aacCoder);
  if (opts.vbr !== undefined) args.push('-vbr', String(opts.vbr));
  if (opts.bitrate !== undefined) args.push('-b:a', `${opts.bitrate}k`);
  if (opts.sampleRate !== undefined) args.push('-ar', String(opts.sampleRate));
  if (opts.channels !== undefined) args.push('-ac', String(opts.channels));
  if (opts.channelLayout !== undefined) args.push('-channel_layout', opts.channelLayout);
  return args;
}

/**
 * Serialize LibOpusOptions to ffmpeg argument array.
 */
export function opusToArgs(opts: LibOpusOptions): string[] {
  const args: string[] = ['-c:a', 'libopus'];
  if (opts.bitrate !== undefined) args.push('-b:a', `${opts.bitrate}k`);
  if (opts.vbr !== undefined) args.push('-vbr', opts.vbr);
  if (opts.application !== undefined) args.push('-application', opts.application);
  if (opts.frameDuration !== undefined) args.push('-frame_duration', String(opts.frameDuration));
  if (opts.compressionLevel !== undefined) args.push('-compression_level', String(opts.compressionLevel));
  if (opts.packetLoss !== undefined) args.push('-packet_loss', String(opts.packetLoss));
  if (opts.fec !== undefined) args.push('-fec', opts.fec ? '1' : '0');
  if (opts.dtx !== undefined) args.push('-dtx', opts.dtx ? '1' : '0');
  if (opts.channels !== undefined) args.push('-ac', String(opts.channels));
  if (opts.sampleRate !== undefined) args.push('-ar', String(opts.sampleRate));
  return args;
}

/**
 * Serialize LibMp3LameOptions to ffmpeg argument array.
 */
export function mp3ToArgs(opts: LibMp3LameOptions): string[] {
  const args: string[] = ['-c:a', 'libmp3lame'];
  if (opts.qscale !== undefined) args.push('-q:a', String(opts.qscale));
  if (opts.bitrate !== undefined) args.push('-b:a', `${opts.bitrate}k`);
  if (opts.compressionLevel !== undefined) args.push('-compression_level', String(opts.compressionLevel));
  if (opts.jointStereo !== undefined) args.push('-joint_stereo', opts.jointStereo ? '1' : '0');
  if (opts.abr === true) args.push('-abr', '1');
  if (opts.sampleRate !== undefined) args.push('-ar', String(opts.sampleRate));
  if (opts.channels !== undefined) args.push('-ac', String(opts.channels));
  return args;
}

/**
 * Serialize FlacOptions to ffmpeg argument array.
 */
export function flacToArgs(opts: FlacOptions): string[] {
  const args: string[] = ['-c:a', 'flac'];
  if (opts.compressionLevel !== undefined) args.push('-compression_level', String(opts.compressionLevel));
  if (opts.lpcOrder !== undefined) args.push('-lpc_order', String(opts.lpcOrder));
  if (opts.lpcCoeffPrecision !== undefined) args.push('-lpc_coeff_precision', String(opts.lpcCoeffPrecision));
  if (opts.predictionOrderMethod !== undefined) args.push('-prediction_order_method', opts.predictionOrderMethod);
  if (opts.minPartitionOrder !== undefined) args.push('-min_partition_order', String(opts.minPartitionOrder));
  if (opts.maxPartitionOrder !== undefined) args.push('-max_partition_order', String(opts.maxPartitionOrder));
  return args;
}

// ─── Aliases for test-facing names ────────────────────────────────────────────
export { opusToArgs as libOpusToArgs };
export { mp3ToArgs  as libMp3LameToArgs };

// ─── ac3ToArgs ────────────────────────────────────────────────────────────────
export function ac3ToArgs(opts: Ac3Options): string[] {
  const args: string[] = ['-c:a', 'ac3'];
  if (opts.bitrate !== undefined) args.push('-b:a', `${opts.bitrate}k`);
  if (opts.dialogueLevel !== undefined) args.push('-dialnorm', String(opts.dialogueLevel));
  if (opts.centerMixLevel !== undefined) args.push('-center_mixlev', String(opts.centerMixLevel));
  if (opts.surroundMixLevel !== undefined) args.push('-surround_mixlev', String(opts.surroundMixLevel));
  if (opts.audioCodingMode !== undefined) args.push('-acmod', String(opts.audioCodingMode));
  return args;
}

// ─── Additional Audio Codec Helpers ──────────────────────────────────────────

/**
 * Typed options for the Apple Lossless Audio Codec (ALAC) encoder.
 * Native in Apple ecosystem. Available in both FFmpeg v7 and v8.
 */
export interface AlacOptions {
  /**
   * Minimum sample size in bits (16 or 20). Default: 16
   * Set to 24 for 24-bit source material.
   */
  minPredictionOrder?: number;
  maxPredictionOrder?: number;
}

export function alacToArgs(opts: AlacOptions = {}): string[] {
  const args: string[] = ['-c:a', 'alac'];
  if (opts.minPredictionOrder !== undefined) args.push('-min_prediction_order', String(opts.minPredictionOrder));
  if (opts.maxPredictionOrder !== undefined) args.push('-max_prediction_order', String(opts.maxPredictionOrder));
  return args;
}

/**
 * Typed options for the Enhanced AC-3 (E-AC-3 / Dolby Digital Plus) encoder.
 * Required for streaming platforms (Netflix, Amazon). Both v7 and v8.
 */
export interface Eac3Options {
  /** Target bitrate in kbps. Common: 192, 384, 640, 1024 */
  bitrate?: number;
  /** Dialogue normalization level, -31 to -1 dBFS. Default: -31 */
  dialNorm?: number;
  /** Per-frame metadata mixing level */
  mixLevel?: number;
  /** Room type */
  roomType?: 'notindicated' | 'large' | 'small';
  /** Center mix level */
  centerMixLevel?: number;
  /** Surround mix level */
  surroundMixLevel?: number;
}

export function eac3ToArgs(opts: Eac3Options = {}): string[] {
  const args: string[] = ['-c:a', 'eac3'];
  if (opts.bitrate !== undefined) args.push('-b:a', `${opts.bitrate}k`);
  if (opts.dialNorm !== undefined) args.push('-dialnorm', String(opts.dialNorm));
  if (opts.centerMixLevel !== undefined) args.push('-center_mixlev', String(opts.centerMixLevel));
  if (opts.surroundMixLevel !== undefined) args.push('-surround_mixlev', String(opts.surroundMixLevel));
  return args;
}

/**
 * Typed options for the Dolby TrueHD encoder.
 * Lossless — required for Blu-ray authoring. Both v7 and v8.
 */
export interface TruehdOptions {
  /** Sample rate. Default: source */
  sampleRate?: 48000 | 96000 | 192000;
  /** Channel layout: '5.1' | '7.1' */
  channelLayout?: '5.1' | '7.1';
}

export function truehdToArgs(opts: TruehdOptions = {}): string[] {
  const args: string[] = ['-c:a', 'truehd'];
  if (opts.sampleRate !== undefined) args.push('-ar', String(opts.sampleRate));
  if (opts.channelLayout !== undefined) args.push('-channel_layout', opts.channelLayout);
  return args;
}

/**
 * Typed options for the Ogg Vorbis encoder (libvorbis).
 * Open-source, patent-free. Both v7 and v8.
 */
export interface VorbisOptions {
  /** Quality mode -1.0 to 10.0 (higher = better). Default: 3 */
  qscale?: number;
  /** Target bitrate in kbps (overrides quality) */
  bitrate?: number;
  /** Minimum bitrate in kbps */
  minrate?: number;
  /** Maximum bitrate in kbps */
  maxrate?: number;
}

export function vorbisToArgs(opts: VorbisOptions = {}): string[] {
  const args: string[] = ['-c:a', 'libvorbis'];
  if (opts.qscale !== undefined) args.push('-q:a', String(opts.qscale));
  else if (opts.bitrate !== undefined) args.push('-b:a', `${opts.bitrate}k`);
  if (opts.minrate !== undefined) args.push('-minrate', `${opts.minrate}k`);
  if (opts.maxrate !== undefined) args.push('-maxrate', `${opts.maxrate}k`);
  return args;
}

/**
 * Typed options for the WavPack lossless/lossy audio encoder.
 * Both v7 and v8. Supports hybrid (lossy with correction file).
 */
export interface WavpackOptions {
  /** Quality 0–100 for lossy mode, or 'lossless' */
  quality?: number | 'lossless';
  /** Target bitrate in kbps (lossy mode) */
  bitrate?: number;
  /** Encode with extra processing passes for better quality */
  extra?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export function wavpackToArgs(opts: WavpackOptions = {}): string[] {
  const args: string[] = ['-c:a', 'wavpack'];
  if (opts.quality === 'lossless' || opts.quality === undefined) {
    // default is lossless
  } else if (typeof opts.quality === 'number') {
    args.push('-compression_level', String(opts.quality));
  }
  if (opts.bitrate !== undefined) args.push('-b:a', `${opts.bitrate}k`);
  if (opts.extra !== undefined) args.push('-extra', String(opts.extra));
  return args;
}

/**
 * Typed options for PCM (raw audio) encoders.
 * Both v7 and v8 — used for WAV, BWF, and uncompressed masters.
 */
export type PcmFormat =
  | 'pcm_s16le' | 'pcm_s16be'
  | 'pcm_s24le' | 'pcm_s24be'
  | 'pcm_s32le' | 'pcm_s32be'
  | 'pcm_f32le' | 'pcm_f32be'
  | 'pcm_f64le' | 'pcm_f64be'
  | 'pcm_u8' | 'pcm_s8'
  | 'pcm_alaw' | 'pcm_mulaw';

export interface PcmOptions {
  /** Sample rate in Hz. Common: 44100, 48000, 96000. Default: source */
  sampleRate?: number;
  /** Number of channels. Default: source */
  channels?: number;
}

export function pcmToArgs(format: PcmFormat, opts: PcmOptions = {}): string[] {
  const args: string[] = ['-c:a', format];
  if (opts.sampleRate !== undefined) args.push('-ar', String(opts.sampleRate));
  if (opts.channels !== undefined) args.push('-ac', String(opts.channels));
  return args;
}

/**
 * Typed options for the MP2 (MPEG Audio Layer 2) encoder.
 * Used in broadcast (DVB, ATSC), legacy archival. Both v7 and v8.
 */
export interface Mp2Options {
  /** Target bitrate in kbps. Common: 128, 192, 256, 384 */
  bitrate?: number;
  /** Sample rate. Default: 48000 for broadcast */
  sampleRate?: 32000 | 44100 | 48000;
}

export function mp2ToArgs(opts: Mp2Options = {}): string[] {
  const args: string[] = ['-c:a', 'mp2'];
  if (opts.bitrate !== undefined) args.push('-b:a', `${opts.bitrate}k`);
  if (opts.sampleRate !== undefined) args.push('-ar', String(opts.sampleRate));
  return args;
}
