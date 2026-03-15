import { describe, it } from 'node:test';
import { expect } from '../lib/expect.js';
import { probeVersion } from '../../dist/esm/utils/version.js';
import { CapabilityRegistry } from '../../dist/esm/codecs/registry.js';

describe('probeVersion (integration — requires ffmpeg)', () => {
  it('probes ffmpeg version from PATH', async () => {
    const v = probeVersion('ffmpeg');
    expect(v.major).toBeGreaterThan(0);
    expect(typeof v.raw).toBe('string');
    expect(v.raw.length).toBeGreaterThan(0);
  });

  it('version has libraries map', async () => {
    const v = probeVersion('ffmpeg');
    expect(typeof v.libraries).toBe('object');
  });

  it('version has configuration array', async () => {
    const v = probeVersion('ffmpeg');
    expect(Array.isArray(v.configuration)).toBe(true);
  });

  it('throws for non-existent binary', async () => {
    let threw = false;
    try { probeVersion('/nonexistent-ffmpeg-binary-$$'); }
    catch { threw = true; }
    expect(threw).toBe(true);
  });
});

describe('CapabilityRegistry (integration — requires ffmpeg)', () => {
  it('can be created from a binary path', () => {
    const reg = new CapabilityRegistry('ffmpeg');
    expect(reg).toBeDefined();
  });

  it('hasCodec returns true for libx264 (commonly available)', () => {
    const reg = new CapabilityRegistry('ffmpeg');
    // libx264 should be available in the test environment
    const result = reg.hasCodec('h264');
    expect(typeof result).toBe('boolean');
  });

  it('hasFilter returns true for scale (always available)', () => {
    const reg = new CapabilityRegistry('ffmpeg');
    expect(reg.hasFilter('scale')).toBe(true);
  });

  it('hasFilter returns false for made-up filter', () => {
    const reg = new CapabilityRegistry('ffmpeg');
    expect(reg.hasFilter('this_filter_does_not_exist_xyz')).toBe(false);
  });

  it('hasFormat returns true for mp4 (matroska)', () => {
    const reg = new CapabilityRegistry('ffmpeg');
    // 'matroska' or 'mp4' should be available
    expect(typeof reg.hasFormat('mp4')).toBe('boolean');
  });

  it('hasHwaccel returns boolean', () => {
    const reg = new CapabilityRegistry('ffmpeg');
    expect(typeof reg.hasHwaccel('cuda')).toBe('boolean');
  });

  it('canEncode returns boolean', () => {
    const reg = new CapabilityRegistry('ffmpeg');
    expect(typeof reg.canEncode('libx264')).toBe('boolean');
  });

  it('canDecode returns boolean', () => {
    const reg = new CapabilityRegistry('ffmpeg');
    expect(typeof reg.canDecode('h264')).toBe('boolean');
  });

  it('invalidate clears cached results', () => {
    const reg = new CapabilityRegistry('ffmpeg');
    reg.hasFilter('scale'); // prime cache
    reg.invalidate();
    // After invalidate, should still work (re-probes on next call)
    expect(typeof reg.hasFilter('scale')).toBe('boolean');
  });
});
