import { describe, it } from 'node:test';
import { expect } from '../../lib/expect.js';
import { FilterChain } from '../../../dist/esm/types/filters.js';
import {
  headphones, sofalizer,
} from '../../../dist/esm/filters/audio/index.js';

function chain(): FilterChain {
  return new FilterChain();
}

describe('headphones filter', () => {
  it('chain form adds to chain', () => {
    const f = headphones(chain(), { hrir: '/path/to/hrir.so' });
    expect(f.toString()).toContain('headphones');
  });

  it('serializes hrir path', () => {
    const f = headphones({ hrir: '/data/hrir.so' });
    expect(f).toContain('hrir=/data/hrir.so');
  });

  it('serializes size', () => {
    const f = headphones({ hrir: '/a.so', size: 4096 });
    expect(f).toContain('size=4096');
  });

it('serializes normalize', () => {
    const f = headphones({ hrir: '/a.so', normalize: true });
    expect(f).toContain('normalize=true');
  });

  it('serializes htf', () => {
    const f = headphones({ hrir: '/a.so', htf: 5 });
    expect(f).toContain('htf=5');
  });
});

describe('sofalizer filter', () => {
  it('chain form adds to chain', () => {
    const f = sofalizer(chain(), { sofa: '/path/to.sofa' });
    expect(f.toString()).toContain('sofalizer');
  });

  it('serializes sofa path', () => {
    const f = sofalizer({ sofa: '/data/sofa.so' });
    expect(f).toContain('sofa=/data/sofa.so');
  });

  it('serializes samplerate', () => {
    const f = sofalizer({ sofa: '/a.so', samplerate: 48000 });
    expect(f).toContain('samplerate=48000');
  });

  it('serializes normalize', () => {
    const f = sofalizer({ sofa: '/a.so', normalize: 'max' });
    expect(f).toContain('normalize=max');
  });

  it('serializes interpolation', () => {
    const f = sofalizer({ sofa: '/a.so', interpolation: 'trilinear' });
    expect(f).toContain('interpolation=trilinear');
  });
});