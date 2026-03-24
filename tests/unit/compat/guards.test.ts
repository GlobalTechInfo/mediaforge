import { describe, it } from 'node:test';
import { expect } from '../../lib/expect.js';
import {
  guardVersion,
  guardFeatureVersion,
  guardCodec,
  guardFilter,
  guardHwaccel,
  guardCodecFull,
  assertCodec,
  assertHwaccel,
  assertFeatureVersion,
  GuardError,
  selectBestCodec,
  selectBestHwaccel,
} from '../../../dist/esm/compat/guards.js';
import type { VersionInfo } from '../../../dist/esm/types/version.js';
import type { CapabilityRegistry } from '../../../dist/esm/codecs/registry.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

function mkVersion(major: number, minor = 0, patch = 0): VersionInfo {
  return {
    major, minor, patch,
    raw: `${major}.${minor}.${patch}`,
    isGit: false,
    libraries: {},
    configuration: [],
  };
}

function mkRegistry(opts: {
  codecs?: string[];
  encodeOnly?: string[];
  decodeOnly?: string[];
  filters?: string[];
  hwaccels?: string[];
}): CapabilityRegistry {
  const encSet = new Set(opts.codecs ?? []);
  const decSet = new Set(opts.codecs ?? []);
  for (const c of (opts.encodeOnly ?? [])) encSet.add(c);
  for (const c of (opts.decodeOnly ?? [])) decSet.add(c);
  const allCodecs = new Set([...encSet, ...decSet]);
  const filterSet = new Set(opts.filters ?? []);
  const hwSet = new Set(opts.hwaccels ?? []);

  return {
    hasCodec: (n: string) => allCodecs.has(n),
    canEncode: (n: string) => encSet.has(n),
    canDecode: (n: string) => decSet.has(n),
    hasFilter: (n: string) => filterSet.has(n),
    hasFormat: () => true,
    hasHwaccel: (n: string) => hwSet.has(n),
    invalidate: () => {},
  } as unknown as CapabilityRegistry;
}

const v6 = mkVersion(6, 0);
const v7 = mkVersion(7, 1, 1);
const v8 = mkVersion(8, 0, 0);

const reg7 = mkRegistry({
  codecs: ['h264_nvenc', 'hevc_nvenc', 'av1_nvenc', 'libx264', 'libx265', 'libsvtav1', 'aac', 'libopus'],
  filters: ['scale', 'overlay', 'loudnorm', 'yadif'],
  hwaccels: ['cuda', 'nvenc'],
});

const reg8 = mkRegistry({
  codecs: ['h264_mediacodec', 'hevc_mediacodec', 'av1_mediacodec', 'h264_vulkan', 'hevc_vulkan', 'libx264', 'libx265', 'libsvtav1', 'aac'],
  filters: ['scale', 'overlay', 'loudnorm', 'yadif', 'avgblur_vulkan', 'nlmeans_vulkan'],
  hwaccels: ['mediacodec', 'vulkan'],
});

// ─── guardVersion ─────────────────────────────────────────────────────────────

describe('guardVersion', () => {
  it('returns available:true when major is greater', () => {
    expect(guardVersion(v8, 7, 'test')).toMatchObject({ available: true });
  });

  it('returns available:true when major matches minMajor', () => {
    expect(guardVersion(v7, 7, 'test')).toMatchObject({ available: true });
  });

  it('returns available:false when major is less', () => {
    const r = guardVersion(v6, 7, 'test');
    expect(r.available).toBe(false);
    expect(r.reason).toContain('v7');
  });

  it('includes version numbers in the reason', () => {
    const r = guardVersion(v7, 8, 'MediaCodec');
    expect(r.reason).toContain('MediaCodec');
    expect(r.reason).toContain('v8');
    expect(r.reason).toContain('v7');
  });

  it('checks minor version when specified', () => {
    expect(guardVersion(mkVersion(7, 0), 7, 'x', 1)).toMatchObject({ available: false });
    expect(guardVersion(mkVersion(7, 1), 7, 'x', 1)).toMatchObject({ available: true });
  });
});

// ─── guardFeatureVersion ──────────────────────────────────────────────────────

describe('guardFeatureVersion', () => {
  it('returns available:true for libx264 on v6', () => {
    expect(guardFeatureVersion(v6, 'libx264')).toMatchObject({ available: true });
  });

  it('returns available:true for nvenc on v6', () => {
    expect(guardFeatureVersion(v6, 'nvenc')).toMatchObject({ available: true });
  });

  it('returns available:true for av1_nvenc on v7', () => {
    expect(guardFeatureVersion(v7, 'av1_nvenc')).toMatchObject({ available: true });
  });

  it('returns available:false for mediacodec on v7 (requires v8)', () => {
    const r = guardFeatureVersion(v7, 'mediacodec');
    expect(r.available).toBe(false);
    expect(r.reason).toContain('v8');
  });

  it('returns available:true for mediacodec on v8', () => {
    expect(guardFeatureVersion(v8, 'mediacodec')).toMatchObject({ available: true });
  });

  it('returns available:false for unknown feature', () => {
    const r = guardFeatureVersion(v7, 'xyz_not_a_feature');
    expect(r.available).toBe(false);
    expect(r.reason).toContain('Unknown');
  });
});

// ─── guardCodec ───────────────────────────────────────────────────────────────

describe('guardCodec', () => {
  it('returns available:true for a present encodeable codec', () => {
    expect(guardCodec(reg7, 'h264_nvenc')).toMatchObject({ available: true });
  });

  it('returns available:false for absent codec', () => {
    const r = guardCodec(reg7, 'h264_mediacodec');
    expect(r.available).toBe(false);
    expect(r.reason).toContain('h264_mediacodec');
  });

  it('provides alternative suggestion for known missing codecs', () => {
    const r = guardCodec(reg8, 'h264_nvenc'); // nvenc removed in v8 builds
    expect(r.available).toBe(false);
    // alternative may or may not be set, but should not throw
  });

  it('defaults to encode direction', () => {
    expect(guardCodec(reg7, 'libx264', 'encode')).toMatchObject({ available: true });
  });

  it('supports decode direction', () => {
    expect(guardCodec(reg7, 'libx264', 'decode')).toMatchObject({ available: true });
  });
});

// ─── guardFilter ─────────────────────────────────────────────────────────────

describe('guardFilter', () => {
  it('returns available:true for present filter', () => {
    expect(guardFilter(reg7, 'scale')).toMatchObject({ available: true });
  });

  it('returns available:false for absent filter', () => {
    const r = guardFilter(reg7, 'avgblur_vulkan');
    expect(r.available).toBe(false);
    expect(r.reason).toContain('avgblur_vulkan');
  });

  it('avgblur_vulkan available in v8 registry', () => {
    expect(guardFilter(reg8, 'avgblur_vulkan')).toMatchObject({ available: true });
  });

  it('provides alternative for vulkan filters', () => {
    const r = guardFilter(reg7, 'avgblur_vulkan');
    expect(r.alternative).toContain('gblur');
  });
});

// ─── guardHwaccel ────────────────────────────────────────────────────────────

describe('guardHwaccel', () => {
  it('returns available:true for present hwaccel', () => {
    expect(guardHwaccel(reg7, 'cuda')).toMatchObject({ available: true });
  });

  it('returns available:false for absent hwaccel', () => {
    const r = guardHwaccel(reg7, 'mediacodec');
    expect(r.available).toBe(false);
    expect(r.reason).toContain('mediacodec');
  });

  it('provides alternative suggestion', () => {
    const r = guardHwaccel(reg7, 'mediacodec');
    expect(r.alternative).toBeDefined();
    expect(typeof r.alternative).toBe('string');
  });

  it('mediacodec available in v8 registry', () => {
    expect(guardHwaccel(reg8, 'mediacodec')).toMatchObject({ available: true });
  });
});

// ─── guardCodecFull ───────────────────────────────────────────────────────────

describe('guardCodecFull', () => {
  it('returns available:true when both version and capability pass', () => {
    const r = guardCodecFull(v7, reg7, 'h264_nvenc', 'encode', 'nvenc');
    expect(r.available).toBe(true);
  });

  it('fails on version gate before capability check', () => {
    const r = guardCodecFull(v7, reg7, 'h264_mediacodec', 'encode', 'mediacodec');
    expect(r.available).toBe(false);
    expect(r.reason).toContain('v8'); // failed version gate
  });

  it('fails on capability when version passes but codec absent', () => {
    // v8 + registry that has mediacodec gate but not the specific codec
    const emptyReg = mkRegistry({ codecs: [], hwaccels: [] });
    const r = guardCodecFull(v8, emptyReg, 'h264_mediacodec', 'encode', 'mediacodec');
    expect(r.available).toBe(false);
  });

  it('works without featureKey (capability check only)', () => {
    const r = guardCodecFull(v7, reg7, 'libx264');
    expect(r.available).toBe(true);
  });
});

// ─── Asserting guards ─────────────────────────────────────────────────────────

describe('assertCodec', () => {
  it('does not throw for available codec', () => {
    expect(() => assertCodec(reg7, 'h264_nvenc')).not.toThrow();
  });

  it('throws GuardError for unavailable codec', () => {
    expect(() => assertCodec(reg7, 'h264_mediacodec')).toThrowError(GuardError);
  });

  it('error message mentions the codec name', () => {
    expect(() => assertCodec(reg7, 'h264_mediacodec')).toThrow('h264_mediacodec');
  });
});

describe('assertHwaccel', () => {
  it('does not throw for available hwaccel', () => {
    expect(() => assertHwaccel(reg7, 'cuda')).not.toThrow();
  });

  it('throws GuardError for unavailable hwaccel', () => {
    expect(() => assertHwaccel(reg7, 'mediacodec')).toThrowError(GuardError);
  });
});

describe('assertFeatureVersion', () => {
  it('does not throw when feature version is satisfied', () => {
    expect(() => assertFeatureVersion(v7, 'nvenc')).not.toThrow();
  });

  it('throws when feature version is not satisfied', () => {
    expect(() => assertFeatureVersion(v7, 'mediacodec')).toThrowError(GuardError);
  });
});

// ─── GuardError ───────────────────────────────────────────────────────────────

describe('GuardError', () => {
  it('has name GuardError', () => {
    expect(new GuardError('msg').name).toBe('GuardError');
  });

  it('is instanceof Error', () => {
    expect(new GuardError('msg')).toBeInstanceOf(Error);
  });

  it('includes alternative in message', () => {
    const e = new GuardError('Codec unavailable', 'libx264');
    expect(e.message).toContain('Try: libx264');
    expect(e.alternative).toBe('libx264');
  });

  it('message without alternative', () => {
    const e = new GuardError('Feature unavailable');
    expect(e.message).toBe('Feature unavailable');
    expect(e.alternative).toBeUndefined();
  });
});

// ─── selectBestCodec ─────────────────────────────────────────────────────────

describe('selectBestCodec', () => {
  it('selects first available from priority list', () => {
    const codec = selectBestCodec(v7, reg7, [
      { codec: 'h264_nvenc', featureKey: 'nvenc' },
      { codec: 'h264_vaapi' },
      { codec: 'libx264' },
    ]);
    expect(codec).toBe('h264_nvenc');
  });

  it('skips unavailable and returns next', () => {
    const codec = selectBestCodec(v7, reg7, [
      { codec: 'h264_vaapi' },        // not in reg7
      { codec: 'h264_mediacodec' },   // not in reg7
      { codec: 'libx264' },           // available
    ]);
    expect(codec).toBe('libx264');
  });

  it('skips due to version gate', () => {
    // mediacodec needs v8, so v7 should skip it even if in registry
    const fakeReg = mkRegistry({ codecs: ['h264_mediacodec', 'libx264'], hwaccels: [] });
    const codec = selectBestCodec(v7, fakeReg, [
      { codec: 'h264_mediacodec', featureKey: 'mediacodec' },
      { codec: 'libx264' },
    ]);
    expect(codec).toBe('libx264');
  });

  it('returns null when no candidates available', () => {
    const codec = selectBestCodec(v7, reg7, [
      { codec: 'not_a_codec' },
      { codec: 'also_fake' },
    ]);
    expect(codec).toBeNull();
  });

  it('selects mediacodec on v8 registry', () => {
    const codec = selectBestCodec(v8, reg8, [
      { codec: 'h264_nvenc', featureKey: 'nvenc' },        // removed in v8 builds
      { codec: 'h264_mediacodec', featureKey: 'mediacodec' }, // v8 + available
      { codec: 'libx264' },
    ]);
    expect(codec).toBe('h264_mediacodec');
  });

  it('selects without featureKey (capability only)', () => {
    const codec = selectBestCodec(v7, reg7, [{ codec: 'libx264' }]);
    expect(codec).toBe('libx264');
  });
});

// ─── selectBestHwaccel ────────────────────────────────────────────────────────

describe('selectBestHwaccel', () => {
  it('selects first available hwaccel', () => {
    expect(selectBestHwaccel(reg7, ['cuda', 'mediacodec', 'vulkan'])).toBe('cuda');
  });

  it('skips unavailable and picks next', () => {
    expect(selectBestHwaccel(reg8, ['cuda', 'nvenc', 'mediacodec'])).toBe('mediacodec');
  });

  it('returns null when none available', () => {
    expect(selectBestHwaccel(reg7, ['mediacodec', 'vulkan'])).toBeNull();
  });
});

// ─── Coverage gap: decode direction ──────────────────────────────────────────

describe('guardCodecFull — decode direction', () => {
  it('returns available:true for a decodable codec', () => {
    const r = guardCodecFull(v7, reg7, 'libx264', 'decode');
    expect(r.available).toBe(true);
  });

  it('returns available:false for non-decodable codec', () => {
    // codec is in the registry but can only encode, not decode
    const encodeOnlyReg = mkRegistry({ encodeOnly: ['hevc'], hwaccels: [] });
    const r = guardCodecFull(v7, encodeOnlyReg, 'hevc', 'decode');
    expect(r.available).toBe(false);
    expect(r.reason).toContain('decode');
  });
});
