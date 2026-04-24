import { describe, it, before } from 'node:test';
import * as assert from 'node:assert/strict';

// Arg-only / logic tests — no FFmpeg binary needed

describe('buildAtempoChain', () => {
  let buildAtempoChain: (speed: number) => string;
  before(async () => {
    const m = await import('../../../dist/esm/helpers/edit.js');
    buildAtempoChain = m.buildAtempoChain;
  });

  it('2x speed uses single atempo=2', () => {
    assert.strictEqual(buildAtempoChain(2), 'atempo=2.000000');
  });

  it('0.5x speed uses single atempo=0.5', () => {
    assert.strictEqual(buildAtempoChain(0.5), 'atempo=0.500000');
  });

  it('4x speed chains two atempo=2 filters', () => {
    const chain = buildAtempoChain(4);
    assert.ok(chain.startsWith('atempo=2.0,atempo=2.0'), `got: ${chain}`);
  });

  it('0.25x speed chains two atempo=0.5 filters', () => {
    const chain = buildAtempoChain(0.25);
    assert.ok(chain.startsWith('atempo=0.5,atempo=0.5'), `got: ${chain}`);
  });

  it('1.5x speed uses single atempo', () => {
    const chain = buildAtempoChain(1.5);
    assert.ok(chain.startsWith('atempo=1.5'), `got: ${chain}`);
    assert.ok(!chain.includes(','), 'should not chain for 1.5');
  });
});

describe('cropToRatio argument validation', () => {
  let cropToRatio: any;
  before(async () => {
    ({ cropToRatio } = await import('../../../dist/esm/helpers/edit.js'));
  });

  it('throws for invalid ratio string', async () => {
    await assert.rejects(() => cropToRatio({ input: 'x', output: 'y', ratio: 'bad' }), /Invalid ratio/);
  });
});

describe('mixAudio argument validation', () => {
  let mixAudio: any;
  before(async () => {
    ({ mixAudio } = await import('../../../dist/esm/helpers/edit.js'));
  });

  it('throws for fewer than 2 inputs', async () => {
    await assert.rejects(() => mixAudio({ inputs: ['a.mp3'], output: 'o.mp3' }), /2 inputs/);
  });
});

describe('stackVideos argument validation', () => {
  let stackVideos: any;
  before(async () => {
    ({ stackVideos } = await import('../../../dist/esm/helpers/edit.js'));
  });

  it('throws for fewer than 2 inputs', async () => {
    await assert.rejects(() => stackVideos({ inputs: ['a.mp4'], output: 'o.mp4' }), /2 inputs/);
  });
});

describe('changeSpeed argument validation', () => {
  let changeSpeed: any;
  before(async () => {
    ({ changeSpeed } = await import('../../../dist/esm/helpers/edit.js'));
  });

  it('throws for speed <= 0', async () => {
    await assert.rejects(() => changeSpeed({ input: 'x', output: 'y', speed: 0 }), /speed must be/);
  });
});
