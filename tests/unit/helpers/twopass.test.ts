import { describe, it } from 'node:test';
import { expect } from '../../lib/expect.js';
import { buildTwoPassArgs } from '../../../dist/esm/helpers/twopass.js';

describe('buildTwoPassArgs', () => {
  const BASE = {
    input: 'input.mp4',
    output: 'output.mp4',
    videoCodec: 'libx264',
    videoBitrate: '2M',
  };

  it('pass 1 writes to a temp MKV with -f matroska', () => {
    const { pass1 } = buildTwoPassArgs(BASE);
    expect(pass1).toContain('-f');
    expect(pass1).toContain('matroska');
    expect(pass1[pass1.length - 1]).toMatch(/\.mkv$/);
  });

  it('pass 1 has -an to disable audio', () => {
    const { pass1 } = buildTwoPassArgs(BASE);
    expect(pass1).toContain('-an');
  });

  it('pass 1 sets -pass 1', () => {
    const { pass1 } = buildTwoPassArgs(BASE);
    const idx = pass1.indexOf('-pass');
    expect(idx).toBeGreaterThan(-1);
    expect(pass1[idx + 1]).toBe('1');
  });

  it('pass 2 sets -pass 2', () => {
    const { pass2 } = buildTwoPassArgs(BASE);
    const idx = pass2.indexOf('-pass');
    expect(idx).toBeGreaterThan(-1);
    expect(pass2[idx + 1]).toBe('2');
  });

  it('pass 2 writes to output file', () => {
    const { pass2 } = buildTwoPassArgs(BASE);
    expect(pass2[pass2.length - 1]).toBe('output.mp4');
  });

  it('both passes have video codec and bitrate', () => {
    const { pass1, pass2 } = buildTwoPassArgs(BASE);
    expect(pass1).toContain('libx264');
    expect(pass1).toContain('2M');
    expect(pass2).toContain('libx264');
    expect(pass2).toContain('2M');
  });

  it('pass 2 includes audio codec when specified', () => {
    const { pass2 } = buildTwoPassArgs({ ...BASE, audioCodec: 'aac', audioBitrate: '128k' });
    expect(pass2).toContain('-c:a');
    expect(pass2).toContain('aac');
    expect(pass2).toContain('-b:a');
    expect(pass2).toContain('128k');
  });

  it('pass 2 copies audio when audioCodec is not specified', () => {
    const { pass2 } = buildTwoPassArgs(BASE);
    const caIdx = pass2.indexOf('-c:a');
    expect(caIdx).toBeGreaterThan(-1);
    expect(pass2[caIdx + 1]).toBe('copy');
  });

  it('pass 2 has no audio when audioCodec is "none"', () => {
    const { pass2 } = buildTwoPassArgs({ ...BASE, audioCodec: 'none' });
    expect(pass2).not.toContain('-c:a');
    expect(pass2).not.toContain('copy');
  });

  it('uses custom passlogfile', () => {
    const { pass1, pass2, passlog } = buildTwoPassArgs({ ...BASE, passlogfile: '/tmp/mylog' });
    expect(passlog).toBe('/tmp/mylog');
    expect(pass1).toContain('/tmp/mylog');
    expect(pass2).toContain('/tmp/mylog');
  });

  it('sets -y (overwrite) by default', () => {
    const { pass2 } = buildTwoPassArgs(BASE);
    expect(pass2[0]).toBe('-y');
  });

  it('sets -n (no overwrite) when overwrite is false', () => {
    const { pass2 } = buildTwoPassArgs({ ...BASE, overwrite: false });
    expect(pass2[0]).toBe('-n');
  });

  it('includes extra output args in both passes', () => {
    const { pass1, pass2 } = buildTwoPassArgs({
      ...BASE,
      extraOutputArgs: ['-preset', 'slow'],
    });
    expect(pass1).toContain('-preset');
    expect(pass1).toContain('slow');
    expect(pass2).toContain('-preset');
    expect(pass2).toContain('slow');
  });

  it('includes extra input args in both passes', () => {
    const { pass1, pass2 } = buildTwoPassArgs({
      ...BASE,
      extraInputArgs: ['-hwaccel', 'cuda'],
    });
    expect(pass1).toContain('-hwaccel');
    expect(pass1).toContain('cuda');
    expect(pass2).toContain('-hwaccel');
    expect(pass2).toContain('cuda');
  });

  it('pass 2 includes -c:v libx265 for x265 two-pass', () => {
    const { pass1, pass2 } = buildTwoPassArgs({
      input: 'in.mp4', output: 'out.mp4',
      videoCodec: 'libx265', videoBitrate: '1M',
      audioCodec: 'aac', audioBitrate: '96k',
    });
    expect(pass1).toContain('libx265');
    expect(pass2).toContain('libx265');
    expect(pass2).toContain('aac');
  });

  it('both passes reference the input file', () => {
    const { pass1, pass2 } = buildTwoPassArgs(BASE);
    const p1Idx = pass1.indexOf('-i');
    const p2Idx = pass2.indexOf('-i');
    expect(pass1[p1Idx + 1]).toBe('input.mp4');
    expect(pass2[p2Idx + 1]).toBe('input.mp4');
  });
});
