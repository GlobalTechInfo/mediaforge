import { describe, it } from 'node:test';
import { expect } from '../../lib/expect.ts';
import { buildAtempoChain, cropToRatio, mixAudio, stackVideos, changeSpeed } from '../../../lib/helpers/edit.ts';

describe('buildAtempoChain', () => {
  it('2x speed → single atempo=2', () => { expect(buildAtempoChain(2)).toContain('atempo=2.0'); });
  it('4x speed → chains two atempo=2', () => { expect(buildAtempoChain(4).split(',').length).toBe(2); });
  it('0.25x speed → chains two atempo=0.5', () => { expect(buildAtempoChain(0.25)).toContain('atempo=0.5,atempo=0.5'); });
  it('1.5x speed → single atempo', () => {
    const c = buildAtempoChain(1.5);
    expect(c.includes(',')).toBe(false);
    expect(c).toContain('atempo=1.5');
  });
});

describe('cropToRatio validation', () => {
  it('throws for bad ratio', async () => {
    let threw = false;
    try { await cropToRatio({ input: 'x', output: 'y', ratio: 'bad' }); } catch { threw = true; }
    expect(threw).toBe(true);
  });
});

describe('mixAudio validation', () => {
  it('throws for < 2 inputs', async () => {
    let threw = false;
    try { await mixAudio({ inputs: ['a.mp3'], output: 'o.mp3' }); } catch { threw = true; }
    expect(threw).toBe(true);
  });
});

describe('stackVideos validation', () => {
  it('throws for < 2 inputs', async () => {
    let threw = false;
    try { await stackVideos({ inputs: ['a.mp4'], output: 'o.mp4' }); } catch { threw = true; }
    expect(threw).toBe(true);
  });
});

describe('changeSpeed validation', () => {
  it('throws for speed 0', async () => {
    let threw = false;
    try { await changeSpeed({ input: 'x', output: 'y', speed: 0 }); } catch { threw = true; }
    expect(threw).toBe(true);
  });
});
