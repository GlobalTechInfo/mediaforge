import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

const { getPreset, listPresets, applyPreset } = await import('../../lib/helpers/presets.ts');
let lib = await import('../../lib/index.ts');

const { buildConcatList } = await import('../../lib/helpers/concat.ts');
const { autoKillOnExit, renice } = await import('../../lib/helpers/process.ts');
const { pipeThrough, streamOutput, streamToFile } = await import('../../lib/helpers/streams.ts');
const _streamToFile = streamToFile;

// ─── Presets ────────────────────────────────────────────────────────────────
describe('presets', () => {
  it('web has libx264 and aac', () => {
    const p = getPreset('web');
    assert.ok(p.videoArgs.includes('libx264'), `expected ${p.videoArgs} to include ${'libx264'}; got ${p.videoArgs}`);
    assert.ok(p.audioArgs.includes('aac'), `expected ${p.audioArgs} to include ${'aac'}; got ${p.audioArgs}`);
  });

  it('web has faststart', () => {
    const p = getPreset('web');
    const all = [...p.videoArgs, ...p.extraArgs];
    assert.ok(all.some(a => a.includes('faststart')), `assertion failed: ${all.some(a => a.includes('faststart'))}`);
  });

  it('mobile has baseline profile', () => {
    const p = getPreset('mobile');
    assert.ok(p.videoArgs.includes('baseline'), `expected ${p.videoArgs} to include ${'baseline'}; got ${p.videoArgs}`);
  });

  it('archive crf 0 and flac', () => {
    const p = getPreset('archive');
    assert.ok(p.videoArgs.includes('0'), `expected ${p.videoArgs} to include ${'0'}; got ${p.videoArgs}`);
    assert.ok(p.audioArgs.includes('flac'), `expected ${p.audioArgs} to include ${'flac'}; got ${p.audioArgs}`);
  });

  it('podcast has -vn', () => {
    assert.ok(getPreset('podcast').videoArgs.includes('-vn'), `expected ${getPreset('podcast').videoArgs} to include ${'-vn'}; got ${getPreset('podcast').videoArgs}`);
  });

  it('prores uses prores_ks', () => {
    assert.ok(getPreset('prores').videoArgs.includes('prores_ks'), `expected ${getPreset('prores').videoArgs} to include ${'prores_ks'}; got ${getPreset('prores').videoArgs}`);
  });

  it('dnxhd uses dnxhd codec', () => {
    assert.ok(getPreset('dnxhd').videoArgs.includes('dnxhd'), `expected ${getPreset('dnxhd').videoArgs} to include ${'dnxhd'}; got ${getPreset('dnxhd').videoArgs}`);
  });

  it('hls-input has keyint_min', () => {
    assert.ok(applyPreset('hls-input').includes('-keyint_min'), `expected ${applyPreset('hls-input')} to include ${'-keyint_min'}; got ${applyPreset('hls-input')}`);
  });

  it('gif preset has -an', () => {
    assert.ok(applyPreset('gif').includes('-an'), `expected ${applyPreset('gif')} to include ${'-an'}; got ${applyPreset('gif')}`);
  });

  it('discord has faststart', () => {
    const p = getPreset('discord');
    assert.ok([...p.videoArgs, ...p.extraArgs].some(a => a.includes('faststart')), `assertion failed: ${[...p.videoArgs, ...p.extraArgs].some(a => a.includes('faststart'))}`);
  });

  it('instagram has crf', () => {
    assert.ok(getPreset('instagram').videoArgs.includes('-crf'), `expected ${getPreset('instagram').videoArgs} to include ${'-crf'}; got ${getPreset('instagram').videoArgs}`);
  });

  it('throws on unknown preset', () => {
    assert.throws(() => getPreset('invalid' as any), /Unknown preset/);
  });

  it('listPresets includes all 11 names', () => {
    const list = listPresets();
    for (const n of ['web','web-hq','mobile','archive','podcast','hls-input','gif','discord','instagram','prores','dnxhd']) {
      assert.ok((list as string[]).includes(n), `missing ${n}`);
    }
  });

  it('applyPreset returns flat string[]', () => {
    const args = applyPreset('web');
    assert.ok(Array.isArray(args), `assertion failed: ${Array.isArray(args)}`);
    assert.ok(args.every((a: any) => typeof a === 'string'), `assertion failed: ${args.every((a: any) => typeof a === 'string')}`);
  });

  it('getPreset returns copy not reference (no mutation)', () => {
    const p1 = getPreset('web');
    const p2 = getPreset('web');
    p1.videoArgs.push('MUTATION');
    assert.ok(!p2.videoArgs.includes('MUTATION'), `expected ${!p2.videoArgs} to include ${'MUTATION'}; got ${!p2.videoArgs}`);
  });

  it('all presets have valid structure', () => {
    for (const name of listPresets()) {
      const p = getPreset(name);
      assert.ok(Array.isArray(p.videoArgs), `assertion failed: ${Array.isArray(p.videoArgs)}`);
      assert.ok(Array.isArray(p.audioArgs), `assertion failed: ${Array.isArray(p.audioArgs)}`);
      assert.ok(Array.isArray(p.extraArgs), `assertion failed: ${Array.isArray(p.extraArgs)}`);
    }
  });
});

// ─── Concat helpers ──────────────────────────────────────────────────────────
describe('concat helpers', () => {

  it('formats two paths with file prefix', () => {
    const r = buildConcatList(['/tmp/a.mp4', '/tmp/b.mp4']);
    assert.ok(r.includes("file '"), `expected ${r} to include ${"file '"}; got ${r}`);
    assert.ok(r.includes('a.mp4'), `expected ${r} to include ${'a.mp4'}; got ${r}`);
    assert.ok(r.includes('b.mp4'), `expected ${r} to include ${'b.mp4'}; got ${r}`);
  });

  it('empty array returns empty string', () => {
    assert.strictEqual(buildConcatList([]), '');
  });

  it('uses absolute paths', async () => {
    const { resolve } = await import('node:path');
    const r = buildConcatList(['relative.mp4']);
    assert.ok(r.includes(resolve('relative.mp4')), `expected ${r} to include ${resolve('relative.mp4')}; got ${r}`);
  });

  it('each file on its own line', () => {
    const r = buildConcatList(['/a.mp4', '/b.mp4', '/c.mp4']);
    assert.strictEqual(r.split('\n').length, 3);
  });
});

// ─── Process helpers ─────────────────────────────────────────────────────────
describe('process helpers', () => {

  it('autoKillOnExit returns unregister function', () => {
    const child = { pid: 99999, kill: () => {}, once: () => {} } as any;
    const unreg = autoKillOnExit(child);
    assert.strictEqual(typeof unreg, 'function');
    unreg();
  });

  it('calling unregister twice does not throw', () => {
    const child = { pid: 99999, kill: () => {}, once: () => {} } as any;
    const unreg = autoKillOnExit(child);
    unreg();
    assert.doesNotThrow(() => unreg());
  });

  it('renice throws if pid is undefined', () => {
    assert.throws(() => renice({ pid: undefined } as any, 10), /no PID/);
  });
});

// ─── Stream helpers ──────────────────────────────────────────────────────────
describe('stream helpers', () => {

  it('pipeThrough returns emitter, stdout, kill', async () => {
    const proc = pipeThrough({ inputFormat: 'mp4', outputFormat: 'null', outputArgs: ['-f','null'] });
    assert.notStrictEqual(proc.emitter, undefined);
    assert.notStrictEqual(proc.stdout, undefined);
    assert.strictEqual(typeof proc.kill, 'function');
    await new Promise<void>(res => {
      proc.emitter.on('end', res);
      proc.emitter.on('error', () => res());
      proc.kill('SIGTERM');
    });
  });

  it('pipeThrough stdin is writable when no inputStream', async () => {
    const proc = pipeThrough({ outputFormat: 'null' });
    assert.notStrictEqual(proc.stdin, null);
    await new Promise<void>(res => {
      proc.emitter.on('end', res);
      proc.emitter.on('error', () => res());
      proc.kill('SIGTERM');
    });
  });

  it('streamOutput returns Readable', () => {
    const s = streamOutput({ input: 'nonexistent.mp4', outputFormat: 'null' });
    assert.ok(s instanceof Readable, `assertion failed: ${s instanceof Readable}`);
    s.destroy();
  });

  it('streamOutput with seek returns Readable', () => {
    const s = streamOutput({ input: 'nonexistent.mp4', outputFormat: 'null', seekInput: 10 });
    assert.ok(s instanceof Readable, `assertion failed: ${s instanceof Readable}`);
    s.destroy();
  });
});

// ─── Watermark helpers ───────────────────────────────────────────────────────
describe('watermark helpers', () => {
  it('addWatermark and addTextWatermark are functions', async () => {
    const { addWatermark, addTextWatermark } = await import('../../lib/helpers/watermark.ts');
    assert.strictEqual(typeof addWatermark, 'function');
    assert.strictEqual(typeof addTextWatermark, 'function');
  });
});

// ─── Normalize helpers ───────────────────────────────────────────────────────
describe('normalize helpers', () => {
  it('normalizeAudio and adjustVolume are functions', async () => {
    const { normalizeAudio, adjustVolume } = await import('../../lib/helpers/normalize.ts');
    assert.strictEqual(typeof normalizeAudio, 'function');
    assert.strictEqual(typeof adjustVolume, 'function');
  });
});

// ─── GIF helpers ─────────────────────────────────────────────────────────────
describe('gif helpers', () => {
  it('toGif and gifToMp4 are functions', async () => {
    const { toGif, gifToMp4 } = await import('../../lib/helpers/gif.ts');
    assert.strictEqual(typeof toGif, 'function');
    assert.strictEqual(typeof gifToMp4, 'function');
  });
});

// ─── Waveform helpers ────────────────────────────────────────────────────────
describe('waveform helpers', () => {
  it('generateWaveform and generateSpectrum are functions', async () => {
    const { generateWaveform, generateSpectrum } = await import('../../lib/helpers/waveform.ts');
    assert.strictEqual(typeof generateWaveform, 'function');
    assert.strictEqual(typeof generateSpectrum, 'function');
  });
});

// ─── Subtitle helpers ────────────────────────────────────────────────────────
describe('subtitle helpers', () => {
  it('burnSubtitles and extractSubtitles are functions', async () => {
    const { burnSubtitles, extractSubtitles } = await import('../../lib/helpers/subtitles.ts');
    assert.strictEqual(typeof burnSubtitles, 'function');
    assert.strictEqual(typeof extractSubtitles, 'function');
  });
});

// ─── Metadata helpers ────────────────────────────────────────────────────────
describe('metadata helpers', () => {
  it('writeMetadata and stripMetadata are functions', async () => {
    const { writeMetadata, stripMetadata } = await import('../../lib/helpers/metadata.ts');
    assert.strictEqual(typeof writeMetadata, 'function');
    assert.strictEqual(typeof stripMetadata, 'function');
  });
});

// ─── Screenshot helpers ──────────────────────────────────────────────────────
describe('screenshot helpers', () => {
  it('screenshots and frameToBuffer are functions', async () => {
    const { screenshots, frameToBuffer } = await import('../../lib/helpers/screenshots.ts');
    assert.strictEqual(typeof screenshots, 'function');
    assert.strictEqual(typeof frameToBuffer, 'function');
  });
});

// ─── Full index exports ──────────────────────────────────────────────────────
describe('index exports - new features', () => {
  const NEW_EXPORTS = [
    'screenshots', 'frameToBuffer',
    'mergeToFile', 'concatFiles', 'buildConcatList',
    'pipeThrough', 'streamOutput', 'streamToFile',
    'getPreset', 'listPresets', 'applyPreset',
    'toGif', 'gifToMp4',
    'normalizeAudio', 'adjustVolume',
    'addWatermark', 'addTextWatermark',
    'burnSubtitles', 'extractSubtitles',
    'writeMetadata', 'stripMetadata',
    'generateWaveform', 'generateSpectrum',
    'renice', 'autoKillOnExit', 'killAllFFmpeg',
  ];

  for (const name of NEW_EXPORTS) {
    it(`exports "${name}"`, async () => {
      assert.ok((lib as any)[name] !== undefined, `Missing export: ${name}`);
    });
  }
});
