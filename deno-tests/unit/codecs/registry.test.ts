/**
 * deno-tests/unit/codecs/registry.test.ts
 * Unit tests for CapabilityRegistry (Deno — imports from lib/ directly).
 */

import { describe, it } from 'node:test';
import { expect } from '../../lib/expect.ts';
import { CapabilityRegistry } from '../../../lib/codecs/registry.ts';

const registry = new CapabilityRegistry('ffmpeg');

describe('CapabilityRegistry — codec families', () => {
  it('hasCodec recognises h264 family name', () => {
    expect(registry.hasCodec('h264')).toBe(true);
  });

  it('hasCodec returns false for fake codec', () => {
    expect(registry.hasCodec('not_a_real_codec_xyz')).toBe(false);
  });
});

describe('CapabilityRegistry — individual encoder names', () => {
  it('hasCodec recognises libx264 encoder name', () => {
    expect(registry.hasCodec('libx264')).toBe(true);
  });

  it('canEncode libx264 returns true', () => {
    expect(registry.canEncode('libx264')).toBe(true);
  });

  it('canEncode fake returns false', () => {
    expect(registry.canEncode('fake_encoder_xyz')).toBe(false);
  });

  it('encoders set is populated', () => {
    expect(registry.encoders.size > 0).toBe(true);
  });

  it('encoders contains libx264', () => {
    expect(registry.encoders.has('libx264')).toBe(true);
  });
});
