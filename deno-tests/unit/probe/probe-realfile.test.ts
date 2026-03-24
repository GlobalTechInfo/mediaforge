import { describe, it } from 'node:test';
import { expect } from '../../lib/expect.ts';
import {
  probe,
  probeAsync,
  getMediaDuration,
  getAudioStreams,
  summarizeAudioStream,
  parseFrameRate,
  isHdr,
  isInterlaced,
  getChapterList,
  findStreamByLanguage,
  getStreamLanguage,
} from '../../../lib/probe/ffprobe.ts';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '../../fixtures/silence.mp3');

// ─── probe() success path ─────────────────────────────────────────────────────
describe('probe() with real file', () => {
  it('returns ProbeResult with streams and format', () => {
    const r = probe(FIXTURE);
    expect(r.streams).toBeTruthy();
    expect(r.format).toBeTruthy();
  });

  it('has at least one audio stream', () => {
    const r = probe(FIXTURE);
    expect(r.streams.length).toBeGreaterThan(0);
    expect(r.streams[0]?.codec_type).toBe('audio');
  });

  it('with timeout option still works', () => {
    const r = probe(FIXTURE, { timeout: 10000 });
    expect(r.format).toBeTruthy();
  });

  it('with chapters=false option still works', () => {
    const r = probe(FIXTURE, { chapters: false });
    expect(r.format).toBeTruthy();
  });

  it('with extraArgs option still works', () => {
    const r = probe(FIXTURE, { extraArgs: ['-v', 'quiet'] });
    expect(r.format).toBeTruthy();
  });
});

// ─── probeAsync() success path ────────────────────────────────────────────────
describe('probeAsync() with real file', () => {
  it('resolves ProbeResult', async () => {
    const r = await probeAsync(FIXTURE);
    expect(r.streams).toBeTruthy();
    expect(r.format).toBeTruthy();
  });

  it('with timeout option resolves', async () => {
    const r = await probeAsync(FIXTURE, { timeout: 10000 });
    expect(r.format).toBeTruthy();
  });

  it('with chapters=false resolves', async () => {
    const r = await probeAsync(FIXTURE, { chapters: false });
    expect(r.format).toBeTruthy();
  });

  it('with extraArgs resolves', async () => {
    const r = await probeAsync(FIXTURE, { extraArgs: ['-v', 'quiet'] });
    expect(r.format).toBeTruthy();
  });
});

// ─── helper functions with real result ───────────────────────────────────────
describe('probe helpers with real data', () => {
  let result: any;

  it('getMediaDuration returns positive number', () => {
    result = probe(FIXTURE);
    const dur = getMediaDuration(result);
    expect(dur).toBeGreaterThan(0);
  });

  it('getAudioStreams returns one stream', () => {
    result = probe(FIXTURE);
    const streams = getAudioStreams(result);
    expect(streams.length).toBe(1);
  });

  it('summarizeAudioStream returns summary with codec', () => {
    result = probe(FIXTURE);
    const streams = getAudioStreams(result);
    const summary = summarizeAudioStream(streams[0]!);
    expect(summary).toBeTruthy();
    expect(typeof summary!.codec).toBe('string');
  });

  it('getChapterList returns array', () => {
    result = probe(FIXTURE);
    expect(Array.isArray(getChapterList(result))).toBe(true);
  });

  it('isHdr returns false for audio-only file', () => {
    result = probe(FIXTURE);
    expect(isHdr(result)).toBe(false);
  });

  it('isInterlaced returns false for audio-only file', () => {
    result = probe(FIXTURE);
    expect(isInterlaced(result)).toBe(false);
  });

  it('getStreamLanguage returns string or null', () => {
    result = probe(FIXTURE);
    const lang = getStreamLanguage(result.streams[0]!);
    expect(lang === null || typeof lang === 'string').toBe(true);
  });

  it('findStreamByLanguage returns null for nonexistent lang', () => {
    result = probe(FIXTURE);
    expect(findStreamByLanguage(result, 'xyz')).toBe(null);
  });
});

// ─── parseFrameRate success paths ────────────────────────────────────────────
describe('parseFrameRate with valid inputs', () => {
  it('30/1 → value=30', () => {
    const r = parseFrameRate('30/1');
    expect(r).toBeTruthy();
    expect(r!.value).toBe(30);
    expect(r!.num).toBe(30);
    expect(r!.den).toBe(1);
  });

  it('24000/1001 → ~23.976', () => {
    const r = parseFrameRate('24000/1001');
    expect(r).toBeTruthy();
    expect(Math.abs(r!.value - 23.976) < 0.01).toBe(true);
  });

  it('25/1 → value=25', () => {
    const r = parseFrameRate('25/1');
    expect(r!.value).toBe(25);
  });

  it('60/1 → value=60', () => {
    const r = parseFrameRate('60/1');
    expect(r!.value).toBe(60);
  });
});
