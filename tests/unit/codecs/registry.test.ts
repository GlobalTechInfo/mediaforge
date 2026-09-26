/**
 * tests/unit/codecs/registry.test.ts
 * Unit tests for CapabilityRegistry — encoder probing + canEncode/hasCodec.
 */

import { describe, it, before } from 'node:test';
import * as assert from 'node:assert/strict';
import { selectBestCodec } from '../../../lib/compat/guards.ts';
import { probeVersion } from '../../../lib/utils/version.ts';

// A fixed version, so a feature gate never depends on the ffmpeg the suite
// happens to be running against.
const version = probeVersion('ffmpeg');

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

  it('encoders set is populated with real encoder names', () => {
    assert.ok(registry.encoders.size > 50, `only ${registry.encoders.size} encoders parsed`);
    assert.ok(registry.encoders.has('libx264'), 'libx264 missing from the encoder list');
    assert.ok(registry.encoders.has('aac'), 'aac missing from the encoder list');
    assert.ok(!registry.encoders.has(''), 'the encoder list has an empty entry');
  });

  it('encoders set is disjoint from a name no build has', () => {
    assert.ok(!registry.encoders.has('fake_encoder_xyz'));
  });
});

describe('CapabilityRegistry — selectBestCodec integration', () => {
  // A stub registry, so the answer depends on the selection order under test
  // rather than on which GPU encoders the machine running the suite happens to
  // have. A host with VAAPI installed would otherwise pick h264_vaapi here.
  function stubRegistry(available: string[]) {
    return {
      hasCodec: (c: string) => available.includes(c),
      canEncode: (c: string) => available.includes(c),
      canDecode: (c: string) => available.includes(c),
    } as any;
  }

  function builderWith(available: string[]) {
    return { selectVideoCodec: (c: any[]) =>
      selectBestCodec(version, stubRegistry(available), c) } as any;
  }

  it('picks the first candidate the registry can encode', () => {
    // Hardware first, software last: with all three present, hardware wins.
    assert.strictEqual(
      builderWith(['h264_nvenc', 'h264_vaapi', 'libx264']).selectVideoCodec([
        { codec: 'h264_nvenc' },
        { codec: 'h264_vaapi' },
        { codec: 'libx264' },
      ]),
      'h264_nvenc',
    );
  });

  it('skips unavailable candidates down the priority list', () => {
    // Only the software encoder exists, so the two hardware entries must be
    // passed over rather than chosen blindly.
    assert.strictEqual(
      builderWith(['libx264']).selectVideoCodec([
        { codec: 'h264_nvenc' },
        { codec: 'h264_vaapi' },
        { codec: 'libx264' },
      ]),
      'libx264',
    );
  });

  it('returns null when no candidate is available', () => {
    assert.strictEqual(
      builderWith([]).selectVideoCodec([
        { codec: 'h264_nvenc' },
        { codec: 'h264_vaapi' },
        { codec: 'libx264' },
      ]),
      null,
    );
  });

  it('returns null for an empty candidate list', () => {
    assert.strictEqual(builderWith(['libx264']).selectVideoCodec([]), null);
  });

  it('a version-gated candidate is rejected before the probe runs', () => {
    // `nvenc` requires a modern ffmpeg; on a 4.x build the gate refuses it even
    // though the encoder name is present, so the next candidate must win.
    const old = { ...version, major: 4, minor: 4 };
    const probed: string[] = [];
    const spy = {
      hasCodec: (c: string) => { probed.push(c); return true; },
      canEncode: () => true,
    } as any;
    assert.strictEqual(
      selectBestCodec(old, spy, [
        { codec: 'h264_nvenc', featureKey: 'nvenc' },
        { codec: 'libx264' },
      ]),
      'libx264',
    );
    assert.ok(!probed.includes('h264_nvenc'), 'the gated candidate was probed anyway');
  });
});
