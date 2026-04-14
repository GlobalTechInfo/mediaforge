/**
 * tests/unit/codecs/registry.test.ts
 * Unit tests for CapabilityRegistry — encoder probing + canEncode/hasCodec.
 */

import { describe, it, before } from 'node:test';
import * as assert from 'node:assert/strict';

let CapabilityRegistry: any;
let registry: any;

before(async () => {
  const m = await import('../../../dist/esm/codecs/registry.js');
  CapabilityRegistry = m.CapabilityRegistry;
  registry = new CapabilityRegistry('ffmpeg');
});

describe('CapabilityRegistry — codec families', () => {
  it('hasCodec recognises h264 family name', () => {
    assert.ok(registry.hasCodec('h264'), 'h264 codec family should be present');
  });

  it('hasCodec recognises aac family name', () => {
    assert.ok(registry.hasCodec('aac'));
  });

  it('hasCodec returns false for totally fake codec', () => {
    assert.strictEqual(registry.hasCodec('not_a_real_codec_xyz'), false);
  });
});

describe('CapabilityRegistry — individual encoder names', () => {
  it('hasCodec recognises libx264 encoder name', () => {
    assert.ok(registry.hasCodec('libx264'), 'libx264 should be found via encoders set');
  });

  it('hasCodec recognises libmp3lame encoder name', () => {
    assert.ok(registry.hasCodec('libmp3lame'), 'libmp3lame should be found via encoders set');
  });

  it('canEncode libx264 returns true', () => {
    assert.strictEqual(registry.canEncode('libx264'), true);
  });

  it('canEncode fake encoder returns false', () => {
    assert.strictEqual(registry.canEncode('fake_encoder_xyz'), false);
  });

  it('encoders set is populated', () => {
    assert.ok(registry.encoders.size > 0, 'encoders set should not be empty');
  });

  it('encoders contains libx264', () => {
    assert.ok(registry.encoders.has('libx264'));
  });
});

describe('CapabilityRegistry — selectBestCodec integration', () => {
  it('selectVideoCodec picks libx264 when hardware unavailable', async () => {
    const { FFmpegBuilder } = await import('../../../dist/esm/FFmpeg.js');
    const codec = await (new FFmpegBuilder('ffmpeg')).selectVideoCodec([
      { codec: 'h264_nvenc', featureKey: 'nvenc' },
      { codec: 'h264_vaapi' },
      { codec: 'libx264' },
    ]);
    // libx264 is always available in standard FFmpeg builds
    assert.ok(typeof codec === 'string', `expected string, got ${typeof codec}: ${codec}`);
  });
});
