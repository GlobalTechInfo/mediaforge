import { describe, it } from 'node:test';
import { expect } from '../../lib/expect.ts';
import {
  parseFrameRate,
  parseDuration,
  parseBitrate,
  formatDuration,
  durationToMicroseconds,
  getVideoStreams,
  getAudioStreams,
  getSubtitleStreams,
  getDefaultVideoStream,
  getDefaultAudioStream,
  getMediaDuration,
  getStreamLanguage,
  findStreamByLanguage,
  summarizeVideoStream,
  summarizeAudioStream,
  isHdr,
  isInterlaced,
  getChapterList,
  ProbeError,
} from '../../../lib/probe/ffprobe.ts';
import type { ProbeResult, ProbeStream } from '../../../lib/types/probe.ts';

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const VIDEO_STREAM: ProbeStream = {
  index: 0,
  codec_type: 'video',
  codec_name: 'h264',
  profile: 'High',
  width: 1920,
  height: 1080,
  avg_frame_rate: '30000/1001',
  r_frame_rate: '60000/1001',
  pix_fmt: 'yuv420p',
  duration: '120.042000',
  bit_rate: '4000000',
  color_space: 'bt709',
  color_transfer: 'bt709',
  color_primaries: 'bt709',
  field_order: 'progressive',
  tags: { language: 'und' },
};

const AUDIO_STREAM_ENG: ProbeStream = {
  index: 1,
  codec_type: 'audio',
  codec_name: 'aac',
  channels: 2,
  channel_layout: 'stereo',
  sample_rate: '48000',
  duration: '120.042000',
  bit_rate: '128000',
  tags: { language: 'eng' },
};

const AUDIO_STREAM_SPA: ProbeStream = {
  index: 2,
  codec_type: 'audio',
  codec_name: 'eac3',
  channels: 6,
  channel_layout: '5.1',
  sample_rate: '48000',
  bit_rate: '640000',
  tags: { language: 'spa' },
};

const SUB_STREAM: ProbeStream = {
  index: 3,
  codec_type: 'subtitle',
  codec_name: 'subrip',
  tags: { language: 'fra' },
};

const MOCK_RESULT: ProbeResult = {
  streams: [VIDEO_STREAM, AUDIO_STREAM_ENG, AUDIO_STREAM_SPA, SUB_STREAM],
  format: {
    duration: '120.042000',
    bit_rate: '4800000',
    format_name: 'matroska,webm',
    size: '72000000',
  },
  chapters: [
    { id: 0, start_time: '0.000000', end_time: '30.000000', tags: { title: 'Intro' } },
    { id: 1, start_time: '30.000000', end_time: '90.000000', tags: { title: 'Main' } },
    { id: 2, start_time: '90.000000', end_time: '120.042000', tags: { title: 'Outro' } },
  ],
};

// ─── parseFrameRate ────────────────────────────────────────────────────────────

describe('parseFrameRate', () => {
  it('parses 30fps fraction correctly', () => {
    const r = parseFrameRate('30000/1001');
    expect(r).not.toBeNull();
    expect(r!.num).toBe(30000);
    expect(r!.den).toBe(1001);
    expect(r!.value).toBeCloseTo(29.97, 2);
  });

  it('parses 25fps integer fraction', () => {
    const r = parseFrameRate('25/1');
    expect(r!.value).toBe(25);
  });

  it('parses 24000/1001 (23.976 fps)', () => {
    const r = parseFrameRate('24000/1001');
    expect(r!.value).toBeCloseTo(23.976, 3);
  });

  it('returns null for 0/0', () => {
    expect(parseFrameRate('0/0')).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseFrameRate(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseFrameRate('')).toBeNull();
  });

  it('returns null for malformed string', () => {
    expect(parseFrameRate('notarate')).toBeNull();
  });

  it('returns null if denominator is 0', () => {
    expect(parseFrameRate('30/0')).toBeNull();
  });
});

// ─── parseDuration ────────────────────────────────────────────────────────────

describe('parseDuration', () => {
  it('parses a floating point string', () => {
    expect(parseDuration('120.042000')).toBeCloseTo(120.042, 4);
  });

  it('parses zero correctly', () => {
    expect(parseDuration('0')).toBe(0);
  });

  it('returns null for N/A', () => {
    expect(parseDuration('N/A')).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseDuration(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseDuration('')).toBeNull();
  });

  it('returns null for non-numeric string', () => {
    expect(parseDuration('notanumber')).toBeNull();
  });
});

// ─── parseBitrate ─────────────────────────────────────────────────────────────

describe('parseBitrate', () => {
  it('parses an integer string', () => {
    expect(parseBitrate('4000000')).toBe(4000000);
  });

  it('parses 128kbps', () => {
    expect(parseBitrate('128000')).toBe(128000);
  });

  it('returns null for N/A', () => {
    expect(parseBitrate('N/A')).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseBitrate(undefined)).toBeNull();
  });
});

// ─── formatDuration ───────────────────────────────────────────────────────────

describe('formatDuration', () => {
  it('formats 0 seconds', () => {
    expect(formatDuration(0)).toBe('00:00:00.000');
  });

  it('formats 1 hour', () => {
    expect(formatDuration(3600)).toBe('01:00:00.000');
  });

  it('formats 90 minutes and 30.5 seconds', () => {
    expect(formatDuration(90 * 60 + 30.5)).toBe('01:30:30.500');
  });

  it('formats large values', () => {
    expect(formatDuration(7199.999)).toBe('01:59:59.999');
  });

  it('pads single-digit minutes and seconds', () => {
    expect(formatDuration(61)).toBe('00:01:01.000');
  });
});

// ─── durationToMicroseconds ───────────────────────────────────────────────────

describe('durationToMicroseconds', () => {
  it('converts 1 second to 1M microseconds', () => {
    expect(durationToMicroseconds(1)).toBe(1_000_000);
  });

  it('converts fractional seconds correctly', () => {
    expect(durationToMicroseconds(1.5)).toBe(1_500_000);
  });

  it('handles 0', () => {
    expect(durationToMicroseconds(0)).toBe(0);
  });

  it('rounds correctly', () => {
    expect(durationToMicroseconds(0.001)).toBe(1000);
  });
});

// ─── Stream selectors ─────────────────────────────────────────────────────────

describe('getVideoStreams', () => {
  it('returns only video streams', () => {
    const streams = getVideoStreams(MOCK_RESULT);
    expect(streams).toHaveLength(1);
    expect(streams[0]?.codec_name).toBe('h264');
  });

  it('returns empty array when no video streams', () => {
    expect(getVideoStreams({ streams: [AUDIO_STREAM_ENG] })).toHaveLength(0);
  });
});

describe('getAudioStreams', () => {
  it('returns all audio streams', () => {
    expect(getAudioStreams(MOCK_RESULT)).toHaveLength(2);
  });

  it('returns only audio type streams', () => {
    const streams = getAudioStreams(MOCK_RESULT);
    expect(streams.every((s) => s.codec_type === 'audio')).toBe(true);
  });
});

describe('getSubtitleStreams', () => {
  it('returns subtitle streams', () => {
    const streams = getSubtitleStreams(MOCK_RESULT);
    expect(streams).toHaveLength(1);
    expect(streams[0]?.codec_name).toBe('subrip');
  });
});

describe('getDefaultVideoStream', () => {
  it('returns first video stream', () => {
    expect(getDefaultVideoStream(MOCK_RESULT)?.codec_name).toBe('h264');
  });

  it('returns null when no video', () => {
    expect(getDefaultVideoStream({ streams: [] })).toBeNull();
  });
});

describe('getDefaultAudioStream', () => {
  it('returns first audio stream', () => {
    expect(getDefaultAudioStream(MOCK_RESULT)?.codec_name).toBe('aac');
  });
});

describe('getMediaDuration', () => {
  it('prefers format duration', () => {
    expect(getMediaDuration(MOCK_RESULT)).toBeCloseTo(120.042, 3);
  });

  it('falls back to stream duration when format is absent', () => {
    const result: ProbeResult = { streams: [VIDEO_STREAM] };
    expect(getMediaDuration(result)).toBeCloseTo(120.042, 3);
  });

  it('returns null when no duration anywhere', () => {
    expect(getMediaDuration({ streams: [] })).toBeNull();
  });
});

// ─── Language helpers ─────────────────────────────────────────────────────────

describe('getStreamLanguage', () => {
  it('returns language tag', () => {
    expect(getStreamLanguage(AUDIO_STREAM_ENG)).toBe('eng');
  });

  it('returns null when no tags', () => {
    expect(getStreamLanguage({ index: 0 })).toBeNull();
  });

  it('returns null when tags has no language key', () => {
    expect(getStreamLanguage({ index: 0, tags: { title: 'Test' } })).toBeNull();
  });
});

describe('findStreamByLanguage', () => {
  it('finds an audio stream by language', () => {
    const s = findStreamByLanguage(MOCK_RESULT, 'spa', 'audio');
    expect(s?.codec_name).toBe('eac3');
  });

  it('finds a subtitle stream by language', () => {
    const s = findStreamByLanguage(MOCK_RESULT, 'fra', 'subtitle');
    expect(s?.codec_name).toBe('subrip');
  });

  it('is case-insensitive', () => {
    expect(findStreamByLanguage(MOCK_RESULT, 'ENG', 'audio')).not.toBeNull();
  });

  it('returns null when language not found', () => {
    expect(findStreamByLanguage(MOCK_RESULT, 'deu')).toBeNull();
  });

  it('filters by codec type', () => {
    expect(findStreamByLanguage(MOCK_RESULT, 'eng', 'video')).toBeNull();
  });
});

// ─── summarize helpers ────────────────────────────────────────────────────────

describe('summarizeVideoStream', () => {
  it('extracts all video fields', () => {
    const s = summarizeVideoStream(VIDEO_STREAM);
    expect(s.codec).toBe('h264');
    expect(s.width).toBe(1920);
    expect(s.height).toBe(1080);
    expect(s.fps).toBeCloseTo(29.97, 2);
    expect(s.pixFmt).toBe('yuv420p');
    expect(s.durationSec).toBeCloseTo(120.042, 3);
    expect(s.bitrateBps).toBe(4000000);
    expect(s.profile).toBe('High');
    expect(s.colorSpace).toBe('bt709');
  });

  it('handles missing optional fields gracefully', () => {
    const minimal: ProbeStream = { index: 0, codec_type: 'video' };
    const s = summarizeVideoStream(minimal);
    expect(s.codec).toBe('unknown');
    expect(s.width).toBe(0);
    expect(s.fps).toBe(0);
    expect(s.durationSec).toBeNull();
    expect(s.bitrateBps).toBeNull();
    expect(s.profile).toBeUndefined();
  });
});

describe('summarizeAudioStream', () => {
  it('extracts all audio fields', () => {
    const s = summarizeAudioStream(AUDIO_STREAM_ENG);
    expect(s.codec).toBe('aac');
    expect(s.sampleRate).toBe(48000);
    expect(s.channels).toBe(2);
    expect(s.channelLayout).toBe('stereo');
    expect(s.durationSec).toBeCloseTo(120.042, 3);
    expect(s.bitrateBps).toBe(128000);
  });

  it('extracts surround sound fields', () => {
    const s = summarizeAudioStream(AUDIO_STREAM_SPA);
    expect(s.channels).toBe(6);
    expect(s.channelLayout).toBe('5.1');
    expect(s.bitrateBps).toBe(640000);
  });
});

// ─── isHdr / isInterlaced ─────────────────────────────────────────────────────

describe('isHdr', () => {
  it('returns false for SDR content (bt709)', () => {
    expect(isHdr(MOCK_RESULT)).toBe(false);
  });

  it('returns true for BT.2020 primaries', () => {
    const r: ProbeResult = {
      streams: [{ index: 0, codec_type: 'video', color_primaries: 'bt2020', color_transfer: 'bt709' }],
    };
    expect(isHdr(r)).toBe(true);
  });

  it('returns true for PQ (smpte2084) transfer', () => {
    const r: ProbeResult = {
      streams: [{ index: 0, codec_type: 'video', color_primaries: 'bt709', color_transfer: 'smpte2084' }],
    };
    expect(isHdr(r)).toBe(true);
  });

  it('returns true for HLG (arib-std-b67)', () => {
    const r: ProbeResult = {
      streams: [{ index: 0, codec_type: 'video', color_transfer: 'arib-std-b67' }],
    };
    expect(isHdr(r)).toBe(true);
  });

  it('returns false with no video stream', () => {
    expect(isHdr({ streams: [] })).toBe(false);
  });
});

describe('isInterlaced', () => {
  it('returns false for progressive content', () => {
    expect(isInterlaced(MOCK_RESULT)).toBe(false);
  });

  it('returns true for TT (top-top) field order', () => {
    const r: ProbeResult = {
      streams: [{ index: 0, codec_type: 'video', field_order: 'tt' }],
    };
    expect(isInterlaced(r)).toBe(true);
  });

  it('returns true for BT (bottom-top) field order', () => {
    const r: ProbeResult = {
      streams: [{ index: 0, codec_type: 'video', field_order: 'bt' }],
    };
    expect(isInterlaced(r)).toBe(true);
  });

  it('returns false with no video stream', () => {
    expect(isInterlaced({ streams: [] })).toBe(false);
  });
});

// ─── chapters ─────────────────────────────────────────────────────────────────

describe('getChapterList', () => {
  it('returns chapter titles and times', () => {
    const chapters = getChapterList(MOCK_RESULT);
    expect(chapters).toHaveLength(3);
    expect(chapters[0]?.title).toBe('Intro');
    expect(chapters[0]?.startSec).toBe(0);
    expect(chapters[0]?.endSec).toBe(30);
    expect(chapters[1]?.title).toBe('Main');
    expect(chapters[2]?.title).toBe('Outro');
    expect(chapters[2]?.endSec).toBeCloseTo(120.042, 3);
  });

  it('uses chapter ID as fallback title', () => {
    const r: ProbeResult = {
      streams: [],
      chapters: [{ id: 5, start_time: '0', end_time: '60' }],
    };
    expect(getChapterList(r)[0]?.title).toBe('Chapter 5');
  });

  it('returns empty array when no chapters', () => {
    expect(getChapterList({ streams: [] })).toHaveLength(0);
  });
});

// ─── ProbeError ───────────────────────────────────────────────────────────────

describe('ProbeError', () => {
  it('has correct name and message', () => {
    const e = new ProbeError('file.mp4', 'No such file');
    expect(e.name).toBe('ProbeError');
    expect(e.filePath).toBe('file.mp4');
    expect(e.detail).toBe('No such file');
    expect(e.message).toContain('file.mp4');
    expect(e.message).toContain('No such file');
  });

  it('is an instance of Error', () => {
    expect(new ProbeError('x', 'y')).toBeInstanceOf(Error);
  });
});