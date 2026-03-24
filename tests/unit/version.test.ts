import { describe, it } from 'node:test';
import { expect } from '../lib/expect.js';
import { parseVersionOutput, satisfiesVersion, formatVersion } from '../../dist/esm/utils/version.js';

const RELEASE_OUTPUT = `ffmpeg version 7.1.1 Copyright (c) 2000-2024 the FFmpeg developers
built with gcc 15 (Ubuntu 15.1.0-1ubuntu1)
configuration: --enable-gpl --enable-libx264 --enable-libx265 --enable-libvpx
  libavutil      59.39.100 / 59.39.100
  libavcodec     61.19.100 / 61.19.100
  libavformat    61. 7.100 / 61. 7.100
  libavfilter    10. 4.100 / 10. 4.100
  libswscale      8. 3.100 /  8. 3.100
  libswresample   5. 3.100 /  5. 3.100`;

const GIT_OUTPUT = `ffmpeg version N-116912-gabcdef1234 Copyright (c) 2000-2025 the FFmpeg developers
built with clang 21
configuration: --enable-libx264
libavutil      60. 8.100 / 60. 8.100`;

describe('parseVersionOutput', () => {
  it('parses a release version correctly', () => {
    const v = parseVersionOutput(RELEASE_OUTPUT);
    expect(v.major).toBe(7);
    expect(v.minor).toBe(1);
    expect(v.patch).toBe(1);
    expect(v.raw).toBe('7.1.1');
    expect(v.isGit).toBe(false);
  });

  it('extracts library versions', () => {
    const v = parseVersionOutput(RELEASE_OUTPUT);
    expect(v.libraries['libavcodec']).toBe('61.19.100');
    expect(v.libraries['libavutil']).toBe('59.39.100');
    // Normalizes spaces in "61. 7.100"
    expect(v.libraries['libavformat']).toBe('61.7.100');
  });

  it('extracts configuration flags', () => {
    const v = parseVersionOutput(RELEASE_OUTPUT);
    expect(v.configuration).toContain('--enable-gpl');
    expect(v.configuration).toContain('--enable-libx264');
  });

  it('parses a git/nightly build', () => {
    const v = parseVersionOutput(GIT_OUTPUT);
    expect(v.isGit).toBe(true);
    expect(v.raw).toBe('N-116912-gabcdef1234');
    expect(v.major).toBe(0);
  });

  it('handles unrecognized version format gracefully', () => {
    const v = parseVersionOutput('something unexpected');
    expect(v.major).toBe(0);
    expect(v.isGit).toBe(false);
  });

  it('returns empty config and libraries for minimal output', () => {
    const v = parseVersionOutput('ffmpeg version 8.0.0');
    expect(v.major).toBe(8);
    expect(v.configuration).toEqual([]);
    expect(v.libraries).toEqual({});
  });
});

describe('satisfiesVersion', () => {
  it('returns true when major is greater', () => {
    expect(satisfiesVersion({ major: 8, minor: 0 }, 7)).toBe(true);
  });

  it('returns false when major is less', () => {
    expect(satisfiesVersion({ major: 6, minor: 5 }, 7)).toBe(false);
  });

  it('returns true when major matches and minor is sufficient', () => {
    expect(satisfiesVersion({ major: 7, minor: 1 }, 7, 1)).toBe(true);
  });

  it('returns false when major matches but minor is insufficient', () => {
    expect(satisfiesVersion({ major: 7, minor: 0 }, 7, 1)).toBe(false);
  });

  it('defaults minMinor to 0', () => {
    expect(satisfiesVersion({ major: 7, minor: 0 }, 7)).toBe(true);
  });
});

describe('formatVersion', () => {
  it('formats a release version', () => {
    const v = parseVersionOutput(RELEASE_OUTPUT);
    expect(formatVersion(v)).toBe('7.1.1');
  });

  it('formats a git build with git/ prefix', () => {
    const v = parseVersionOutput(GIT_OUTPUT);
    expect(formatVersion(v)).toBe('git/N-116912-gabcdef1234');
  });
});
