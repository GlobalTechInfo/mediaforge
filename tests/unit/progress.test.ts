import { describe, it } from 'node:test';
import { expect } from '../lib/expect.js';
import { ProgressParser, parseAllProgress } from '../../dist/esm/process/progress.js';

const PROGRESS_BLOCK = `frame=120
fps=60.0
bitrate=2048.0kbits/s
total_size=3145728
out_time_us=4000000
out_time=00:00:04.000000
dup_frames=0
drop_frames=2
speed=2.50x
progress=continue`;

const FINAL_BLOCK = `frame=600
fps=59.9
bitrate=2100.0kbits/s
total_size=15728640
out_time_us=20000000
out_time=00:00:20.000000
dup_frames=0
drop_frames=5
speed=2.48x
progress=end`;

describe('ProgressParser', () => {
  it('emits a ProgressInfo when a continue block is complete', () => {
    const calls: unknown[] = [];
    const parser = new ProgressParser((info) => calls.push(info));
    for (const line of PROGRESS_BLOCK.split('\n')) parser.push(line);
    expect(calls).toHaveLength(1);
    const info = calls[0] as Record<string, unknown>;
    expect(info['frame']).toBe(120);
    expect(info['fps']).toBe(60.0);
    expect(info['speed']).toBe(2.5);
    expect(info['progress']).toBe('continue');
    expect(info['dropFrames']).toBe(2);
  });

  it('emits progress=end for the final block', () => {
    const calls: unknown[] = [];
    const parser = new ProgressParser((info) => calls.push(info));
    for (const line of FINAL_BLOCK.split('\n')) parser.push(line);
    const info = calls[0] as Record<string, unknown>;
    expect(info['progress']).toBe('end');
    expect(info['frame']).toBe(600);
  });

  it('calculates percent when totalDurationUs is provided', () => {
    const calls: unknown[] = [];
    // 4s out of 20s = 20%
    const parser = new ProgressParser((info) => calls.push(info), 20_000_000);
    for (const line of PROGRESS_BLOCK.split('\n')) parser.push(line);
    const info = calls[0] as Record<string, unknown>;
    expect(info['percent'] as number).toBeCloseTo(20, 1);
  });

  it('caps percent at 100', () => {
    const calls: unknown[] = [];
    const parser = new ProgressParser((info) => calls.push(info), 1_000_000);
    for (const line of PROGRESS_BLOCK.split('\n')) parser.push(line);
    const info = calls[0] as Record<string, unknown>;
    expect(info['percent']).toBe(100);
  });

  it('does not emit for lines without =', () => {
    const calls: unknown[] = [];
    const parser = new ProgressParser((info) => calls.push(info));
    parser.push('some random stderr line');
    expect(calls).toHaveLength(0);
  });

  it('ignores lines without a matching key block', () => {
    const calls: unknown[] = [];
    const parser = new ProgressParser((info) => calls.push(info));
    parser.push('');
    expect(calls).toHaveLength(0);
  });

  it('handles N/A speed gracefully', () => {
    const calls: unknown[] = [];
    const parser = new ProgressParser((info) => calls.push(info));
    const block = PROGRESS_BLOCK.replace('speed=2.50x', 'speed=N/A');
    for (const line of block.split('\n')) parser.push(line);
    const info = calls[0] as Record<string, unknown>;
    expect(info['speed']).toBe(0);
  });

  it('resets block after each complete emit', () => {
    const calls: unknown[] = [];
    const parser = new ProgressParser((info) => calls.push(info));
    for (const line of PROGRESS_BLOCK.split('\n')) parser.push(line);
    for (const line of FINAL_BLOCK.split('\n')) parser.push(line);
    expect(calls).toHaveLength(2);
    expect((calls[0] as Record<string, unknown>)['progress']).toBe('continue');
    expect((calls[1] as Record<string, unknown>)['progress']).toBe('end');
  });
});

describe('parseAllProgress', () => {
  it('returns all progress blocks from a multi-block dump', () => {
    const dump = [PROGRESS_BLOCK, FINAL_BLOCK].join('\n');
    const results = parseAllProgress(dump);
    expect(results).toHaveLength(2);
    expect(results[0]?.progress).toBe('continue');
    expect(results[1]?.progress).toBe('end');
  });

  it('returns empty array for output with no progress blocks', () => {
    expect(parseAllProgress('stderr noise\nmore noise')).toEqual([]);
  });

  it('passes totalDurationUs through for percent calculation', () => {
    const results = parseAllProgress(PROGRESS_BLOCK, 20_000_000);
    expect(results[0]?.percent).toBeCloseTo(20, 1);
  });
});

describe('ProgressParser — size/speed edge cases', () => {
  it('handles N/A total_size gracefully', () => {
    const calls: unknown[] = [];
    const parser = new ProgressParser((info) => calls.push(info));
    const block = PROGRESS_BLOCK.replace('total_size=3145728', 'total_size=N/A');
    for (const line of block.split('\n')) parser.push(line);
    expect(calls).toHaveLength(1);
    expect((calls[0] as Record<string, unknown>)['totalSize']).toBe(0);
  });

  it('handles empty total_size gracefully', () => {
    const calls: unknown[] = [];
    const parser = new ProgressParser((info) => calls.push(info));
    const block = PROGRESS_BLOCK.replace('total_size=3145728', 'total_size=');
    for (const line of block.split('\n')) parser.push(line);
    expect(calls).toHaveLength(1);
    expect((calls[0] as Record<string, unknown>)['totalSize']).toBe(0);
  });

  it('handles speed empty string gracefully', () => {
    const calls: unknown[] = [];
    const parser = new ProgressParser((info) => calls.push(info));
    const block = PROGRESS_BLOCK.replace('speed=2.50x', 'speed=');
    for (const line of block.split('\n')) parser.push(line);
    expect(calls).toHaveLength(1);
    expect((calls[0] as Record<string, unknown>)['speed']).toBe(0);
  });
});
