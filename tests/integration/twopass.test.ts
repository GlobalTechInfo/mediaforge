import { describe, it, before, after } from 'node:test';
import { expect } from '../lib/expect.js';
import { twoPassEncode, buildTwoPassArgs } from '../../dist/esm/helpers/twopass.js';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

describe('buildTwoPassArgs (pure — no ffmpeg)', () => {
  const BASE = { input: 'in.mp4', output: 'out.mp4', videoCodec: 'libx264', videoBitrate: '1M' };

  it('returns { pass1, pass2, passlog }', () => {
    const r = buildTwoPassArgs(BASE);
    expect(Array.isArray(r.pass1)).toBe(true);
    expect(Array.isArray(r.pass2)).toBe(true);
    expect(typeof r.passlog).toBe('string');
  });

  it('pass1 targets a temp MKV file', () => {
    const { pass1 } = buildTwoPassArgs(BASE);
    expect(pass1[pass1.length - 1]).toMatch(/\.mkv$/);
  });

  it('pass1 has -an', () => {
    expect(buildTwoPassArgs(BASE).pass1).toContain('-an');
  });

  it('pass2 writes to output', () => {
    const { pass2 } = buildTwoPassArgs(BASE);
    expect(pass2[pass2.length - 1]).toBe('out.mp4');
  });

  it('both passes have -passlogfile', () => {
    const { pass1, pass2, passlog } = buildTwoPassArgs(BASE);
    expect(pass1).toContain('-passlogfile');
    expect(pass1).toContain(passlog);
    expect(pass2).toContain('-passlogfile');
    expect(pass2).toContain(passlog);
  });

  it('custom passlogfile used', () => {
    const { passlog } = buildTwoPassArgs({ ...BASE, passlogfile: '/tmp/mylog' });
    expect(passlog).toBe('/tmp/mylog');
  });

  it('onPass1Complete and onPass2Complete are optional', () => {
    const r = buildTwoPassArgs({
      ...BASE,
      onPass1Complete: () => {},
      onPass2Complete: () => {},
    });
    expect(Array.isArray(r.pass1)).toBe(true);
  });
});

describe('twoPassEncode (integration — requires ffmpeg)', () => {
  let srcDir: string;
  let INPUT_FILE: string;

  before(async () => {
    srcDir = await mkdtemp(join(tmpdir(), 'ffmpeg-ts-twopass-src-'));
    INPUT_FILE = join(srcDir, 'input.mp4');
    execFileSync('ffmpeg', [
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-f', 'lavfi', '-i', 'color=black:size=64x64:rate=25:duration=2',
      '-map', '0:a', '-map', '1:v', '-t', '2', '-y', INPUT_FILE,
    ], { stdio: 'pipe' });
  });

  after(async () => {
    await rm(srcDir, { recursive: true, force: true });
  });

  it('encodes a file with two-pass x264', { timeout: 30000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ffmpeg-ts-twopass-'));
    const output = join(dir, 'out.mp4');
    let pass1Done = false;
    let pass2Done = false;

    try {
      await twoPassEncode({
        input: INPUT_FILE,
        output,
        videoCodec: 'libx264',
        videoBitrate: '500k',
        audioCodec: 'aac',
        audioBitrate: '64k',
        onPass1Complete: () => { pass1Done = true; },
        onPass2Complete: () => { pass2Done = true; },
      });

      await access(output);
      expect(pass1Done).toBe(true);
      expect(pass2Done).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('cleans up pass log files after successful encode', { timeout: 30000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ffmpeg-ts-twopass-'));
    const output = join(dir, 'out.mp4');
    const passlogfile = join(dir, 'passlog');

    try {
      await twoPassEncode({
        input: INPUT_FILE,
        output,
        videoCodec: 'libx264',
        videoBitrate: '500k',
        passlogfile,
      });

      let logExists = false;
      try { await access(`${passlogfile}-0.log`); logExists = true; } catch {}
      expect(logExists).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('twoPassEncode with audioCodec=none disables audio in both passes', { timeout: 30000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ffmpeg-ts-twopass-'));
    const output = join(dir, 'out.mp4');
    try {
      await twoPassEncode({
        input: INPUT_FILE,
        output,
        videoCodec: 'libx264',
        videoBitrate: '500k',
        audioCodec: 'none',
      });
      await access(output);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
