import { describe, it } from 'node:test';
import { expect } from '../../lib/expect.js';
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
} from '../../../dist/esm/probe/ffprobe.js';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '../../fixtures/silence.mp3');

// The fixture is a ~1s mono 44.1kHz MP3 with no chapters and no language tag.
//
// Its exact reported duration is deliberately NOT hardcoded. An MP3's duration
// depends on the encoder's frame padding, so it reads as 1.000000 from the
// committed fixture but has previously reported 1.044898 — a mismatch that
// broke three of these tests and was masked by `continue-on-error` in two CI
// workflows. Asserting an exact float re-arms that trap the next time anyone
// re-encodes the fixture, so the tests below check against the value ffprobe
// actually reports for the file on disk.
const FIXTURE_DURATION_SEC = ((): number => {
  const reported = Number(probe(FIXTURE).format?.duration);
  if (!Number.isFinite(reported) || reported <= 0) {
    throw new Error(`fixture duration is not a positive number: ${reported}`);
  }
  return reported;
})();

/** The fixture is a 1-second clip; allow generous slack for frame padding. */
const DURATION_TOLERANCE = 0.25;

/** Assert that a probe result is the shape and content we expect. */
function expectUsableProbe(r: any) {
  expect(Array.isArray(r.streams)).toBe(true);
  expect(r.streams.length).toBe(1);
  expect(r.format).toBeTruthy();
  expect(r.format.format_name).toBe('mp3');
  expect(r.format.nb_streams).toBe(1);
  expect(Number(r.format.size)).toBeGreaterThan(0);
  return r;
}

// ─── probe() success path ─────────────────────────────────────────────────────
describe('probe() with real file', () => {
  it('returns ProbeResult with streams and format', () => {
    const r = expectUsableProbe(probe(FIXTURE));
    expect(r.streams[0].codec_type).toBe('audio');
    expect(r.streams[0].codec_name).toBe('mp3');
    expect(r.streams[0].index).toBe(0);
  });

  it('has at least one audio stream', () => {
    const r = probe(FIXTURE);
    expect(r.streams.length).toBe(1);
    expect(r.streams[0]?.codec_type).toBe('audio');
  });

  it('with timeout option still works', () => {
    const r = expectUsableProbe(probe(FIXTURE, { timeout: 10000 }));
    expect(r.streams[0].codec_name).toBe('mp3');
  });

  it('with chapters=false omits chapters entirely', () => {
    const r = probe(FIXTURE, { chapters: false });
    expect(r.chapters).toBeUndefined();
    expect(r.streams.length).toBe(1);
  });

  it('with chapters left at the default parses the empty chapter list', () => {
    // The fixture has no chapters, so the default path must still produce a
    // list — an absent one would break every caller that iterates it.
    expect(probe(FIXTURE).chapters).toEqual([]);
  });

  it('with extraArgs option still works', () => {
    const r = expectUsableProbe(probe(FIXTURE, { extraArgs: ['-v', 'quiet'] }));
    expect(r.streams[0].sample_rate).toBe('44100');
  });

  it('passes extraArgs through to ffprobe and still parses json', () => {
    // `-v quiet` suppresses ffprobe's banner; if it leaked into stdout the
    // JSON.parse in probe() would throw instead of returning a result.
    expect(() => probe(FIXTURE, { extraArgs: ['-v', 'quiet'] })).not.toThrow();
  });
});

// ─── probeAsync() success path ────────────────────────────────────────────────
describe('probeAsync() with real file', () => {
  it('resolves ProbeResult', async () => {
    const r = expectUsableProbe(await probeAsync(FIXTURE));
    expect(r.streams[0].codec_name).toBe('mp3');
  });

  it('resolves the same data as the sync probe', async () => {
    const [async_, sync] = [await probeAsync(FIXTURE), probe(FIXTURE)];
    expect(async_.format?.duration).toBe(sync.format?.duration);
    expect(async_.streams[0]?.codec_name).toBe(sync.streams[0]?.codec_name);
  });

  it('with timeout option resolves', async () => {
    expectUsableProbe(await probeAsync(FIXTURE, { timeout: 10000 }));
  });

  it('with chapters=false resolves', async () => {
    const r = await probeAsync(FIXTURE, { chapters: false });
    expect(r.chapters).toBeUndefined();
  });

  it('with extraArgs resolves', async () => {
    expectUsableProbe(await probeAsync(FIXTURE, { extraArgs: ['-v', 'quiet'] }));
  });
});

// ─── helper functions with real result ───────────────────────────────────────
describe('probe helpers with real data', () => {
  let result: any;

  it('getMediaDuration returns the container duration', () => {
    result = probe(FIXTURE);
    const dur = getMediaDuration(result);
    expect(typeof dur).toBe('number');
    expect(dur).toBeCloseTo(FIXTURE_DURATION_SEC, 4);
    // Guards the fixture itself: a ~1s clip that suddenly reports 0 or 40 would
    // make every duration expectation above vacuously true.
    expect(Math.abs((dur as number) - 1)).toBeLessThan(DURATION_TOLERANCE);
  });

  it('getMediaDuration falls back to the stream when the format omits it', () => {
    result = probe(FIXTURE);
    const noFormatDuration = {
      ...result,
      format: { ...result.format, duration: undefined },
    };
    expect(getMediaDuration(noFormatDuration)).toBeCloseTo(FIXTURE_DURATION_SEC, 4);
  });

  it('getAudioStreams returns one stream', () => {
    result = probe(FIXTURE);
    const streams = getAudioStreams(result);
    expect(streams.length).toBe(1);
    expect(streams[0].codec_name).toBe('mp3');
  });

  it('summarizeAudioStream maps every probed field', () => {
    result = probe(FIXTURE);
    const streams = getAudioStreams(result);
    const summary = summarizeAudioStream(streams[0]!);
    expect(summary).toStrictEqual({
      index: 0,
      codec: 'mp3',
      sampleRate: 44100,
      channels: 1,
      channelLayout: 'mono',
      durationSec: FIXTURE_DURATION_SEC,
      bitrateBps: 64000,
    });
  });

  it('getChapterList returns array', () => {
    result = probe(FIXTURE);
    expect(getChapterList(result)).toEqual([]);
  });

  it('isHdr returns false for audio-only file', () => {
    result = probe(FIXTURE);
    expect(isHdr(result)).toBe(false);
  });

  it('isInterlaced returns false for audio-only file', () => {
    result = probe(FIXTURE);
    expect(isInterlaced(result)).toBe(false);
  });

  it('getStreamLanguage returns null when the stream has no language tag', () => {
    result = probe(FIXTURE);
    expect(result.streams[0].tags?.language).toBeUndefined();
    expect(getStreamLanguage(result.streams[0]!)).toBeNull();
  });

  it('getStreamLanguage returns the tag when one is present', () => {
    const tagged = { tags: { language: 'fra' } };
    expect(getStreamLanguage(tagged as any)).toBe('fra');
  });

  it('findStreamByLanguage returns null for nonexistent lang', () => {
    result = probe(FIXTURE);
    expect(findStreamByLanguage(result, 'xyz')).toBe(null);
  });

  it('findStreamByLanguage finds a tagged stream case-insensitively', () => {
    const tagged = {
      streams: [
        { index: 0, codec_type: 'audio', tags: { language: 'eng' } },
        { index: 1, codec_type: 'audio', tags: { language: 'fra' } },
      ],
    };
    expect(findStreamByLanguage(tagged as any, 'FRA')?.index).toBe(1);
    expect(findStreamByLanguage(tagged as any, 'eng')?.index).toBe(0);
  });
});

// ─── parseFrameRate success paths ────────────────────────────────────────────
describe('parseFrameRate with valid inputs', () => {
  it('30/1 → value=30', () => {
    const r = parseFrameRate('30/1');
    expect(r).toStrictEqual({ num: 30, den: 1, value: 30 });
  });

  it('24000/1001 → ~23.976', () => {
    const r = parseFrameRate('24000/1001');
    expect(r!.num).toBe(24000);
    expect(r!.den).toBe(1001);
    expect(r!.value).toBeCloseTo(23.976, 2);
  });

  it('25/1 → value=25', () => {
    expect(parseFrameRate('25/1')).toStrictEqual({ num: 25, den: 1, value: 25 });
  });

  it('60/1 → value=60', () => {
    expect(parseFrameRate('60/1')).toStrictEqual({ num: 60, den: 1, value: 60 });
  });
});
