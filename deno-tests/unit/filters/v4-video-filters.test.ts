import { describe, it } from 'node:test';
import { expect } from '../../lib/expect.ts';
import { FilterChain } from '../../../lib/types/filters.ts';
import {
  drawbox, drawgrid, vignette, vaguedenoiser,
} from '../../../lib/filters/video/index.ts';

function chain(): FilterChain {
  return new FilterChain();
}

describe('drawbox filter', () => {
  it('chain form adds to chain', () => {
    const f = drawbox(chain(), { width: 100, height: 50 });
    expect(f.toString()).toContain('drawbox');
  });

  it('serializes width', () => {
    const f = drawbox({ width: 100 });
    expect(f).toContain('w=100');
  });

  it('serializes height', () => {
    const f = drawbox({ height: 50 });
    expect(f).toContain('h=50');
  });

  it('serializes color', () => {
    const f = drawbox({ color: 'red' });
    expect(f).toContain('color=red');
  });

  it('serializes thickness', () => {
    const f = drawbox({ thickness: 2 });
    expect(f).toContain('t=2');
  });

  it('serializes position', () => {
    const f = drawbox({ x: 10, y: 20 });
    expect(f).toContain('x=10');
    expect(f).toContain('y=20');
  });

  it('serializes radius', () => {
    const f = drawbox({ radius: 5 });
    expect(f).toContain('r=5');
  });
});

describe('drawgrid filter', () => {
  it('chain form adds to chain', () => {
    const f = drawgrid(chain(), { width: 100 });
    expect(f.toString()).toContain('drawgrid');
  });

  it('serializes width', () => {
    const f = drawgrid({ width: 50 });
    expect(f).toContain('w=50');
  });

  it('serializes color', () => {
    const f = drawgrid({ color: 'white' });
    expect(f).toContain('color=white');
  });

  it('serializes thickness', () => {
    const f = drawgrid({ thickness: 1 });
    expect(f).toContain('t=1');
  });
});

describe('vignette filter', () => {
  it('chain form adds to chain', () => {
    const f = vignette(chain(), { angle: 1 });
    expect(f.toString()).toContain('vignette');
  });

  it('serializes angle', () => {
    const f = vignette({ angle: 'PI/2' });
    expect(f).toContain('angle=PI/2');
  });

  it('serializes mode', () => {
    const f = vignette({ mode: 'backward' });
    expect(f).toContain('mode=backward');
  });

  it('serializes center', () => {
    const f = vignette({ x0: 100, y0: 200 });
    expect(f).toContain('x0=100');
    expect(f).toContain('y0=200');
  });
});

describe('vaguedenoiser filter', () => {
  it('chain form adds to chain', () => {
    const f = vaguedenoiser(chain(), { threshold: 3 });
    expect(f.toString()).toContain('vaguedenoiser');
  });

  it('serializes threshold', () => {
    const f = vaguedenoiser({ threshold: 2 });
    expect(f).toContain('threshold=2');
  });

  it('serializes frames', () => {
    const f = vaguedenoiser({ frames: 15 });
    expect(f).toContain('frames=15');
  });

  it('serializes algorithm', () => {
    const f = vaguedenoiser({ algorithm: 'soft' });
    expect(f).toContain('algorithm=soft');
  });
});