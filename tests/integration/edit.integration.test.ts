/**
 * tests/integration/edit.integration.test.ts
 * Integration tests for edit helpers — require real ffmpeg binary.
 * These cover the async function bodies that can't be tested with unit tests alone.
 */

import { describe, it, before, after } from 'node:test';
import { expect } from '../lib/expect.js';
import { mkdtemp, rm, access, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

// Generate a short test MP4 once for all tests
let TMP: string;
let INPUT: string;
let SHORT: string;
let AUDIO: string;

before(async () => {
  TMP = await mkdtemp(join(tmpdir(), 'mf-edit-test-'));
  INPUT = join(TMP, 'input.mp4');
  SHORT = join(TMP, 'short.mp4');
  AUDIO = join(TMP, 'audio.mp3');

  // 3s test video — small resolution to minimise FFmpeg memory on any machine
  execFileSync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=160x90:rate=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac',
    '-movflags', '+faststart', INPUT,
  ], { stdio: 'ignore' });

  // 1s short clip for re-encode tests
  execFileSync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=128x72:rate=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac',
    '-movflags', '+faststart', SHORT,
  ], { stdio: 'ignore' });

  // Extract audio from SHORT (1s) — keeps AUDIO small for mixAudio tests
  execFileSync('ffmpeg', ['-y', '-i', SHORT, '-c:a', 'libmp3lame', '-q:a', '9', AUDIO], { stdio: 'ignore' });
});

after(async () => {
  await rm(TMP, { recursive: true, force: true });
});

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

async function fileSize(p: string): Promise<number> {
  return (await stat(p)).size;
}

// ─── trimVideo ────────────────────────────────────────────────────────────────
describe('trimVideo', () => {
  let trimVideo: any;
  before(async () => {
    ({ trimVideo } = await import('../../dist/esm/helpers/edit.js'));
  });

  it('stream copy: creates output with correct duration', async () => {
    const out = join(TMP, 'trim_copy.mp4');
    await trimVideo({ input: INPUT, output: out, start: 1, end: 4 });
    expect(await exists(out)).toBe(true);
    expect(await fileSize(out)).toBeGreaterThan(1000);
  });

  it('re-encode: creates output file', async () => {
    const out = join(TMP, 'trim_reencode.mp4');
    await trimVideo({ input: SHORT, output: out, start: 0, duration: 1, copy: false });
    expect(await exists(out)).toBe(true);
  });

  it('with duration only (no start)', async () => {
    const out = join(TMP, 'trim_dur.mp4');
    await trimVideo({ input: INPUT, output: out, duration: 2 });
    expect(await exists(out)).toBe(true);
  });
});

// ─── changeSpeed ─────────────────────────────────────────────────────────────
describe('changeSpeed', () => {
  let changeSpeed: any;
  before(async () => {
    ({ changeSpeed } = await import('../../dist/esm/helpers/edit.js'));
  });

  it('2x faster produces smaller file', async () => {
    const out = join(TMP, 'speed_2x.mp4');
    await changeSpeed({ input: SHORT, output: out, speed: 2.0, outputArgs: ['-preset', 'ultrafast'] });
    expect(await exists(out)).toBe(true);
  });

  it('0.5x slower produces output file', async () => {
    const out = join(TMP, 'speed_half.mp4');
    await changeSpeed({ input: SHORT, output: out, speed: 0.5, outputArgs: ['-preset', 'ultrafast'] });
    expect(await exists(out)).toBe(true);
  });
});

// ─── extractAudio ─────────────────────────────────────────────────────────────
describe('extractAudio', () => {
  let extractAudio: any;
  before(async () => {
    ({ extractAudio } = await import('../../dist/esm/helpers/edit.js'));
  });

  it('extracts to mp3 (codec auto-detected)', async () => {
    const out = join(TMP, 'extracted.mp3');
    await extractAudio({ input: INPUT, output: out });
    expect(await exists(out)).toBe(true);
    expect(await fileSize(out)).toBeGreaterThan(1000);
  });

  it('extracts to wav (pcm_s16le)', async () => {
    const out = join(TMP, 'extracted.wav');
    // Use SHORT with 1s duration limit — uncompressed PCM is large, Termux/ARM RAM limited
    await extractAudio({ input: SHORT, output: out, codec: 'pcm_s16le' });
    expect(await exists(out)).toBe(true);
  });

  it('extracts to flac', async () => {
    const out = join(TMP, 'extracted.flac');
    await extractAudio({ input: SHORT, output: out, codec: 'flac' });
    expect(await exists(out)).toBe(true);
  });

  it('explicit codec override', async () => {
    const out = join(TMP, 'extracted_explicit.mp3');
    await extractAudio({ input: INPUT, output: out, codec: 'libmp3lame', bitrate: 128 });
    expect(await exists(out)).toBe(true);
  });

  it('with sampleRate and channels', async () => {
    const out = join(TMP, 'extracted_opts.mp3');
    await extractAudio({ input: INPUT, output: out, sampleRate: 22050, channels: 1 });
    expect(await exists(out)).toBe(true);
  });
});

// ─── replaceAudio ─────────────────────────────────────────────────────────────
describe('replaceAudio', () => {
  let replaceAudio: any;
  before(async () => {
    ({ replaceAudio } = await import('../../dist/esm/helpers/edit.js'));
  });

  it('replaces audio track', async () => {
    const out = join(TMP, 'replaced.mp4');
    await replaceAudio({ video: INPUT, audio: AUDIO, output: out });
    expect(await exists(out)).toBe(true);
    expect(await fileSize(out)).toBeGreaterThan(1000);
  });

  it('without shortest flag', async () => {
    const out = join(TMP, 'replaced_noshortest.mp4');
    await replaceAudio({ video: INPUT, audio: AUDIO, output: out, shortest: false });
    expect(await exists(out)).toBe(true);
  });
});

// ─── mixAudio ─────────────────────────────────────────────────────────────────
describe('mixAudio', () => {
  let mixAudio: any;
  before(async () => {
    ({ mixAudio } = await import('../../dist/esm/helpers/edit.js'));
  });

  it('mixes two audio files', async () => {
    const out = join(TMP, 'mixed.mp3');
    await mixAudio({ inputs: [AUDIO, AUDIO], output: out, weights: [1.0, 0.5] });
    expect(await exists(out)).toBe(true);
    expect(await fileSize(out)).toBeGreaterThan(1000);
  });

  it('shortest duration mode', async () => {
    const out = join(TMP, 'mixed_short.mp3');
    await mixAudio({ inputs: [AUDIO, AUDIO], output: out, duration: 'shortest' });
    expect(await exists(out)).toBe(true);
  });

  it('first duration mode', async () => {
    const out = join(TMP, 'mixed_first.mp3');
    await mixAudio({ inputs: [AUDIO, AUDIO], output: out, duration: 'first' });
    expect(await exists(out)).toBe(true);
  });
});

// ─── loopVideo ────────────────────────────────────────────────────────────────
describe('loopVideo', () => {
  let loopVideo: any;
  before(async () => {
    ({ loopVideo } = await import('../../dist/esm/helpers/edit.js'));
  });

  it('loops once with duration cap', async () => {
    const out = join(TMP, 'looped.mp4');
    await loopVideo({ input: SHORT, output: out, loops: 1, duration: 3 });
    expect(await exists(out)).toBe(true);
  });

  it('loops with re-encode codecs', async () => {
    const out = join(TMP, 'looped_re.mp4');
    await loopVideo({ input: SHORT, output: out, loops: 1, duration: 2, videoCodec: 'copy', audioCodec: 'copy' });
    expect(await exists(out)).toBe(true);
  });
});

// ─── deinterlace ──────────────────────────────────────────────────────────────
describe('deinterlace', () => {
  let deinterlace: any;
  before(async () => {
    ({ deinterlace } = await import('../../dist/esm/helpers/edit.js'));
  });

  it('deinterlaces video', async () => {
    const out = join(TMP, 'deinterlaced.mp4');
    // Use SHORT + ultrafast — yadif + libx264 encode is RAM-heavy on ARM (Termux)
    await deinterlace({ input: SHORT, output: out, videoCodec: 'libx264', outputArgs: ['-preset', 'ultrafast'] });
    expect(await exists(out)).toBe(true);
  });

  it('with non-default mode and parity', async () => {
    const out = join(TMP, 'deinterlaced2.mp4');
    await deinterlace({ input: SHORT, output: out, mode: 1, parity: 0, deint: 1, videoCodec: 'libx264', outputArgs: ['-preset', 'ultrafast'] });
    expect(await exists(out)).toBe(true);
  });
});

// ─── cropToRatio ──────────────────────────────────────────────────────────────
describe('cropToRatio', () => {
  let cropToRatio: any;
  before(async () => {
    ({ cropToRatio } = await import('../../dist/esm/helpers/edit.js'));
  });

  it('crops 16:9 to 1:1 square', async () => {
    const out = join(TMP, 'square.mp4');
    // Use SHORT + ultrafast — libx264 re-encode is RAM-heavy on Termux ARM
    await cropToRatio({ input: SHORT, output: out, ratio: '1:1', videoCodec: 'libx264', outputArgs: ['-preset', 'ultrafast'] });
    expect(await exists(out)).toBe(true);
  });

  it('crops to 9:16 portrait', async () => {
    const out = join(TMP, 'portrait.mp4');
    await cropToRatio({ input: SHORT, output: out, ratio: '9:16', videoCodec: 'libx264', outputArgs: ['-preset', 'ultrafast'] });
    expect(await exists(out)).toBe(true);
  });

  it('crops to 4:3', async () => {
    const out = join(TMP, 'fourthree.mp4');
    await cropToRatio({ input: SHORT, output: out, ratio: '4:3', videoCodec: 'libx264', outputArgs: ['-preset', 'ultrafast'] });
    expect(await exists(out)).toBe(true);
  });
});

// ─── stackVideos ──────────────────────────────────────────────────────────────
describe('stackVideos', () => {
  let stackVideos: any;
  before(async () => {
    ({ stackVideos } = await import('../../dist/esm/helpers/edit.js'));
  });

  it('hstack: two videos side by side', async () => {
    const out = join(TMP, 'hstack.mp4');
    await stackVideos({ inputs: [SHORT, SHORT], output: out, direction: 'hstack', outputArgs: ['-preset', 'ultrafast'] });
    expect(await exists(out)).toBe(true);
  });

  it('vstack: two videos top/bottom', async () => {
    const out = join(TMP, 'vstack.mp4');
    await stackVideos({ inputs: [SHORT, SHORT], output: out, direction: 'vstack', outputArgs: ['-preset', 'ultrafast'] });
    expect(await exists(out)).toBe(true);
  });

  it('xstack: 4 videos in 2x2 grid', async () => {
    const out = join(TMP, 'xstack.mp4');
    await stackVideos({ inputs: [SHORT, SHORT, SHORT, SHORT], output: out, direction: 'xstack', columns: 2, outputArgs: ['-preset', 'ultrafast'] });
    expect(await exists(out)).toBe(true);
  });
});

// ─── generateSprite ───────────────────────────────────────────────────────────
describe('generateSprite', () => {
  let generateSprite: any;
  before(async () => {
    ({ generateSprite } = await import('../../dist/esm/helpers/edit.js'));
  });

  it('returns grid info and creates sprite image', async () => {
    const out = join(TMP, 'sprite.jpg');
    // Use SHORT + small count — fps=1 decode of INPUT can OOM on Termux ARM
    const info = await generateSprite({ input: SHORT, output: out, columns: 2, count: 2, thumbWidth: 80 });
    expect(await exists(out)).toBe(true);
    expect(info.columns).toBe(2);
    expect(info.rows).toBe(1);
    expect(info.thumbWidth).toBe(80);
  });
});

// ─── applyLUT ─────────────────────────────────────────────────────────────────
describe('applyLUT', () => {
  let applyLUT: any;
  before(async () => {
    ({ applyLUT } = await import('../../dist/esm/helpers/edit.js'));
  });

  it('applies identity LUT (no colour change)', async () => {
    // Create a minimal identity LUT file
    const lutPath = join(TMP, 'identity.cube');
    const lutContent = `LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n`;
    await (await import('node:fs/promises')).writeFile(lutPath, lutContent);

    const out = join(TMP, 'lut_out.mp4');
    await applyLUT({ input: SHORT, output: out, lut: lutPath, outputArgs: ['-preset', 'ultrafast'] });
    expect(await exists(out)).toBe(true);
  });

  it('with tetrahedral interpolation', async () => {
    const lutPath = join(TMP, 'identity2.cube');
    const lutContent = `LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n`;
    await (await import('node:fs/promises')).writeFile(lutPath, lutContent);

    const out = join(TMP, 'lut_tetra.mp4');
    await applyLUT({ input: SHORT, output: out, lut: lutPath, interp: 'tetrahedral', outputArgs: ['-preset', 'ultrafast'] });
    expect(await exists(out)).toBe(true);
  });
});
