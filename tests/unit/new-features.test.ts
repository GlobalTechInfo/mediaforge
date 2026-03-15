import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'stream';

// ─── Presets ────────────────────────────────────────────────────────────────
describe('presets', () => {
  let getPreset: any, listPresets: any, applyPreset: any;

  before(async () => {
    const m = await import('../../dist/esm/helpers/presets.js');
    getPreset = m.getPreset; listPresets = m.listPresets; applyPreset = m.applyPreset;
  });

  it('web has libx264 and aac', () => {
    const p = getPreset('web');
    assert.ok(p.videoArgs.includes('libx264'));
    assert.ok(p.audioArgs.includes('aac'));
  });

  it('web has faststart', () => {
    const p = getPreset('web');
    const all = [...p.videoArgs, ...p.extraArgs];
    assert.ok(all.some(a => a.includes('faststart')));
  });

  it('mobile has baseline profile', () => {
    const p = getPreset('mobile');
    assert.ok(p.videoArgs.includes('baseline'));
  });

  it('archive crf 0 and flac', () => {
    const p = getPreset('archive');
    assert.ok(p.videoArgs.includes('0'));
    assert.ok(p.audioArgs.includes('flac'));
  });

  it('podcast has -vn', () => {
    assert.ok(getPreset('podcast').videoArgs.includes('-vn'));
  });

  it('prores uses prores_ks', () => {
    assert.ok(getPreset('prores').videoArgs.includes('prores_ks'));
  });

  it('dnxhd uses dnxhd codec', () => {
    assert.ok(getPreset('dnxhd').videoArgs.includes('dnxhd'));
  });

  it('hls-input has keyint_min', () => {
    assert.ok(applyPreset('hls-input').includes('-keyint_min'));
  });

  it('gif preset has -an', () => {
    assert.ok(applyPreset('gif').includes('-an'));
  });

  it('discord has faststart', () => {
    const p = getPreset('discord');
    assert.ok([...p.videoArgs, ...p.extraArgs].some(a => a.includes('faststart')));
  });

  it('instagram has crf', () => {
    assert.ok(getPreset('instagram').videoArgs.includes('-crf'));
  });

  it('throws on unknown preset', () => {
    assert.throws(() => getPreset('invalid'), /Unknown preset/);
  });

  it('listPresets includes all 11 names', () => {
    const list = listPresets();
    for (const n of ['web','web-hq','mobile','archive','podcast','hls-input','gif','discord','instagram','prores','dnxhd']) {
      assert.ok(list.includes(n), `missing ${n}`);
    }
  });

  it('applyPreset returns flat string[]', () => {
    const args = applyPreset('web');
    assert.ok(Array.isArray(args));
    assert.ok(args.every((a: any) => typeof a === 'string'));
  });

  it('getPreset returns copy not reference (no mutation)', () => {
    const p1 = getPreset('web');
    const p2 = getPreset('web');
    p1.videoArgs.push('MUTATION');
    assert.ok(!p2.videoArgs.includes('MUTATION'));
  });

  it('all presets have valid structure', () => {
    for (const name of listPresets()) {
      const p = getPreset(name);
      assert.ok(Array.isArray(p.videoArgs));
      assert.ok(Array.isArray(p.audioArgs));
      assert.ok(Array.isArray(p.extraArgs));
    }
  });
});

// ─── Concat helpers ──────────────────────────────────────────────────────────
describe('concat helpers', () => {
  let buildConcatList: any;
  before(async () => {
    const m = await import('../../dist/esm/helpers/concat.js');
    buildConcatList = m.buildConcatList;
  });

  it('formats two paths with file prefix', () => {
    const r = buildConcatList(['/tmp/a.mp4', '/tmp/b.mp4']);
    assert.ok(r.includes("file '"));
    assert.ok(r.includes('a.mp4'));
    assert.ok(r.includes('b.mp4'));
  });

  it('empty array returns empty string', () => {
    assert.strictEqual(buildConcatList([]), '');
  });

  it('uses absolute paths', async () => {
    const { resolve } = await import('path');
    const r = buildConcatList(['relative.mp4']);
    assert.ok(r.includes(resolve('relative.mp4')));
  });

  it('each file on its own line', () => {
    const r = buildConcatList(['/a.mp4', '/b.mp4', '/c.mp4']);
    assert.strictEqual(r.split('\n').length, 3);
  });
});

// ─── Process helpers ─────────────────────────────────────────────────────────
describe('process helpers', () => {
  let autoKillOnExit: any, renice: any;
  before(async () => {
    const m = await import('../../dist/esm/helpers/process.js');
    autoKillOnExit = m.autoKillOnExit; renice = m.renice;
  });

  it('autoKillOnExit returns unregister function', () => {
    const child = { pid: 99999, kill: () => {} } as any;
    const unreg = autoKillOnExit(child);
    assert.ok(typeof unreg === 'function');
    unreg();
  });

  it('calling unregister twice does not throw', () => {
    const child = { pid: 99999, kill: () => {} } as any;
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
  let pipeThrough: any, streamOutput: any, _streamToFile: any;
  before(async () => {
    const m = await import('../../dist/esm/helpers/streams.js');
    pipeThrough = m.pipeThrough; streamOutput = m.streamOutput; _streamToFile = m.streamToFile;
  });

  it('pipeThrough returns emitter, stdout, kill', async () => {
    const proc = pipeThrough({ inputFormat: 'mp4', outputFormat: 'null', outputArgs: ['-f','null'] });
    assert.ok(proc.emitter !== undefined);
    assert.ok(proc.stdout !== undefined);
    assert.ok(typeof proc.kill === 'function');
    await new Promise<void>(res => {
      proc.emitter.on('end', res);
      proc.emitter.on('error', res);
      proc.kill('SIGTERM');
    });
  });

  it('pipeThrough stdin is writable when no inputStream', async () => {
    const proc = pipeThrough({ outputFormat: 'null' });
    assert.ok(proc.stdin !== null);
    await new Promise<void>(res => {
      proc.emitter.on('end', res);
      proc.emitter.on('error', res);
      proc.kill('SIGTERM');
    });
  });

  it('streamOutput returns Readable', () => {
    const s = streamOutput({ input: 'nonexistent.mp4', outputFormat: 'null' });
    assert.ok(s instanceof Readable);
    s.destroy();
  });

  it('streamOutput with seek returns Readable', () => {
    const s = streamOutput({ input: 'nonexistent.mp4', outputFormat: 'null', seekInput: 10 });
    assert.ok(s instanceof Readable);
    s.destroy();
  });
});

// ─── Watermark helpers ───────────────────────────────────────────────────────
describe('watermark helpers', () => {
  it('addWatermark and addTextWatermark are functions', async () => {
    const { addWatermark, addTextWatermark } = await import('../../dist/esm/helpers/watermark.js');
    assert.ok(typeof addWatermark === 'function');
    assert.ok(typeof addTextWatermark === 'function');
  });
});

// ─── Normalize helpers ───────────────────────────────────────────────────────
describe('normalize helpers', () => {
  it('normalizeAudio and adjustVolume are functions', async () => {
    const { normalizeAudio, adjustVolume } = await import('../../dist/esm/helpers/normalize.js');
    assert.ok(typeof normalizeAudio === 'function');
    assert.ok(typeof adjustVolume === 'function');
  });
});

// ─── GIF helpers ─────────────────────────────────────────────────────────────
describe('gif helpers', () => {
  it('toGif and gifToMp4 are functions', async () => {
    const { toGif, gifToMp4 } = await import('../../dist/esm/helpers/gif.js');
    assert.ok(typeof toGif === 'function');
    assert.ok(typeof gifToMp4 === 'function');
  });
});

// ─── Waveform helpers ────────────────────────────────────────────────────────
describe('waveform helpers', () => {
  it('generateWaveform and generateSpectrum are functions', async () => {
    const { generateWaveform, generateSpectrum } = await import('../../dist/esm/helpers/waveform.js');
    assert.ok(typeof generateWaveform === 'function');
    assert.ok(typeof generateSpectrum === 'function');
  });
});

// ─── Subtitle helpers ────────────────────────────────────────────────────────
describe('subtitle helpers', () => {
  it('burnSubtitles and extractSubtitles are functions', async () => {
    const { burnSubtitles, extractSubtitles } = await import('../../dist/esm/helpers/subtitles.js');
    assert.ok(typeof burnSubtitles === 'function');
    assert.ok(typeof extractSubtitles === 'function');
  });
});

// ─── Metadata helpers ────────────────────────────────────────────────────────
describe('metadata helpers', () => {
  it('writeMetadata and stripMetadata are functions', async () => {
    const { writeMetadata, stripMetadata } = await import('../../dist/esm/helpers/metadata.js');
    assert.ok(typeof writeMetadata === 'function');
    assert.ok(typeof stripMetadata === 'function');
  });
});

// ─── Screenshot helpers ──────────────────────────────────────────────────────
describe('screenshot helpers', () => {
  it('screenshots and frameToBuffer are functions', async () => {
    const { screenshots, frameToBuffer } = await import('../../dist/esm/helpers/screenshots.js');
    assert.ok(typeof screenshots === 'function');
    assert.ok(typeof frameToBuffer === 'function');
  });
});

// ─── Full index exports ──────────────────────────────────────────────────────
describe('index exports - new features', () => {
  let lib: any;
  before(async () => { lib = await import('../../dist/esm/index.js'); });

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
      assert.ok(lib[name] !== undefined, `Missing export: ${name}`);
    });
  }
});
