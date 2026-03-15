import { describe, it, afterEach } from 'node:test';
import { expect } from '../lib/expect.js';
import {
  resolveBinary,
  resolveProbe,
  isBinaryAvailable,
  BinaryNotFoundError,
  BinaryNotExecutableError,
  validateBinary,
} from '../../dist/esm/utils/binary.js';

describe('resolveBinary', () => {
  afterEach(() => {
    delete process.env['FFMPEG_PATH'];
  });

  it('returns explicit path when provided', () => {
    expect(resolveBinary('/usr/local/bin/ffmpeg')).toBe('/usr/local/bin/ffmpeg');
  });

  it('returns FFMPEG_PATH env when set and no explicit path', () => {
    process.env['FFMPEG_PATH'] = '/custom/ffmpeg';
    expect(resolveBinary()).toBe('/custom/ffmpeg');
  });

  it('returns "ffmpeg" when nothing is configured', () => {
    delete process.env['FFMPEG_PATH'];
    expect(resolveBinary()).toBe('ffmpeg');
  });

  it('explicit path takes priority over env', () => {
    process.env['FFMPEG_PATH'] = '/env/ffmpeg';
    expect(resolveBinary('/explicit/ffmpeg')).toBe('/explicit/ffmpeg');
  });
});

describe('resolveProbe', () => {
  afterEach(() => {
    delete process.env['FFPROBE_PATH'];
  });

  it('returns explicit path when provided', () => {
    expect(resolveProbe('/usr/local/bin/ffprobe')).toBe('/usr/local/bin/ffprobe');
  });

  it('returns FFPROBE_PATH env when set', () => {
    process.env['FFPROBE_PATH'] = '/custom/ffprobe';
    expect(resolveProbe()).toBe('/custom/ffprobe');
  });

  it('returns "ffprobe" as default', () => {
    delete process.env['FFPROBE_PATH'];
    expect(resolveProbe()).toBe('ffprobe');
  });
});

describe('validateBinary', () => {
  it('throws BinaryNotFoundError for a non-existent absolute path', () => {
    expect(() => validateBinary('/absolutely/does/not/exist/ffmpeg')).toThrow(
      BinaryNotFoundError,
    );
  });

  it('throws BinaryNotFoundError for an unknown plain name', () => {
    expect(() => validateBinary('definitely_not_a_real_binary_xyz')).toThrow(
      BinaryNotFoundError,
    );
  });
});

describe('isBinaryAvailable', () => {
  it('returns false for a non-existent binary', () => {
    expect(isBinaryAvailable('/no/such/binary')).toBe(false);
  });

  it('returns false for an unknown plain name', () => {
    expect(isBinaryAvailable('definitely_not_a_real_binary_xyz')).toBe(false);
  });
});

describe('BinaryNotFoundError', () => {
  it('has correct name and message', () => {
    const err = new BinaryNotFoundError('/bad/path');
    expect(err.name).toBe('BinaryNotFoundError');
    expect(err.message).toContain('/bad/path');
  });
});

describe('BinaryNotExecutableError', () => {
  it('has correct name and message', () => {
    const err = new BinaryNotExecutableError('/bad/path');
    expect(err.name).toBe('BinaryNotExecutableError');
    expect(err.message).toContain('/bad/path');
  });
});
