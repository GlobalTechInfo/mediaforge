import { describe, it } from 'node:test';
import { expect } from '../../lib/expect.js';
import {
  serializeSpecifier, ss,
  mapStream, mapAll, mapAllVideo, mapAllAudio, mapAllSubtitles,
  mapVideo, mapAudio, mapSubtitle, mapLabel, negateMap,
  setStreamMetadata, setMetadata, setDisposition,
  streamCodec, copyStream,
  remuxAll, mapDefaultStreams, mapAVS, copyAudioAndSubs,
} from '../../../dist/esm/helpers/mapping.js';

describe('serializeSpecifier', () => {
  it('serializes file index only', () => {
    expect(serializeSpecifier(ss(0))).toBe('0');
    expect(serializeSpecifier(ss(1))).toBe('1');
  });

  it('serializes file + type', () => {
    expect(serializeSpecifier(ss(0, 'v'))).toBe('0:v');
    expect(serializeSpecifier(ss(0, 'a'))).toBe('0:a');
    expect(serializeSpecifier(ss(0, 's'))).toBe('0:s');
  });

  it('serializes file + type + stream index', () => {
    expect(serializeSpecifier(ss(0, 'v', 0))).toBe('0:v:0');
    expect(serializeSpecifier(ss(1, 'a', 2))).toBe('1:a:2');
  });

  it('prepends - for negate', () => {
    expect(serializeSpecifier(ss(0, 'v', 0, true))).toBe('-0:v:0');
    expect(serializeSpecifier(ss(0, 'a', undefined, true))).toBe('-0:a');
  });
});

describe('mapStream', () => {
  it('accepts a StreamSpecifier', () => {
    expect(mapStream(ss(0, 'v', 0))).toEqual(['-map', '0:v:0']);
  });

  it('accepts a raw string', () => {
    expect(mapStream('0:a:1')).toEqual(['-map', '0:a:1']);
  });

  it('accepts a label string', () => {
    expect(mapStream('[vout]')).toEqual(['-map', '[vout]']);
  });
});

describe('mapAll / mapAllVideo / mapAllAudio / mapAllSubtitles', () => {
  it('mapAll maps entire input', () => {
    expect(mapAll(0)).toEqual(['-map', '0']);
    expect(mapAll(1)).toEqual(['-map', '1']);
  });

  it('mapAllVideo maps all video', () => {
    expect(mapAllVideo(0)).toEqual(['-map', '0:v']);
  });

  it('mapAllAudio maps all audio', () => {
    expect(mapAllAudio(0)).toEqual(['-map', '0:a']);
  });

  it('mapAllSubtitles maps all subtitles', () => {
    expect(mapAllSubtitles(0)).toEqual(['-map', '0:s']);
  });
});

describe('mapVideo / mapAudio / mapSubtitle', () => {
  it('mapVideo defaults to stream index 0', () => {
    expect(mapVideo(0)).toEqual(['-map', '0:v:0']);
  });

  it('mapVideo with explicit stream index', () => {
    expect(mapVideo(0, 1)).toEqual(['-map', '0:v:1']);
  });

  it('mapAudio defaults to stream index 0', () => {
    expect(mapAudio(0)).toEqual(['-map', '0:a:0']);
  });

  it('mapAudio from second input, third audio stream', () => {
    expect(mapAudio(1, 2)).toEqual(['-map', '1:a:2']);
  });

  it('mapSubtitle', () => {
    expect(mapSubtitle(0, 1)).toEqual(['-map', '0:s:1']);
  });
});

describe('mapLabel', () => {
  it('wraps bare label in brackets', () => {
    expect(mapLabel('vout')).toEqual(['-map', '[vout]']);
  });

  it('passes through already-bracketed label', () => {
    expect(mapLabel('[audio]')).toEqual(['-map', '[audio]']);
  });
});

describe('negateMap', () => {
  it('negates a StreamSpecifier', () => {
    expect(negateMap(ss(0, 'a', 2))).toEqual(['-map', '-0:a:2']);
  });

  it('negates a raw string', () => {
    expect(negateMap('0:a:2')).toEqual(['-map', '-0:a:2']);
  });

  it('does not double-negate an already-negative string', () => {
    expect(negateMap('-0:a:2')).toEqual(['-map', '-0:a:2']);
  });
});

describe('setMetadata', () => {
  it('creates metadata flag and value', () => {
    expect(setMetadata('title', 'My Movie')).toEqual(['-metadata', 'title=My Movie']);
  });

  it('handles special characters', () => {
    expect(setMetadata('comment', 'Made with ffmpeg-ts')).toEqual(['-metadata', 'comment=Made with ffmpeg-ts']);
  });
});

describe('setStreamMetadata', () => {
  it('creates per-stream metadata flag', () => {
    expect(setStreamMetadata(0, 'a', 0, 'language', 'eng')).toEqual(['-metadata:s:a:0', 'language=eng']);
  });

  it('works for subtitle streams', () => {
    expect(setStreamMetadata(0, 's', 0, 'language', 'fra')).toEqual(['-metadata:s:s:0', 'language=fra']);
  });
});

describe('setDisposition', () => {
  it('sets single flag', () => {
    expect(setDisposition(0, 'a', 0, ['default'])).toEqual(['-disposition:a:0', 'default']);
  });

  it('joins multiple flags with +', () => {
    expect(setDisposition(0, 'a', 0, ['default', 'hearing_impaired'])).toEqual([
      '-disposition:a:0',
      'default+hearing_impaired',
    ]);
  });
});

describe('streamCodec', () => {
  it('creates per-stream codec flag', () => {
    expect(streamCodec('v', 0, 'libx264')).toEqual(['-c:v:0', 'libx264']);
    expect(streamCodec('a', 1, 'aac')).toEqual(['-c:a:1', 'aac']);
  });
});

describe('copyStream', () => {
  it('creates copy codec flag for video', () => {
    expect(copyStream('v', 0)).toEqual(['-c:v:0', 'copy']);
  });

  it('creates copy codec flag for audio', () => {
    expect(copyStream('a', 2)).toEqual(['-c:a:2', 'copy']);
  });
});

describe('remuxAll', () => {
  it('maps all streams and sets copy codec', () => {
    expect(remuxAll()).toEqual(['-map', '0', '-c', 'copy']);
  });
});

describe('mapDefaultStreams', () => {
  it('maps first video and audio from input 0', () => {
    expect(mapDefaultStreams()).toEqual(['-map', '0:v:0', '-map', '0:a:0']);
  });

  it('maps from specified file index', () => {
    expect(mapDefaultStreams(1)).toEqual(['-map', '1:v:0', '-map', '1:a:0']);
  });
});

describe('mapAVS', () => {
  it('maps video, audio, and optional subtitles', () => {
    const args = mapAVS(0);
    expect(args).toContain('-map');
    expect(args).toContain('0:v');
    expect(args).toContain('0:a');
    expect(args).toContain('0:s?');
  });
});

describe('copyAudioAndSubs', () => {
  it('generates copy args for audio streams', () => {
    const args = copyAudioAndSubs(2, 0);
    expect(args).toContain('-c:a:0');
    expect(args).toContain('-c:a:1');
    expect(args).toContain('copy');
    expect(args).toHaveLength(4);
  });

  it('generates copy args for audio and subtitle streams', () => {
    const args = copyAudioAndSubs(1, 2);
    expect(args).toContain('-c:a:0');
    expect(args).toContain('-c:s:0');
    expect(args).toContain('-c:s:1');
  });

  it('returns empty array when no streams', () => {
    expect(copyAudioAndSubs(0, 0)).toHaveLength(0);
  });
});
