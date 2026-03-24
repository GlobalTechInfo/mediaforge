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
  vulkan_encode: {
    minMajor: 8,
    description: 'Vulkan compute encoders (h264_vulkan, hevc_vulkan, av1_vulkan, ffv1_vulkan)',
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

  // ── New in v7 ──────────────────────────────────────────────────────────────
  av1_nvenc: {
    minMajor: 7,
    description: 'AV1 NVENC encoder',
  },
  av1_vaapi: {
    minMajor: 7,
    description: 'AV1 VAAPI encoder',
  },

  // ── Present since v6 ──────────────────────────────────────────────────────
  nvenc: {
    minMajor: 6,
    description: 'NVENC hardware encoders (NVIDIA GPU)',
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
 * List features that require a newer version than provided.
 */
export function unavailableFeatures(major: number, minor = 0): string[] {
  return Object.keys(FEATURE_GATES).filter(
    (k) => !isFeatureExpected(k, major, minor),
  );
}
