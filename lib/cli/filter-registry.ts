/**
 * A name-addressable registry of every built-in filter in the library.
 *
 * The library exposes each filter as a typed function taking either a
 * `FilterChain` plus options, or a bare positional value. The CLI needs the
 * same filters addressable by name so that `mediaforge filter <name> k=v …`
 * can reach all 77 of them, including the ones no task command wraps.
 *
 * `kind: 'opts'` filters take an options record (built from `key=value` tokens);
 * `kind: 'value'` filters take their documented keys as positional arguments,
 * in the order listed in `keys`.
 */
import type { FilterChain } from '../types/filters.ts';
import * as v from '../filters/video/index.ts';
import * as a from '../filters/audio/index.ts';

export type FilterKind = 'value' | 'opts';

export interface FilterEntry {
  /** Stream the filter applies to. */
  stream: 'video' | 'audio';
  /** How the CLI options map onto the library call. */
  kind: FilterKind;
  /**
   * Accepted option keys, in the order they are passed to the library.
   * For `kind: 'value'` the order is the positional argument order.
   */
  keys: string[];
  /** Options that must be supplied. */
  required?: string[];
  apply: (chain: FilterChain, rec: Record<string, string | number | boolean>) => FilterChain;
}

type Opts = Record<string, string | number | boolean>;

/** For `kind: 'value'` filters: read the first supplied key as a positional. */
function first(rec: Opts, keys: string[]): string | number | boolean {
  for (const k of keys) {
    const v = rec[k];
    if (v !== undefined) return v;
  }
  return '';
}

/** Build an `opts`-kind entry. */
function opt(
  stream: 'video' | 'audio',
  keys: string[],
  fn: (chain: FilterChain, o: never) => FilterChain,
  required?: string[],
): FilterEntry {
  return { stream, kind: 'opts', keys, ...(required ? { required } : {}), apply: fn as FilterEntry['apply'] };
}

/** Build a `value`-kind entry with a single positional argument. */
function val(
  stream: 'video' | 'audio',
  key: string,
  fn: (chain: FilterChain, x: never) => FilterChain,
  required = true,
): FilterEntry {
  return {
    stream,
    kind: 'value',
    keys: [key],
    ...(required ? { required: [key] } : {}),
    apply: (chain, rec) => fn(chain, first(rec, [key]) as never),
  };
}

/** Every built-in filter, keyed by the name used on the command line. */
export const FILTER_REGISTRY: Record<string, FilterEntry> = {
  // ─── Video: scaling and geometry ───────────────────────────────────────
  scale: opt('video', ['w', 'h', 'flags', 'force_original_aspect_ratio', 'force_divisible_by', 'eval'], v.scale as never),
  crop: opt('video', ['w', 'h', 'x', 'y', 'keep_aspect', 'exact'], v.crop as never),
  pad: opt('video', ['width', 'height', 'x', 'y', 'color', 'aspect'], v.pad as never, ['width', 'height']),
  overlay: opt('video', ['x', 'y', 'eval', 'shortest', 'format', 'alpha'], v.overlay as never, ['x', 'y']),
  drawbox: opt('video', ['width', 'height', 'x', 'y', 'color', 'thickness', 'radius', 'replace'], v.drawbox as never),
  drawgrid: opt('video', ['width', 'height', 'x', 'y', 'color', 'thickness', 'replace'], v.drawgrid as never),
  transpose: val('video', 'dir', v.transpose as never),
  rotate: opt('video', ['angle', 'ow', 'oh', 'fillcolor', 'bilinear'], v.rotate as never, ['angle']),
  fps: opt('video', ['fps', 'round', 'eof_action'], v.fps as never, ['fps']),
  setsar: val('video', 'ratio', v.setsar as never),
  setdar: val('video', 'ratio', v.setdar as never),
  setpts: val('video', 'expr', v.setpts as never),
  format: val('video', 'pix_fmt', v.format as never),
  trim: opt('video', ['start', 'end', 'duration', 'start_frame', 'end_frame'], v.trim as never),
  select: val('video', 'expr', v.select as never),
  split: val('video', 'n', v.split as never, false),
  thumbnail: val('video', 'n', v.thumbnail as never, false),

  // ─── Video: colour and detail ──────────────────────────────────────────
  eq: opt('video', ['brightness', 'contrast', 'saturation', 'gamma', 'gamma_weight', 'gamma_r', 'gamma_g', 'gamma_b', 'eval'], v.eq as never),
  hue: opt('video', ['h', 's', 'b'], v.hue as never),
  colorbalance: opt('video', ['rs', 'rm', 'rh'], v.colorbalance as never),
  curves: opt('video', ['preset', 'master', 'r', 'g', 'b'], v.curves as never),
  levels: opt('video', ['inBlack', 'inWhite', 'outBlack', 'outWhite', 'gamma', 'channel'], v.levels as never),
  unsharp: opt('video', ['lx', 'ly', 'la', 'cx', 'cy', 'ca', 'ax', 'ay', 'aa'], v.unsharp as never),
  gblur: opt('video', ['sigma', 'steps', 'planes', 'sigmaV'], v.gblur as never),
  boxblur: opt('video', ['luma_radius', 'luma_power', 'chroma_radius', 'chroma_power', 'alpha_radius', 'alpha_power'], v.boxblur as never),
  hqdn3d: opt('video', ['s0', 's1', 's2', 's3'], v.hqdn3d as never),
  nlmeans: opt('video', ['h', 'r', 'p', 's'], v.nlmeans as never),
  nlmeans_vulkan: opt('video', ['h', 'r', 'p', 's'], v.nlmeansVulkan as never),
  avgblur_vulkan: opt('video', ['sizeX', 'sizeY', 'planes'], v.avgblurVulkan as never),
  deband: opt('video', ['range', 'direction'], v.deband as never),
  deshake: opt('video', ['rx', 'ry'], v.deshake as never),
  deflicker: opt('video', ['size', 'mode'], v.deflicker as never),
  smartblur: opt('video', ['luma_radius', 'luma_strength', 'chroma_radius', 'chroma_strength'], v.smartblur as never),
  yadif: opt('video', ['mode', 'parity', 'deint'], v.yadif as never),
  hflip: opt('video', [], (c: FilterChain) => v.hflip(c)),
  vflip: opt('video', [], (c: FilterChain) => v.vflip(c)),
  vignette: opt('video', ['angle', 'mode', 'x0', 'y0'], v.vignette as never),
  vaguedenoiser: opt('video', ['threshold', 'frames', 'algorithm'], v.vaguedenoiser as never),
  delogo: opt('video', ['x', 'y', 'width', 'height', 'show'], v.delogo as never, ['x', 'y', 'width', 'height']),

  // ─── Video: keys, compositing, text ────────────────────────────────────
  colorkey: opt('video', ['color', 'similarity', 'blend'], v.colorkey as never, ['color']),
  chromakey: opt('video', ['color', 'similarity', 'blend'], v.chromakey as never, ['color']),
  fade: opt('video', ['type', 'start_frame', 'nb_frames', 'start_time', 'duration', 'color', 'alpha'], v.fade as never, ['type']),
  zoompan: opt('video', ['zoom', 'x', 'y', 'd', 's', 'fps'], v.zoompan as never),
  drawtext: opt('video', ['text', 'textfile', 'fontfile', 'font', 'fontsize', 'fontcolor', 'x', 'y', 'box', 'boxcolor', 'boxborderw', 'borderw', 'enable', 'expansion', 'line_spacing', 'shadowcolor', 'shadowx', 'shadowy', 'text_align', 'tc24hmax', 'fontcolor_expr'], v.drawtext as never),
  subtitles: opt('video', ['filename', 'si', 'original_size', 'charenc', 'force_style'], v.subtitles as never, ['filename']),
  concat: opt('video', ['n', 'v', 'a', 'unsafe'], v.concat as never),
  tile: opt('video', ['layout', 'nb_frames', 'margin', 'padding', 'color', 'overlap', 'init_padding'], v.tile as never, ['layout']),
  hstack: val('video', 'inputs', v.hstack as never, false),
  vstack: val('video', 'inputs', v.vstack as never, false),
  xstack: opt('video', ['inputs', 'layout'], v.xstack as never, ['inputs', 'layout']),
  color: opt('video', ['color', 'size', 'rate'], v.colorSource as never),

  // ─── Audio: level and dynamics ─────────────────────────────────────────
  volume: val('audio', 'volume', ((c: FilterChain, x: never) => a.volume(c, x as never)) as never, false),
  loudnorm: opt('audio', ['i', 'lra', 'tp', 'measured_i', 'measured_tp', 'measured_lra', 'measured_thresh', 'offset', 'linear', 'print_format', 'dual_mono'], a.loudnorm as never),
  equalizer: opt('audio', ['frequency', 'width', 'width_type', 'gain', 'channels', 'poles', 'mix'], a.equalizer as never, ['frequency', 'width', 'gain']),
  bass: opt('audio', ['gain', 'frequency', 'width', 'width_type'], a.bass as never, ['gain']),
  treble: opt('audio', ['gain', 'frequency', 'width', 'width_type'], a.treble as never, ['gain']),
  compand: opt('audio', ['attacks', 'decays', 'points', 'soft_knee', 'gain', 'initial_volume', 'delay'], a.compand as never),
  dynaudnorm: opt('audio', ['framelen', 'gausssize', 'peak', 'maxgain', 'rms', 'compress', 'threshold', 'coupling', 'correctdc', 'altboundary'], a.dynaudnorm as never),
  agate: opt('audio', ['threshold', 'range', 'attack', 'release', 'knee', 'detection', 'link'], a.agate as never),
  rubberband: opt('audio', ['tempo', 'pitch', 'transients', 'detector', 'phase', 'window', 'smoothing', 'formant', 'pitchq', 'engine'], a.rubberband as never),
  atempo: val('audio', 'tempo', a.atempo as never),
  aecho: opt('audio', ['in_gain', 'out_gain', 'delays', 'decays'], a.aecho as never),
  headphones: opt('audio', ['hrir', 'size', 'normalize', 'htf'], a.headphones as never, ['hrir']),
  sofalizer: opt('audio', ['sofa', 'samplerate', 'normalize', 'interpolation'], a.sofalizer as never, ['sofa']),

  // ─── Audio: filtering and routing ──────────────────────────────────────
  highpass: val('audio', 'frequency', ((c: FilterChain, x: never) => a.highpass(c, x as never)) as never),
  lowpass: val('audio', 'frequency', ((c: FilterChain, x: never) => a.lowpass(c, x as never)) as never),
  atrim: opt('audio', ['start', 'end', 'duration', 'start_pts', 'end_pts', 'start_sample', 'end_sample'], a.atrim as never),
  afade: opt('audio', ['type', 'start_sample', 'nb_samples', 'start_time', 'duration', 'curve'], a.afade as never, ['type']),
  silencedetect: opt('audio', ['noise', 'duration', 'mono'], a.silencedetect as never),
  asetpts: val('audio', 'expr', a.asetpts as never),
  pan: val('audio', 'layout_expr', a.pan as never),
  channelmap: val('audio', 'map', a.channelmap as never),
  channelsplit: val('audio', 'channel_layout', a.channelsplit as never, false),
  amix: opt('audio', ['inputs', 'duration', 'dropout_transition', 'normalize', 'weights'], a.amix as never),
  amerge: val('audio', 'inputs', a.amerge as never, false),
  asplit: val('audio', 'n', a.asplit as never, false),
  aresample: opt('audio', ['sampleRate', 'resampler', 'sample_fmt', 'precision'], a.aresample as never),
};

/** Names of every filter in the registry, sorted. */
export function filterNames(): string[] {
  return Object.keys(FILTER_REGISTRY).sort();
}
