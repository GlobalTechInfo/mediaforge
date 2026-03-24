import { describe, it } from 'node:test';
import { expect } from '../lib/expect.ts';
import {
  probe, probeAsync, ProbeError,
  getDefaultVideoStream, getDefaultAudioStream,
  getMediaDuration, isHdr, isInterlaced,
} from '../../lib/probe/ffprobe.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

// ─── Module-level setup (top-level await replaces before()) ───────────────────
const testDir = await mkdtemp(join(tmpdir(), 'ffmpeg-ts-probe-'));
const TEST_FILE = join(testDir, 'test.mp4');
execFileSync('ffmpeg', [
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
  '-f', 'lavfi', '-i', 'color=black:size=64x64:rate=1:duration=1',
  '-map', '0:a', '-map', '1:v', '-t', '1', '-y', TEST_FILE,
], { stdio: 'pipe' });

describe('probe() (sync)', () => {
  it('returns a ProbeResult with streams and format', () => {
    const info = probe(TEST_FILE);
    expect(Array.isArray(info.streams)).toBe(true);
    expect(info.streams.length).toBeGreaterThan(0);
  });

  it('has a video stream', () => {
    const info = probe(TEST_FILE);
    const vs = getDefaultVideoStream(info);
    expect(vs).not.toBeNull();
    expect(vs?.codec_type).toBe('video');
  });

  it('has an audio stream', () => {
    const info = probe(TEST_FILE);
    const as = getDefaultAudioStream(info);
    expect(as).not.toBeNull();
    expect(as?.codec_type).toBe('audio');
  });

  it('getMediaDuration returns a number', () => {
    const info = probe(TEST_FILE);
    const dur = getMediaDuration(info);
    expect(dur).not.toBeNull();
    expect(dur!).toBeGreaterThan(0);
  });

  it('isHdr returns false for standard test file', () => {
    const info = probe(TEST_FILE);
    expect(isHdr(info)).toBe(false);
  });

  it('isInterlaced returns false for standard test file', () => {
    const info = probe(TEST_FILE);
    expect(isInterlaced(info)).toBe(false);
  });

  it('throws ProbeError for non-existent file', () => {
    expect(() => probe('/no/such/file.mp4')).toThrow(ProbeError);
  });

  it('ProbeError has correct name and detail', () => {
    try {
      probe('/no/such/file.mp4');
    } catch (e) {
      expect(e).toBeInstanceOf(ProbeError);
      expect((e as ProbeError).name).toBe('ProbeError');
      expect(typeof (e as ProbeError).detail).toBe('string');
      expect((e as ProbeError).filePath).toBe('/no/such/file.mp4');
    }
  });
});

describe('probeAsync() (async)', () => {
  it('resolves with a ProbeResult', async () => {
    const info = await probeAsync(TEST_FILE);
    expect(Array.isArray(info.streams)).toBe(true);
    expect(info.streams.length).toBeGreaterThan(0);
  });

  it('rejects with ProbeError for non-existent file', async () => {
    let threw = false;
    try {
      await probeAsync('/no/such/file.mp4');
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(ProbeError);
    }
    expect(threw).toBe(true);
  });

  it('probe and probeAsync return same stream count', async () => {
    const sync = probe(TEST_FILE);
    const async_ = await probeAsync(TEST_FILE);
    expect(async_.streams.length).toBe(sync.streams.length);
  });
});

// ─── Teardown: clean up after all tests via process exit ─────────────────────
process.on('exit', () => { import('node:fs').then(fs => fs.rmSync(testDir, { recursive: true, force: true })).catch(() => {}); });
