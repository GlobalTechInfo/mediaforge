/**
 * Runtime version guards.
 * These integrate with CapabilityRegistry and VersionInfo to provide
 * actionable errors when a feature isn't available in the detected binary.
 */

import type { VersionInfo } from '../types/version.ts';
import { satisfiesVersion } from '../utils/version.ts';
import type { CapabilityRegistry } from '../codecs/registry.ts';
import { isFeatureExpected, FEATURE_GATES } from './features.ts';

// ─── Guard result ─────────────────────────────────────────────────────────────

export interface GuardResult {
  /** Whether the feature is available */
  available: boolean;
  /** Human-readable reason if not available */
  reason?: string;
  /** Suggested alternative if one exists */
  alternative?: string;
}

// ─── Version-based guards ─────────────────────────────────────────────────────

/**
 * Guard a feature by minimum version.
 * Returns a GuardResult without throwing.
 */
export function guardVersion(
  version: VersionInfo,
  minMajor: number,
  featureName: string,
  minMinor = 0,
): GuardResult {
  if (satisfiesVersion(version, minMajor, minMinor)) {
    return { available: true };
  }
  return {
    available: false,
    reason: `"${featureName}" requires FFmpeg v${minMajor}.${minMinor}+, but found v${version.major}.${version.minor}`,
  };
}

/**
 * Guard a named feature from the FEATURE_GATES table by version.
 */
export function guardFeatureVersion(
  version: VersionInfo,
  featureKey: string,
): GuardResult {
  const gate = FEATURE_GATES[featureKey];
  if (gate === undefined) {
    return { available: false, reason: `Unknown feature: "${featureKey}"` };
  }
  const ok = isFeatureExpected(featureKey, version.major, version.minor);
  if (ok) return { available: true };
  return {
    available: false,
    reason: `"${gate.description}" requires FFmpeg v${gate.minMajor}+, detected v${version.major}.${version.minor}`,
  };
}

// ─── Capability-based guards ──────────────────────────────────────────────────

/**
 * Guard a codec by probing the registry.
 * Checks both encode capability and existence.
 */
export function guardCodec(
  registry: CapabilityRegistry,
  codec: string,
  direction: 'encode' | 'decode' = 'encode',
): GuardResult {
  if (!registry.hasCodec(codec)) {
    const alt = getCodecAlternative(codec);
    return {
      available: false,
      reason: `Codec "${codec}" is not available in the installed ffmpeg binary`,
      ...(alt !== undefined ? { alternative: alt } : {}),
    };
  }
  const canDo = direction === 'encode'
    ? registry.canEncode(codec)
    : registry.canDecode(codec);
  if (!canDo) {
    return {
      available: false,
      reason: `Codec "${codec}" does not support ${direction} in the installed ffmpeg binary`,
    };
  }
  return { available: true };
}

/**
 * Guard a filter by probing the registry.
 */
export function guardFilter(
  registry: CapabilityRegistry,
  filterName: string,
): GuardResult {
  if (!registry.hasFilter(filterName)) {
    const alt = getFilterAlternative(filterName);
    return {
      available: false,
      reason: `Filter "${filterName}" is not available in the installed ffmpeg binary`,
      ...(alt !== undefined ? { alternative: alt } : {}),
    };
  }
  return { available: true };
}

/**
 * Guard a hardware accelerator by probing the registry.
 */
export function guardHwaccel(
  registry: CapabilityRegistry,
  accelName: string,
): GuardResult {
  if (!registry.hasHwaccel(accelName)) {
    const alt = getHwaccelAlternative(accelName);
    return {
      available: false,
      reason: `Hardware accelerator "${accelName}" is not available in the installed ffmpeg binary`,
      ...(alt !== undefined ? { alternative: alt } : {}),
    };
  }
  return { available: true };
}

// ─── Combined guard (version + capability) ────────────────────────────────────

/**
 * Combined guard: check version gate first, then capability.
 * Short-circuits on version failure (skip capability probe if binary might not have it).
 */
export function guardCodecFull(
  version: VersionInfo,
  registry: CapabilityRegistry,
  codec: string,
  direction: 'encode' | 'decode' = 'encode',
  featureKey?: string,
): GuardResult {
  // Version gate first (if applicable)
  if (featureKey !== undefined) {
    const vg = guardFeatureVersion(version, featureKey);
    if (!vg.available) return vg;
  }

  // Then capability probe
  return guardCodec(registry, codec, direction);
}

// ─── Asserting guards (throw on failure) ─────────────────────────────────────

/**
 * Like guardCodec, but throws a GuardError if the codec is unavailable.
 */
export function assertCodec(
  registry: CapabilityRegistry,
  codec: string,
  direction: 'encode' | 'decode' = 'encode',
): void {
  const result = guardCodec(registry, codec, direction);
  if (!result.available) {
    throw new GuardError(result.reason ?? `Codec "${codec}" unavailable`, result.alternative);
  }
}

/**
 * Like guardHwaccel, but throws.
 */
export function assertHwaccel(
  registry: CapabilityRegistry,
  accelName: string,
): void {
  const result = guardHwaccel(registry, accelName);
  if (!result.available) {
    throw new GuardError(result.reason ?? `Hwaccel "${accelName}" unavailable`, result.alternative);
  }
}

/**
 * Like guardFeatureVersion, but throws.
 */
export function assertFeatureVersion(
  version: VersionInfo,
  featureKey: string,
): void {
  const result = guardFeatureVersion(version, featureKey);
  if (!result.available) {
    throw new GuardError(result.reason ?? `Feature "${featureKey}" unavailable`);
  }
}

// ─── GuardError ───────────────────────────────────────────────────────────────

export class GuardError extends Error {
  constructor(
    message: string,
    public readonly alternative?: string,
  ) {
    super(alternative !== undefined ? `${message}. Try: ${alternative}` : message);
    this.name = 'GuardError';
  }
}

// ─── Alternative suggestions table ───────────────────────────────────────────

const CODEC_ALTERNATIVES: Record<string, string> = {
  // NVENC removed in v8 compiled builds
  h264_nvenc: 'h264_vaapi (Linux), h264_mediacodec (Android), libx264 (SW)',
  hevc_nvenc: 'hevc_vaapi, hevc_mediacodec, libx265',
  av1_nvenc:  'av1_vaapi, av1_mediacodec, libsvtav1',
  // VAAPI not available on non-Linux
  h264_vaapi: 'h264_nvenc, h264_mediacodec, libx264',
  hevc_vaapi: 'hevc_nvenc, hevc_mediacodec, libx265',
  // Old codecs
  wmv2: 'libx264 or libx265',
  mpeg4: 'libx264',
  // Audio
  mp2: 'libmp3lame or aac',
};

function getCodecAlternative(codec: string): string | undefined {
  return CODEC_ALTERNATIVES[codec];
}

const FILTER_ALTERNATIVES: Record<string, string> = {
  avgblur_vulkan: 'gblur (CPU), boxblur (CPU)',
  nlmeans_vulkan: 'nlmeans (CPU)',
  scale_vulkan:   'scale (CPU)',
};

function getFilterAlternative(name: string): string | undefined {
  return FILTER_ALTERNATIVES[name];
}

const HWACCEL_ALTERNATIVES: Record<string, string> = {
  cuda:       'vaapi (Linux GPU), mediacodec (Android), software encoding',
  nvenc:      'vaapi, mediacodec, software encoding',
  vaapi:      'cuda (NVIDIA), mediacodec (Android), software',
  mediacodec: 'vaapi (Linux), cuda (NVIDIA), software',
  vulkan:     'vaapi, cuda, software',
  d3d11va:    'cuda, vaapi (Linux only)',
};

function getHwaccelAlternative(name: string): string | undefined {
  return HWACCEL_ALTERNATIVES[name];
}

// ─── Smart codec selector ─────────────────────────────────────────────────────

export interface CodecCandidate {
  /** Codec name to try */
  codec: string;
  /** Optional feature key for version gating */
  featureKey?: string;
}

/**
 * Select the first available codec from a priority list.
 * Useful for graceful degradation: try hardware first, fall back to software.
 *
 * @example
 * const codec = selectBestCodec(version, registry, [
 *   { codec: 'h264_nvenc', featureKey: 'nvenc' },
 *   { codec: 'h264_vaapi', featureKey: 'vaapi' },
 *   { codec: 'h264_mediacodec', featureKey: 'mediacodec' },
 *   { codec: 'libx264' },
 * ]);
 */
export function selectBestCodec(
  version: VersionInfo,
  registry: CapabilityRegistry,
  candidates: CodecCandidate[],
): string | null {
  for (const candidate of candidates) {
    const result = guardCodecFull(version, registry, candidate.codec, 'encode', candidate.featureKey);
    if (result.available) return candidate.codec;
  }
  return null;
}

/**
 * Select the best available hardware accelerator from a priority list.
 */
export function selectBestHwaccel(
  registry: CapabilityRegistry,
  candidates: string[],
): string | null {
  for (const accel of candidates) {
    if (guardHwaccel(registry, accel).available) return accel;
  }
  return null;
}
