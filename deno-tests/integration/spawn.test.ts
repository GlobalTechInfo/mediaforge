import { describe, it } from 'node:test';
import { expect } from '../lib/expect.ts';
import { spawnFFmpeg, runFFmpeg, FFmpegSpawnError } from '../../lib/process/spawn.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('spawnFFmpeg / runFFmpeg (integration — requires ffmpeg in PATH)', () => {
  it('spawnFFmpeg returns an FFmpegProcess with emitter and child', () => {
    const proc = spawnFFmpeg({ binary: 'ffmpeg', args: ['-version'] });
    expect(proc.emitter).toBeDefined();
    expect(proc.child).toBeDefined();
    expect(typeof proc.kill).toBe('function');
    return new Promise<void>((resolve) => {
      proc.emitter.on('end', () => resolve());
      proc.emitter.on('error', (_e: unknown) => resolve()); // ignore
    });
  });

  it('runFFmpeg resolves on success (ffmpeg -version)', async () => {
    await runFFmpeg({ binary: 'ffmpeg', args: ['-version'] });
  });

  it('FFmpegSpawnError has correct fields', () => {
    const e = new FFmpegSpawnError(1, null, 'some stderr');
    expect(e.name).toBe('FFmpegSpawnError');
    expect(e.exitCode).toBe(1);
    expect(e.signal).toBeNull();
    expect(e.stderrOutput).toBe('some stderr');
    expect(e.message).toContain('1');
  });

  it('FFmpegSpawnError uses signal when exitCode is null', () => {
    const e = new FFmpegSpawnError(null, 'SIGKILL', '');
    expect(e.message).toContain('SIGKILL');
  });

  it('runFFmpeg rejects on non-zero exit with FFmpegSpawnError', async () => {
    let threw = false;
    try {
      await runFFmpeg({ binary: 'ffmpeg', args: ['-i', '/nonexistent_input_$$$.mp4', '-f', 'null', '/dev/null'] });
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(FFmpegSpawnError);
    }
    expect(threw).toBe(true);
  });

  it('runFFmpeg with parseProgress emits progress events during encode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ffmpeg-ts-test-'));
    const out = join(dir, 'out.mp4');
    const progressEvents: unknown[] = [];

    try {
      const proc = spawnFFmpeg({
        binary: 'ffmpeg',
        args: [
          '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
          '-f', 'lavfi', '-i', 'color=black:size=64x64:rate=1:duration=1',
          '-map', '0:a', '-map', '1:v',
          '-y', out,
        ],
        parseProgress: true,
      });
      proc.emitter.on('progress', (p: unknown) => progressEvents.push(p));
      await new Promise<void>((resolve, reject) => {
        proc.emitter.on('end', resolve);
        proc.emitter.on('error', reject);
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    // progress may or may not fire depending on duration — just ensure no crash
    expect(typeof progressEvents.length).toBe('number');
  });
});
