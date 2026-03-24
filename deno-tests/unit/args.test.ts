import { describe, it } from 'node:test';
import { expect } from '../lib/expect.ts';
import {
  flattenArgs,
  toDuration,
  toBitrate,
  buildGlobalArgs,
  buildInputArgs,
  buildOutputArgs,
} from '../../lib/utils/args.ts';

describe('flattenArgs', () => {
  it('flattens flag-only entries', () => {
    expect(flattenArgs([{ flag: '-y' }, { flag: '-n' }])).toEqual(['-y', '-n']);
  });

  it('flattens flag+value entries', () => {
    expect(flattenArgs([{ flag: '-c:v', value: 'libx264' }])).toEqual(['-c:v', 'libx264']);
  });

  it('handles empty array', () => {
    expect(flattenArgs([])).toEqual([]);
  });

  it('mixes flags with and without values', () => {
    expect(
      flattenArgs([{ flag: '-y' }, { flag: '-c:v', value: 'copy' }, { flag: '-n' }]),
    ).toEqual(['-y', '-c:v', 'copy', '-n']);
  });
});

describe('toDuration', () => {
  it('converts numbers to strings', () => {
    expect(toDuration(30)).toBe('30');
    expect(toDuration(1.5)).toBe('1.5');
  });

  it('passes strings through unchanged', () => {
    expect(toDuration('00:01:30')).toBe('00:01:30');
    expect(toDuration('30.5')).toBe('30.5');
  });
});

describe('toBitrate', () => {
  it('converts numbers to strings', () => {
    expect(toBitrate(2_000_000)).toBe('2000000');
  });

  it('passes bitrate strings through', () => {
    expect(toBitrate('2M')).toBe('2M');
    expect(toBitrate('128k')).toBe('128k');
  });
});

describe('buildGlobalArgs', () => {
  it('adds -y for overwrite', () => {
    expect(buildGlobalArgs({ overwrite: true })).toContain('-y');
  });

  it('adds -n for noOverwrite', () => {
    expect(buildGlobalArgs({ noOverwrite: true })).toContain('-n');
  });

  it('adds -loglevel', () => {
    const args = buildGlobalArgs({ logLevel: 'quiet' });
    expect(args).toContain('-loglevel');
    expect(args).toContain('quiet');
  });

  it('adds -progress pipe:2', () => {
    const args = buildGlobalArgs({ progress: true });
    expect(args).toContain('-progress');
    expect(args).toContain('pipe:2');
  });

  it('adds -stats_period', () => {
    const args = buildGlobalArgs({ statsInterval: 2 });
    expect(args).toContain('-stats_period');
    expect(args).toContain('2');
  });

  it('appends extraArgs', () => {
    const args = buildGlobalArgs({ extraArgs: ['-threads', '4'] });
    expect(args).toContain('-threads');
    expect(args).toContain('4');
  });

  it('returns empty array for empty options', () => {
    expect(buildGlobalArgs({})).toEqual([]);
  });
});

describe('buildInputArgs', () => {
  it('adds -ss for seekInput', () => {
    const args = buildInputArgs({ seekInput: '00:01:00' });
    expect(args).toContain('-ss');
    expect(args).toContain('00:01:00');
  });

  it('adds -t for duration', () => {
    const args = buildInputArgs({ duration: 30 });
    expect(args).toContain('-t');
    expect(args).toContain('30');
  });

  it('adds -to', () => {
    const args = buildInputArgs({ to: '00:02:00' });
    expect(args).toContain('-to');
  });

  it('adds -f for format', () => {
    expect(buildInputArgs({ format: 'rawvideo' })).toContain('-f');
  });

  it('adds -r for frameRate', () => {
    expect(buildInputArgs({ frameRate: 25 })).toContain('-r');
  });

  it('adds -loop', () => {
    const args = buildInputArgs({ loop: 0 });
    expect(args).toContain('-loop');
    expect(args).toContain('0');
  });
});

describe('buildOutputArgs', () => {
  it('adds -map for each map entry', () => {
    const args = buildOutputArgs({ map: ['0:v:0', '0:a:1'] });
    const mapIndices = args.reduce<number[]>((acc: number[], a: string, i: number) => (a === '-map' ? [...acc, i] : acc), []);
    expect(mapIndices).toHaveLength(2);
  });

  it('adds -f for format', () => {
    const args = buildOutputArgs({ format: 'mp4' });
    expect(args).toContain('-f');
    expect(args).toContain('mp4');
  });

  it('appends extraArgs', () => {
    const args = buildOutputArgs({ extraArgs: ['-movflags', '+faststart'] });
    expect(args).toContain('-movflags');
  });

  it('returns empty array for empty options', () => {
    expect(buildOutputArgs({})).toEqual([]);
  });
});
