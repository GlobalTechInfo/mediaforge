/**
 * Codec, format, and pixel/sample type definitions.
 * All values derived directly from ffmpeg v7/v8 -codecs / -pix_fmts / -sample_fmts dumps.
 */

// ─── Pixel Formats ────────────────────────────────────────────────────────────
// Full set from both v7 and v8 dumps (union of both)
export type PixelFormat =
  // 8-bit YUV planar
  | 'yuv420p' | 'yuv422p' | 'yuv444p' | 'yuv410p' | 'yuv411p' | 'yuvj420p'
  | 'yuvj422p' | 'yuvj444p' | 'yuv440p' | 'yuvj440p'
  // 9/10/12/14/16-bit YUV planar
  | 'yuv420p9be' | 'yuv420p9le' | 'yuv420p10be' | 'yuv420p10le'
  | 'yuv420p12be' | 'yuv420p12le' | 'yuv420p14be' | 'yuv420p14le'
  | 'yuv420p16be' | 'yuv420p16le'
  | 'yuv422p9be' | 'yuv422p9le' | 'yuv422p10be' | 'yuv422p10le'
  | 'yuv422p12be' | 'yuv422p12le' | 'yuv422p14be' | 'yuv422p14le'
  | 'yuv422p16be' | 'yuv422p16le'
  | 'yuv444p9be' | 'yuv444p9le' | 'yuv444p10be' | 'yuv444p10le'
  | 'yuv444p12be' | 'yuv444p12le' | 'yuv444p14be' | 'yuv444p14le'
  | 'yuv444p16be' | 'yuv444p16le'
  | 'yuv440p10le' | 'yuv440p10be' | 'yuv440p12le' | 'yuv440p12be'
  // Semi-planar (NV)
  | 'nv12' | 'nv21' | 'nv16' | 'nv20le' | 'nv20be'
  | 'nv24' | 'nv42' | 'p010le' | 'p010be' | 'p012le' | 'p012be'
  | 'p016le' | 'p016be' | 'p210be' | 'p210le' | 'p212be' | 'p212le'
  | 'p216be' | 'p216le' | 'p410be' | 'p410le' | 'p412be' | 'p412le'
  | 'p416be' | 'p416le'
  // RGB / BGR packed
  | 'rgb24' | 'bgr24' | 'rgb48be' | 'rgb48le' | 'bgr48be' | 'bgr48le'
  | 'rgb565be' | 'rgb565le' | 'rgb555be' | 'rgb555le'
  | 'bgr565be' | 'bgr565le' | 'bgr555be' | 'bgr555le'
  | 'rgb444be' | 'rgb444le' | 'bgr444be' | 'bgr444le'
  | 'rgb8' | 'bgr8' | 'rgb4' | 'bgr4' | 'rgb4_byte' | 'bgr4_byte'
  | 'rgb0' | 'bgr0' | '0rgb' | '0bgr'
  | 'argb' | 'rgba' | 'abgr' | 'bgra'
  | 'rgba64be' | 'rgba64le' | 'bgra64be' | 'bgra64le'
  // GBR planar
  | 'gbrp' | 'gbrp9be' | 'gbrp9le' | 'gbrp10be' | 'gbrp10le'
  | 'gbrp12be' | 'gbrp12le' | 'gbrp14be' | 'gbrp14le' | 'gbrp16be' | 'gbrp16le'
  | 'gbrap' | 'gbrap10be' | 'gbrap10le' | 'gbrap12be' | 'gbrap12le'
  | 'gbrap16be' | 'gbrap16le'
  // Grayscale
  | 'gray' | 'gray8a' | 'gray9be' | 'gray9le' | 'gray10be' | 'gray10le'
  | 'gray12be' | 'gray12le' | 'gray14be' | 'gray14le' | 'gray16be' | 'gray16le'
  | 'ya8' | 'ya16be' | 'ya16le'
  // Bayer
  | 'bayer_bggr8' | 'bayer_rggb8' | 'bayer_gbrg8' | 'bayer_grbg8'
  | 'bayer_bggr16be' | 'bayer_bggr16le' | 'bayer_rggb16be' | 'bayer_rggb16le'
  | 'bayer_gbrg16be' | 'bayer_gbrg16le' | 'bayer_grbg16be' | 'bayer_grbg16le'
  // Misc / hardware
  | 'pal8' | 'monow' | 'monob' | 'uyvy422' | 'uyyvyy411'
  | 'yuyv422' | 'yvyu422' | 'vuyx' | 'xvyu2101010'
  | 'xvyu12_16be' | 'xvyu16be'
  | 'ayuv64le' | 'ayuv64be'
  | 'videotoolbox_vld' | 'cuda' | 'drm_prime' | 'opencl' | 'vulkan'
  | 'mediacodec' | 'vaapi' | 'vdpau' | 'd3d11' | 'd3d11va_vld'
  | 'qsv' | 'mmal' | 'xvmc' | 'dxva2_vld';

// ─── Sample Formats ───────────────────────────────────────────────────────────
// From both v7 and v8 -sample_fmts output — identical between versions
export type SampleFormat =
  | 'u8' | 's16' | 's32' | 'flt' | 'dbl'       // interleaved
  | 'u8p' | 's16p' | 's32p' | 'fltp' | 'dblp'  // planar
  | 's64' | 's64p';                              // 64-bit integer (less common)

// ─── Channel Layouts ──────────────────────────────────────────────────────────
export type ChannelLayout =
  | 'mono' | 'stereo' | '2.1' | '3.0' | '3.0(back)'
  | '4.0' | 'quad' | 'quad(side)' | '3.1'
  | '5.0' | '5.0(side)' | '4.1' | '5.1' | '5.1(side)'
  | '6.0' | '6.0(front)' | 'hexagonal' | '6.1' | '6.1(back)' | '6.1(front)'
  | '7.0' | '7.0(front)' | '7.1' | '7.1(wide)' | '7.1(wide-side)' | '7.1(top)'
  | 'octagonal' | 'cube' | 'hexadecagonal' | '22.2'
  | 'stereo downmix' | 'ambisonic first order';

// ─── Codec Capability Flags ───────────────────────────────────────────────────
export interface CodecFlags {
  /** Can decode */
  decode: boolean;
  /** Can encode */
  encode: boolean;
  /** Media type */
  type: 'video' | 'audio' | 'subtitle' | 'data' | 'attachment';
  /** Intra-frame only (I-frame only) codec */
  intraOnly: boolean;
  /** Supports lossy compression */
  lossy: boolean;
  /** Supports lossless compression */
  lossless: boolean;
}

/** Info about a codec from ffmpeg -codecs */
export interface CodecInfo {
  /** Codec name, e.g. "h264", "aac" */
  name: string;
  /** Human-readable description */
  description: string;
  flags: CodecFlags;
}

/** Info about a filter from ffmpeg -filters */
export interface FilterInfo {
  /** Filter name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Supports timeline editing */
  timeline: boolean;
  /** Is a slice-based filter */
  sliceBased: boolean;
}

/** Info about a container format from ffmpeg -formats */
export interface FormatInfo {
  /** Format name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Can demux (read) */
  demux: boolean;
  /** Can mux (write) */
  mux: boolean;
}
