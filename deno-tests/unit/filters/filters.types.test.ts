import { describe, it } from 'node:test';
import { expect } from '../../lib/expect.ts';
import {
  serializeNode,
  serializeLink,
  pad,
  FilterChain,
  type FilterNode,
} from '../../../lib/types/filters.ts';

describe('serializeNode', () => {
  it('returns just the name when no args', () => {
    expect(serializeNode({ name: 'vflip', positional: [], named: {} })).toBe('vflip');
  });

  it('serializes positional args with colons', () => {
    const node: FilterNode = { name: 'scale', positional: ['1280', '720'], named: {} };
    expect(serializeNode(node)).toBe('scale=1280:720');
  });

  it('serializes named args as key=value pairs', () => {
    const node: FilterNode = { name: 'eq', positional: [], named: { brightness: 0.1, contrast: 1.2 } };
    const s = serializeNode(node);
    expect(s).toContain('brightness=0.1');
    expect(s).toContain('contrast=1.2');
    expect(s).toMatch(/^eq=/);
  });

  it('combines positional and named args', () => {
    const node: FilterNode = { name: 'scale', positional: ['1280', '720'], named: { flags: 'lanczos' } };
    expect(serializeNode(node)).toBe('scale=1280:720:flags=lanczos');
  });

  it('handles boolean named args as 0/1 numbers', () => {
    const node: FilterNode = { name: 'overlay', positional: ['0', '0'], named: { shortest: 1 } };
    expect(serializeNode(node)).toContain('shortest=1');
  });

  it('handles number positional args', () => {
    const node: FilterNode = { name: 'split', positional: [3], named: {} };
    expect(serializeNode(node)).toBe('split=3');
  });

  it('handles multiple named args with correct separator', () => {
    const node: FilterNode = {
      name: 'loudnorm',
      positional: [],
      named: { i: -23, lra: 7, tp: -2 },
    };
    const s = serializeNode(node);
    expect(s).toContain('i=-23');
    expect(s).toContain('lra=7');
    expect(s).toContain('tp=-2');
    // All joined with ':'
    expect(s.split(':').length).toBeGreaterThan(2);
  });
});

describe('FilterChain', () => {
  it('starts empty', () => {
    const chain = new FilterChain();
    expect(chain.length).toBe(0);
    expect(chain.toString()).toBe('');
  });

  it('serializes single filter', () => {
    const chain = new FilterChain();
    chain.add({ name: 'vflip', positional: [], named: {} });
    expect(chain.toString()).toBe('vflip');
  });

  it('joins multiple filters with commas', () => {
    const chain = new FilterChain();
    chain.add({ name: 'scale', positional: ['1280', '720'], named: {} });
    chain.add({ name: 'fps', positional: ['30'], named: {} });
    expect(chain.toString()).toBe('scale=1280:720,fps=30');
  });

  it('supports raw passthrough strings', () => {
    const chain = new FilterChain();
    chain.raw('scale=1280:720').raw('fps=30');
    expect(chain.toString()).toBe('scale=1280:720,fps=30');
  });

  it('mixes raw and structured nodes', () => {
    const chain = new FilterChain();
    chain.raw('scale=1280:720');
    chain.add({ name: 'vflip', positional: [], named: {} });
    expect(chain.toString()).toBe('scale=1280:720,vflip');
  });

  it('tracks length correctly', () => {
    const chain = new FilterChain();
    expect(chain.length).toBe(0);
    chain.add({ name: 'vflip', positional: [], named: {} });
    expect(chain.length).toBe(1);
    chain.add({ name: 'hflip', positional: [], named: {} });
    expect(chain.length).toBe(2);
  });

  it('exposes nodes as readonly', () => {
    const chain = new FilterChain();
    chain.add({ name: 'vflip', positional: [], named: {} });
    const nodes = chain.getNodes();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.name).toBe('vflip');
  });

  it('supports method chaining', () => {
    const chain = new FilterChain();
    const returned = chain.add({ name: 'vflip', positional: [], named: {} });
    expect(returned).toBe(chain);
  });
});

describe('pad (GraphPad factory)', () => {
  it('creates a pad with a label', () => {
    const p = pad('v0');
    expect(p.label).toBe('v0');
    expect(p.toString()).toBe('[v0]');
  });

  it('wraps label in brackets', () => {
    const p = pad('audio_out');
    expect(String(p)).toBe('[audio_out]');
  });

  it('works with template literals', () => {
    const p = pad('0:v');
    expect(`${p}`).toBe('[0:v]');
  });
});

describe('serializeLink', () => {
  it('serializes a simple single-input single-output link', () => {
    const link = {
      inputs: [pad('0:v')],
      filter: { name: 'scale', positional: ['1280', '720'], named: {} } as FilterNode,
      outputs: [pad('scaled')],
    };
    expect(serializeLink(link)).toBe('[0:v]scale=1280:720[scaled]');
  });

  it('serializes multi-input overlay link', () => {
    const link = {
      inputs: [pad('0:v'), pad('logo')],
      filter: { name: 'overlay', positional: ['W-w-10', 'H-h-10'], named: {} } as FilterNode,
      outputs: [pad('out')],
    };
    const s = serializeLink(link);
    expect(s).toBe('[0:v][logo]overlay=W-w-10:H-h-10[out]');
  });

  it('serializes multi-output split link', () => {
    const link = {
      inputs: [pad('0:v')],
      filter: { name: 'split', positional: [2], named: {} } as FilterNode,
      outputs: [pad('v0'), pad('v1')],
    };
    expect(serializeLink(link)).toBe('[0:v]split=2[v0][v1]');
  });

  it('handles filter with no args and no inputs', () => {
    const link = {
      inputs: [],
      filter: { name: 'nullsrc', positional: [], named: {} } as FilterNode,
      outputs: [pad('out')],
    };
    expect(serializeLink(link)).toBe('nullsrc[out]');
  });
});
