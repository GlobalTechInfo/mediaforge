import {
  FilterChain,
  serializeNode,
  type FilterNode,
} from '../types/filters.js';

/**
 * A fluent builder for -filter_complex graphs.
 *
 * @example
 * // Overlay a logo onto a video
 * const graph = new FilterGraph();
 * const [scaledV] = graph.from('[0:v]').scale({ width: 1280, height: 720 }).out('scaled');
 * const [logo]    = graph.from('[1:v]').colorkey({ color: '#00ff00', similarity: 0.1 }).out('logo');
 * graph.overlay(scaledV, logo, { x: 'W-w-10', y: 'H-h-10' }).mapOut('final');
 * const str = graph.toString(); // ready for -filter_complex
 */

/** A stream label reference in the graph, e.g. "[0:v]" or "[scaled]" */
export type StreamRef = string;

let _labelCounter = 0;
function autoLabel(prefix = 'p'): string {
  return `${prefix}${_labelCounter++}`;
}

/** Reset the auto-label counter (useful in tests) */
export function resetLabelCounter(): void {
  _labelCounter = 0;
}

/**
 * A stream in the graph with a typed label.
 * Wraps a pad label and tracks its type for validation.
 */
export class GraphStream {
  constructor(
    public readonly label: string,
    public readonly type: 'video' | 'audio' | 'unknown',
  ) {}

  toString(): string {
    return `[${this.label}]`;
  }
}

/**
 * A node being built in the filter graph.
 * Supports chaining multiple filters on the same stream.
 */
export class GraphNode {
  private readonly graph: FilterGraph;
  private readonly inputs: GraphStream[];
  private readonly chain: FilterNode[] = [];

  constructor(graph: FilterGraph, inputs: GraphStream[]) {
    this.graph = graph;
    this.inputs = inputs;
  }

  /** Apply a raw filter string */
  filter(name: string, positional: (string | number)[] = [], named: Record<string, string | number | boolean> = {}): this {
    this.chain.push({ name, positional, named });
    return this;
  }

  // ─── Video filters (convenience wrappers) ──────────────────────────────────

  scale(width: number | string, height: number | string, opts: Record<string, string | number | boolean> = {}): this {
    this.chain.push({ name: 'scale', positional: [String(width), String(height)], named: opts });
    return this;
  }

  crop(width: number | string, height: number | string, x?: number | string, y?: number | string): this {
    const named: Record<string, string | number | boolean> = {};
    if (x !== undefined) named['x'] = x;
    if (y !== undefined) named['y'] = y;
    this.chain.push({ name: 'crop', positional: [String(width), String(height)], named });
    return this;
  }

  pad(width: number | string, height: number | string, x?: number | string, y?: number | string, color?: string): this {
    const named: Record<string, string | number | boolean> = {};
    if (x !== undefined) named['x'] = x;
    if (y !== undefined) named['y'] = y;
    if (color !== undefined) named['color'] = color;
    this.chain.push({ name: 'pad', positional: [String(width), String(height)], named });
    return this;
  }

  fps(rate: number | string): this {
    this.chain.push({ name: 'fps', positional: [String(rate)], named: {} });
    return this;
  }

  format(pixFmt: string): this {
    this.chain.push({ name: 'format', positional: [pixFmt], named: {} });
    return this;
  }

  setpts(expr: string): this {
    this.chain.push({ name: 'setpts', positional: [expr], named: {} });
    return this;
  }

  vflip(): this {
    this.chain.push({ name: 'vflip', positional: [], named: {} });
    return this;
  }

  hflip(): this {
    this.chain.push({ name: 'hflip', positional: [], named: {} });
    return this;
  }

  colorkey(color: string, similarity = 0.1, blend = 0.0): this {
    this.chain.push({ name: 'colorkey', positional: [color], named: { similarity, blend } });
    return this;
  }

  // ─── Audio filters (convenience wrappers) ──────────────────────────────────

  volume(v: number | string): this {
    this.chain.push({ name: 'volume', positional: [String(v)], named: {} });
    return this;
  }

  atempo(factor: number): this {
    this.chain.push({ name: 'atempo', positional: [factor], named: {} });
    return this;
  }

  asetpts(expr: string): this {
    this.chain.push({ name: 'asetpts', positional: [expr], named: {} });
    return this;
  }

  loudnorm(i = -23, lra = 7, tp = -2): this {
    this.chain.push({ name: 'loudnorm', positional: [], named: { i, lra, tp } });
    return this;
  }

  // ─── Output labeling ───────────────────────────────────────────────────────

  /**
   * Assign output labels to this node and register the link in the graph.
   * Returns GraphStream[] that can be used as inputs to subsequent filters.
   */
  out(...labels: string[]): GraphStream[] {
    if (labels.length === 0) labels = [autoLabel()];
    const outputs = labels.map((l) => new GraphStream(l, 'unknown'));
    this._commit(outputs);
    return outputs;
  }

  /** Shorthand: single output with auto-generated label */
  outAuto(type: 'video' | 'audio' = 'unknown' as 'video'): GraphStream {
    const label = autoLabel(type === 'video' ? 'v' : 'a');
    const stream = new GraphStream(label, type);
    this._commit([stream]);
    return stream;
  }

  /** Register this as a final output (no output label needed — used with -map) */
  mapOut(label?: string): GraphStream {
    const lbl = label ?? autoLabel('out');
    const stream = new GraphStream(lbl, 'unknown');
    this._commit([stream]);
    return stream;
  }

  private _commit(outputs: GraphStream[]): void {
    // Serialize the chain as a sequence of comma-joined filters
    const filterStr = this.chain.map(serializeNode).join(',');
    const inputLabels = this.inputs.map((s) => `[${s.label}]`).join('');
    const outputLabels = outputs.map((s) => `[${s.label}]`).join('');
    this.graph._addLink(`${inputLabels}${filterStr}${outputLabels}`);
  }
}

/**
 * Multi-input filter node (overlay, amerge, amix, concat, etc.)
 */
export class MultiInputNode {
  constructor(
    private readonly graph: FilterGraph,
    private readonly streams: GraphStream[],
  ) {}

  overlay(x: number | string = 0, y: number | string = 0, opts: Record<string, string | number | boolean> = {}): GraphNode {
    const named: Record<string, string | number | boolean> = { ...opts };
    const node = new GraphNode(this.graph, this.streams);
    return node.filter('overlay', [String(x), String(y)], named);
  }

  amerge(inputs?: number): GraphNode {
    const named: Record<string, string | number | boolean> = {};
    if (inputs !== undefined) named['inputs'] = inputs;
    return new GraphNode(this.graph, this.streams).filter('amerge', [], named);
  }

  amix(inputs?: number, duration?: string): GraphNode {
    const named: Record<string, string | number | boolean> = {};
    if (inputs !== undefined) named['inputs'] = inputs;
    if (duration !== undefined) named['duration'] = duration;
    return new GraphNode(this.graph, this.streams).filter('amix', [], named);
  }

  concat(n: number, v: number, a: number): GraphNode {
    return new GraphNode(this.graph, this.streams).filter('concat', [], { n, v, a });
  }

  hstack(inputs?: number, shortest?: boolean): GraphNode {
    const named: Record<string, string | number | boolean> = {};
    if (inputs !== undefined) named['inputs'] = inputs;
    if (shortest !== undefined) named['shortest'] = shortest ? 1 : 0;
    return new GraphNode(this.graph, this.streams).filter('hstack', [], named);
  }

  vstack(inputs?: number, shortest?: boolean): GraphNode {
    const named: Record<string, string | number | boolean> = {};
    if (inputs !== undefined) named['inputs'] = inputs;
    if (shortest !== undefined) named['shortest'] = shortest ? 1 : 0;
    return new GraphNode(this.graph, this.streams).filter('vstack', [], named);
  }
}

/**
 * The main filter_complex graph builder.
 *
 * @example
 * const g = new FilterGraph();
 *
 * // Scale the main video
 * const [v] = g.from('[0:v]').scale(1280, 720).out('scaled');
 *
 * // Prepare audio: normalize + fade in
 * const [a] = g.from('[0:a]').loudnorm(23, 7, -2).out('audio');
 *
 * // Build final filter_complex string
 * console.log(g.toString());
 * // → "[0:v]scale=1280:720[scaled];[0:a]loudnorm=i=23:lra=7:tp=-2[audio]"
 */
export class FilterGraph {
  private readonly _links: string[] = [];

  /** @internal Called by GraphNode._commit() */
  _addLink(link: string): void {
    this._links.push(link);
  }

  /**
   * Start building a filter chain from one or more input stream refs.
   * @example g.from('[0:v]')   // from input 0 video
   * @example g.from('[logo]')  // from a previously labeled stream
   */
  from(...refs: (string | GraphStream)[]): GraphNode {
    const streams = refs.map((r) =>
      typeof r === 'string'
        ? new GraphStream(r.replace(/^\[|\]$/g, ''), 'unknown')
        : r,
    );
    return new GraphNode(this, streams);
  }

  /**
   * Start building a multi-input filter (overlay, amerge, concat…).
   */
  merge(...refs: (string | GraphStream)[]): MultiInputNode {
    const streams = refs.map((r) =>
      typeof r === 'string'
        ? new GraphStream(r.replace(/^\[|\]$/g, ''), 'unknown')
        : r,
    );
    return new MultiInputNode(this, streams);
  }

  /**
   * Serialize the complete filter_complex string (semicolon-separated links).
   */
  toString(): string {
    return this._links.join(';');
  }

  /** How many links are in the graph */
  get size(): number {
    return this._links.length;
  }
}

// ─── Simple chain builders (for -vf / -af) ────────────────────────────────────

/**
 * Build a typed video filter chain for use with .videoFilter().
 *
 * @example
 * const vf = videoFilterChain()
 *   .scale(1280, 720)
 *   .unsharp({ la: 1.0 })
 *   .toString();
 * ffmpeg('in.mp4').output('out.mp4').videoFilter(vf).run();
 */
export class VideoFilterChain {
  private readonly chain: FilterChain = new FilterChain();

  raw(str: string): this { this.chain.raw(str); return this; }

  scale(width: number | string, height: number | string, flags?: string): this {
    const named: Record<string, string | number | boolean> = {};
    if (flags !== undefined) named['flags'] = flags;
    this.chain.add({ name: 'scale', positional: [String(width), String(height)], named });
    return this;
  }

  crop(w: number | string, h: number | string, x?: number | string, y?: number | string): this {
    const named: Record<string, string | number | boolean> = {};
    if (x !== undefined) named['x'] = x;
    if (y !== undefined) named['y'] = y;
    this.chain.add({ name: 'crop', positional: [String(w), String(h)], named });
    return this;
  }

  pad(w: number | string, h: number | string, x?: number | string, y?: number | string, color?: string): this {
    const named: Record<string, string | number | boolean> = {};
    if (x !== undefined) named['x'] = x;
    if (y !== undefined) named['y'] = y;
    if (color !== undefined) named['color'] = color;
    this.chain.add({ name: 'pad', positional: [String(w), String(h)], named });
    return this;
  }

  fps(rate: number | string): this {
    this.chain.add({ name: 'fps', positional: [String(rate)], named: {} });
    return this;
  }

  setpts(expr: string): this {
    this.chain.add({ name: 'setpts', positional: [expr], named: {} });
    return this;
  }

  vflip(): this { this.chain.add({ name: 'vflip', positional: [], named: {} }); return this; }
  hflip(): this { this.chain.add({ name: 'hflip', positional: [], named: {} }); return this; }

  format(fmt: string): this {
    this.chain.add({ name: 'format', positional: [fmt], named: {} });
    return this;
  }

  unsharp(lx = 5, ly = 5, la = 1.0): this {
    this.chain.add({ name: 'unsharp', positional: [], named: { lx, ly, la } });
    return this;
  }

  eq(brightness?: number, contrast?: number, saturation?: number, gamma?: number): this {
    const named: Record<string, string | number | boolean> = {};
    if (brightness !== undefined) named['brightness'] = brightness;
    if (contrast !== undefined) named['contrast'] = contrast;
    if (saturation !== undefined) named['saturation'] = saturation;
    if (gamma !== undefined) named['gamma'] = gamma;
    this.chain.add({ name: 'eq', positional: [], named });
    return this;
  }

  drawtext(text: string, x: number | string, y: number | string, fontsize?: number, color?: string): this {
    const named: Record<string, string | number | boolean> = { text, x, y };
    if (fontsize !== undefined) named['fontsize'] = fontsize;
    if (color !== undefined) named['fontcolor'] = color;
    this.chain.add({ name: 'drawtext', positional: [], named });
    return this;
  }

  yadif(mode = 0): this {
    this.chain.add({ name: 'yadif', positional: [], named: { mode } });
    return this;
  }

  transpose(dir: 0 | 1 | 2 | 3): this {
    this.chain.add({ name: 'transpose', positional: [dir], named: {} });
    return this;
  }

  fade(type: 'in' | 'out', startFrame: number, nbFrames: number): this {
    this.chain.add({ name: 'fade', positional: [], named: { type, start_frame: startFrame, nb_frames: nbFrames } });
    return this;
  }

  thumbnail(n = 100): this {
    this.chain.add({ name: 'thumbnail', positional: [n], named: {} });
    return this;
  }

  toString(): string { return this.chain.toString(); }
}

/**
 * Build a typed audio filter chain for use with .audioFilter().
 *
 * @example
 * const af = audioFilterChain()
 *   .loudnorm(-23, 7, -2)
 *   .highpass(80)
 *   .toString();
 */
export class AudioFilterChain {
  private readonly chain: FilterChain = new FilterChain();

  raw(str: string): this { this.chain.raw(str); return this; }

  volume(v: number | string): this {
    this.chain.add({ name: 'volume', positional: [String(v)], named: {} });
    return this;
  }

  loudnorm(i = -23, lra = 7, tp = -2): this {
    this.chain.add({ name: 'loudnorm', positional: [], named: { i, lra, tp } });
    return this;
  }

  highpass(freq: number): this {
    this.chain.add({ name: 'highpass', positional: [], named: { f: freq } });
    return this;
  }

  lowpass(freq: number): this {
    this.chain.add({ name: 'lowpass', positional: [], named: { f: freq } });
    return this;
  }

  equalizer(freq: number, width: number, gain: number, widthType = 'o'): this {
    this.chain.add({ name: 'equalizer', positional: [], named: { f: freq, width, g: gain, width_type: widthType } });
    return this;
  }

  afade(type: 'in' | 'out', startTime: number | string, duration: number | string): this {
    this.chain.add({ name: 'afade', positional: [], named: { type, start_time: startTime, duration } });
    return this;
  }

  atempo(factor: number): this {
    this.chain.add({ name: 'atempo', positional: [factor], named: {} });
    return this;
  }

  asetpts(expr: string): this {
    this.chain.add({ name: 'asetpts', positional: [expr], named: {} });
    return this;
  }

  dynaudnorm(frameLen = 500, peak = 0.95): this {
    this.chain.add({ name: 'dynaudnorm', positional: [], named: { f: frameLen, p: peak } });
    return this;
  }

  silencedetect(noise = '-60dB', duration = 2): this {
    this.chain.add({ name: 'silencedetect', positional: [], named: { noise, duration } });
    return this;
  }

  aecho(inGain = 0.6, outGain = 0.3, delays = '1000', decays = '0.5'): this {
    this.chain.add({ name: 'aecho', positional: [], named: { in_gain: inGain, out_gain: outGain, delays, decays } });
    return this;
  }

  rubberband(tempo?: number, pitch?: number): this {
    const named: Record<string, string | number | boolean> = {};
    if (tempo !== undefined) named['tempo'] = tempo;
    if (pitch !== undefined) named['pitch'] = pitch;
    this.chain.add({ name: 'rubberband', positional: [], named });
    return this;
  }

  toString(): string { return this.chain.toString(); }
}

/** Factory: create a video filter chain */
export function videoFilterChain(): VideoFilterChain {
  return new VideoFilterChain();
}

/** Factory: create an audio filter chain */
export function audioFilterChain(): AudioFilterChain {
  return new AudioFilterChain();
}

/** Factory: create a filter_complex graph builder */
export function filterGraph(): FilterGraph {
  return new FilterGraph();
}
