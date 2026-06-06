/**
 * Feature availability by FFmpeg major version.
 * All entries derived from the actual v7 and v8 binary dumps.
 * Runtime probing is always preferred — this table is the fallback/documentation layer.
 */

export interface FeatureGate {
  /** Minimum major version required */
  minMajor: number;
  /** Minimum minor version (within the major), default 0 */
  minMinor?: number;
  /** Feature description for error messages */
  description: string;
}

/** Feature → minimum version map */
export const FEATURE_GATES: Record<string, FeatureGate> = {
  // ── New in v8 ──────────────────────────────────────────────────────────────
  mediacodec: {
    minMajor: 8,
    description: 'MediaCodec hardware encoders/decoders (Android)',
  },
  h264_mediacodec: {
    minMajor: 8,
    description: 'H.264 MediaCodec encoder',
  },
  hevc_mediacodec: {
    minMajor: 8,
    description: 'HEVC MediaCodec encoder',
  },
  av1_mediacodec: {
    minMajor: 8,
    description: 'AV1 MediaCodec encoder',
  },
  vulkan_encode: {
    minMajor: 8,
    description: 'Vulkan compute encoders (h264_vulkan, hevc_vulkan, av1_vulkan, ffv1_vulkan)',
  },
  h264_vulkan: {
    minMajor: 8,
    description: 'H.264 Vulkan encoder',
  },
  hevc_vulkan: {
    minMajor: 8,
    description: 'HEVC Vulkan encoder',
  },
  av1_vulkan: {
    minMajor: 8,
    description: 'AV1 Vulkan encoder',
  },
  ffv1_vulkan: {
    minMajor: 8,
    description: 'FFv1 Vulkan encoder',
  },
  prores_ks_vulkan: {
    minMajor: 8,
    description: 'ProRes Vulkan encoder',
  },
  apv_codec: {
    minMajor: 8,
    description: 'APV (Advanced Professional Video) codec',
  },
  dnxuncompressed: {
    minMajor: 8,
    description: 'DNxUncompressed / SMPTE RDD 50 encoder',
  },
  dolby_vision_libx265: {
    minMajor: 8,
    description: 'Dolby Vision encoding via libx265 / libsvtav1',
  },
  libswresample_6: {
    minMajor: 8,
    description: 'libswresample 6.x API',
  },
  libavfilter_11: {
    minMajor: 8,
    description: 'libavfilter 11.x (includes new Vulkan filters)',
  },
  vulkan_filters: {
    minMajor: 8,
    description: 'Vulkan GPU-accelerated filters (avgblur_vulkan, nlmeans_vulkan, blackdetect_vulkan)',
  },
  amf: {
    minMajor: 8,
    description: 'AMD AMF encoders (h264_amf, hevc_amf, av1_amf)',
  },
  h264_amf: {
    minMajor: 8,
    description: 'H.264 AMD AMF encoder',
  },
  hevc_amf: {
    minMajor: 8,
    description: 'HEVC AMD AMF encoder',
  },
  av1_amf: {
    minMajor: 8,
    description: 'AV1 AMD AMF encoder',
  },
  videotoolbox: {
    minMajor: 8,
    description: 'Apple VideoToolbox (h264_videotoolbox, hevc_videotoolbox)',
  },
  h264_videotoolbox: {
    minMajor: 8,
    description: 'H.264 VideoToolbox encoder',
  },
  hevc_videotoolbox: {
    minMajor: 8,
    description: 'HEVC VideoToolbox encoder',
  },

  // ── New in v7 ──────────────────────────────────────────────────────────────
  av1_nvenc: {
    minMajor: 7,
    description: 'AV1 NVENC encoder',
  },
  av1_vaapi: {
    minMajor: 7,
    description: 'AV1 VAAPI encoder',
  },
  av1_qsv: {
    minMajor: 7,
    description: 'AV1 QSV encoder',
  },
  libvpx_vp9_10bit: {
    minMajor: 7,
    description: 'libvpx-vp9 10-bit encoding support',
  },
  libx264_10bit: {
    minMajor: 7,
    description: 'libx264 10-bit (high10/high422/high444 profile) encoding',
  },
  libsvtav1_10bit: {
    minMajor: 7,
    description: 'SVT-AV1 10-bit encoding support',
  },
  avx512_optimizations: {
    minMajor: 7,
    description: 'AVX-512 SIMD optimizations in libavcodec/libswscale',
  },
  avgblur_vulkan: {
    minMajor: 7,
    description: 'Vulkan-accelerated average blur filter',
  },
  nlmeans_vulkan: {
    minMajor: 7,
    description: 'Vulkan-accelerated non-local means denoise filter',
  },
  blackdetect_vulkan: {
    minMajor: 7,
    description: 'Vulkan-accelerated black detect filter',
  },

  // ── Present since v6 ──────────────────────────────────────────────────────
  nvenc: {
    minMajor: 6,
    description: 'NVENC hardware encoders (NVIDIA GPU)',
  },
  h264_nvenc: {
    minMajor: 6,
    description: 'H.264 NVENC encoder',
  },
  hevc_nvenc: {
    minMajor: 6,
    description: 'HEVC NVENC encoder',
  },
  vaapi: {
    minMajor: 6,
    description: 'VAAPI hardware encoders (Linux GPU)',
  },
  qsv: {
    minMajor: 6,
    description: 'QSV hardware encoders (Intel Quick Sync)',
  },
  libx264: {
    minMajor: 6,
    description: 'libx264 H.264 encoder',
  },
  libx265: {
    minMajor: 6,
    description: 'libx265 HEVC encoder',
  },
  libsvtav1: {
    minMajor: 6,
    description: 'SVT-AV1 encoder',
  },
  libvpx_vp9: {
    minMajor: 6,
    description: 'libvpx-vp9 VP9 encoder',
  },
  libopus: {
    minMajor: 6,
    description: 'libopus Opus encoder',
  },

  // ── Audio codecs (stable since v6) ────────────────────────────────────────
  aac: {
    minMajor: 6,
    description: 'AAC audio encoder/decoder',
  },
  libmp3lame: {
    minMajor: 6,
    description: 'MP3 audio encoder (libmp3lame)',
  },
  flac: {
    minMajor: 6,
    description: 'FLAC audio encoder/decoder',
  },
  libvorbis: {
    minMajor: 6,
    description: 'Vorbis audio encoder (libvorbis)',
  },
  ac3: {
    minMajor: 6,
    description: 'AC-3 audio encoder/decoder',
  },
  eac3: {
    minMajor: 6,
    description: 'E-AC-3 audio encoder/decoder',
  },
  alac: {
    minMajor: 6,
    description: 'ALAC audio encoder/decoder',
  },
  truehd: {
    minMajor: 6,
    description: 'TrueHD audio encoder/decoder',
  },
};

/**
 * Check if a named feature is expected to be available in the given major version.
 * This is the static table fallback — prefer runtime CapabilityRegistry probing.
 */
export function isFeatureExpected(
  featureKey: string,
  major: number,
  minor = 0,
): boolean {
  const gate = FEATURE_GATES[featureKey];
  if (gate === undefined) return false;
  const reqMajor = gate.minMajor;
  const reqMinor = gate.minMinor ?? 0;
  if (major > reqMajor) return true;
  if (major < reqMajor) return false;
  return minor >= reqMinor;
}

/**
 * List all features expected to be available at a given major.minor version.
 */
export function availableFeatures(major: number, minor = 0): string[] {
  return Object.keys(FEATURE_GATES).filter((k) =>
    isFeatureExpected(k, major, minor),
  );
}

/**
 * List all features NOT expected to be available at a given major.minor version.
 */
export function unavailableFeatures(major: number, minor = 0): string[] {
  return Object.keys(FEATURE_GATES).filter((k) =>
    !isFeatureExpected(k, major, minor),
  );
}


