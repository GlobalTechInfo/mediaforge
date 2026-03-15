import { describe, it } from 'node:test';
import { expect } from '../../lib/expect.js';
import {
  FEATURE_GATES,
  isFeatureExpected,
  availableFeatures,
  unavailableFeatures,
} from '../../../dist/esm/compat/features.js';

describe('FEATURE_GATES', () => {
  it('contains v6+ features', () => {
    expect(FEATURE_GATES['nvenc']).toBeDefined();
    expect(FEATURE_GATES['libx264']).toBeDefined();
    expect(FEATURE_GATES['vaapi']).toBeDefined();
  });

  it('contains v7+ features', () => {
    expect(FEATURE_GATES['av1_nvenc']).toBeDefined();
    expect(FEATURE_GATES['av1_vaapi']).toBeDefined();
  });

  it('contains v8+ features', () => {
    expect(FEATURE_GATES['mediacodec']).toBeDefined();
    expect(FEATURE_GATES['vulkan_encode']).toBeDefined();
    expect(FEATURE_GATES['dolby_vision_libx265']).toBeDefined();
  });

  it('every gate has a minMajor and description', () => {
    for (const [key, gate] of Object.entries(FEATURE_GATES)) {
      expect(typeof gate.minMajor, `${key}.minMajor`).toBe('number');
      expect(typeof gate.description, `${key}.description`).toBe('string');
      expect(gate.description.length, `${key}.description length`).toBeGreaterThan(0);
    }
  });
});

describe('isFeatureExpected', () => {
  it('libx264 expected on v6', () => {
    expect(isFeatureExpected('libx264', 6)).toBe(true);
  });

  it('libx264 expected on v7', () => {
    expect(isFeatureExpected('libx264', 7)).toBe(true);
  });

  it('libx264 expected on v8', () => {
    expect(isFeatureExpected('libx264', 8)).toBe(true);
  });

  it('av1_nvenc not expected on v6', () => {
    expect(isFeatureExpected('av1_nvenc', 6)).toBe(false);
  });

  it('av1_nvenc expected on v7', () => {
    expect(isFeatureExpected('av1_nvenc', 7)).toBe(true);
  });

  it('mediacodec not expected on v7', () => {
    expect(isFeatureExpected('mediacodec', 7)).toBe(false);
  });

  it('mediacodec expected on v8', () => {
    expect(isFeatureExpected('mediacodec', 8)).toBe(true);
  });

  it('vulkan_encode not expected on v7', () => {
    expect(isFeatureExpected('vulkan_encode', 7)).toBe(false);
  });

  it('vulkan_encode expected on v8', () => {
    expect(isFeatureExpected('vulkan_encode', 8)).toBe(true);
  });

  it('returns false for unknown feature', () => {
    expect(isFeatureExpected('not_a_real_feature', 8)).toBe(false);
  });
});

describe('availableFeatures', () => {
  it('v6 has basic codecs', () => {
    const features = availableFeatures(6);
    expect(features).toContain('libx264');
    expect(features).toContain('libx265');
    expect(features).toContain('nvenc');
    expect(features).toContain('vaapi');
  });

  it('v6 does not have v7+ features', () => {
    const features = availableFeatures(6);
    expect(features).not.toContain('av1_nvenc');
    expect(features).not.toContain('mediacodec');
  });

  it('v7 has av1_nvenc and av1_vaapi', () => {
    const features = availableFeatures(7);
    expect(features).toContain('av1_nvenc');
    expect(features).toContain('av1_vaapi');
  });

  it('v7 does not have v8+ features', () => {
    const features = availableFeatures(7);
    expect(features).not.toContain('mediacodec');
    expect(features).not.toContain('vulkan_encode');
  });

  it('v8 has all features', () => {
    const features = availableFeatures(8);
    expect(features).toContain('mediacodec');
    expect(features).toContain('vulkan_encode');
    expect(features).toContain('libx264');
    expect(features).toContain('av1_nvenc');
  });

  it('returns an array', () => {
    expect(Array.isArray(availableFeatures(7))).toBe(true);
  });
});

describe('unavailableFeatures', () => {
  it('v6 has v7+ and v8+ features as unavailable', () => {
    const features = unavailableFeatures(6);
    expect(features).toContain('av1_nvenc');
    expect(features).toContain('mediacodec');
    expect(features).toContain('vulkan_encode');
  });

  it('v6 does not list v6 features as unavailable', () => {
    const features = unavailableFeatures(6);
    expect(features).not.toContain('libx264');
    expect(features).not.toContain('nvenc');
  });

  it('v7 only has v8+ as unavailable', () => {
    const features = unavailableFeatures(7);
    expect(features).toContain('mediacodec');
    expect(features).not.toContain('av1_nvenc');
    expect(features).not.toContain('libx264');
  });

  it('v8 has nothing unavailable', () => {
    expect(unavailableFeatures(8)).toHaveLength(0);
  });
});
