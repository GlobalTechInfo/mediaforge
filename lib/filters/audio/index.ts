import { FilterChain, serializeNode } from '../../types/filters.ts';

// ─── Volume ───────────────────────────────────────────────────────────────────

export interface VolumeOptions {
  /** Volume adjustment. Can be number (1.0 = unchanged), dB string ('6dB'), or expression */
  volume: number | string;
  /** How to interpret the value: lin, dB, replaygain */
  replaygain?: 'drop' | 'ignore' | 'track' | 'album';
  /** Volume expression evaluation: once, frame */
  eval?: 'once' | 'frame';
  /** Precision: fixed, float, double */
  precision?: 'fixed' | 'float' | 'double';
}

export function volume(opts: VolumeOptions | number | string): string;
export function volume(chain: FilterChain, opts: VolumeOptions | number | string): FilterChain;
export function volume(
  chainOrOpts: FilterChain | VolumeOptions | number | string,
  opts?: VolumeOptions | number | string,
): FilterChain | string {
  const isStandalone = !(chainOrOpts instanceof FilterChain);
  const o = isStandalone ? chainOrOpts as (VolumeOptions | number | string) : opts!;
  let node: { name: string; positional: (string|number)[]; named: Record<string,string|number|boolean> };
  if (typeof o === 'number' || typeof o === 'string') {
    node = { name: 'volume', positional: [String(o)], named: {} };
  } else {
    const named: Record<string, string | number | boolean> = {};
    if (o.replaygain !== undefined) named['replaygain'] = o.replaygain;
    if (o.eval !== undefined) named['eval'] = o.eval;
    if (o.precision !== undefined) named['precision'] = o.precision;
    node = { name: 'volume', positional: [String(o.volume)], named };
  }
  if (isStandalone) return serializeNode(node);
  return (chainOrOpts as FilterChain).add(node);
}

// ─── Loudnorm (EBU R128) ─────────────────────────────────────────────────────

export interface LoudnormOptions {
  /** Integrated loudness target, -70.0 to -5.0. Default: -24.0 */
  i?: number;
  /** Loudness range target, 1.0 to 50.0. Default: 7.0 */
  lra?: number;
  /** Max true peak, -9.0 to 0.0. Default: -2.0 */
  tp?: number;
  /** Measured input integrated loudness (two-pass) */
  measured_i?: number;
  /** Measured input true peak (two-pass) */
  measured_tp?: number;
  /** Measured input loudness range (two-pass) */
  measured_lra?: number;
  /** Measured input threshold (two-pass) */
  measured_thresh?: number;
  /** Offset gain to apply, -99.0 to 99.0. Default: 0.0 */
  offset?: number;
  /** Linear normalization. Default: false (EBU) */
  linear?: boolean;
  /** Print measured loudness to stderr */
  print_format?: 'none' | 'json' | 'summary';
  /** Dual-mono normalization */
  dual_mono?: boolean;
}

export function loudnorm(opts?: LoudnormOptions): string;
export function loudnorm(chain: FilterChain, opts?: LoudnormOptions): FilterChain;
export function loudnorm(chainOrOpts?: FilterChain | LoudnormOptions, opts?: LoudnormOptions): FilterChain | string {
  const isStandalone = !(chainOrOpts instanceof FilterChain);
  const o: LoudnormOptions = (isStandalone ? chainOrOpts : opts) ?? {};
  const named: Record<string, string | number | boolean> = {};
  if (o.i !== undefined) named['i'] = o.i;
  if (o.lra !== undefined) named['lra'] = o.lra;
  if (o.tp !== undefined) named['tp'] = o.tp;
  if (o.measured_i !== undefined) named['measured_i'] = o.measured_i;
  if (o.measured_tp !== undefined) named['measured_tp'] = o.measured_tp;
  if (o.measured_lra !== undefined) named['measured_lra'] = o.measured_lra;
  if (o.measured_thresh !== undefined) named['measured_thresh'] = o.measured_thresh;
  if (o.offset !== undefined) named['offset'] = o.offset;
  if (o.linear !== undefined) named['linear'] = o.linear ? 'true' : 'false';
  if (o.print_format !== undefined) named['print_format'] = o.print_format;
  if (o.dual_mono !== undefined) named['dual_mono'] = o.dual_mono ? 'true' : 'false';
  const node = { name: 'loudnorm', positional: [] as (string|number)[], named };
  if (isStandalone) return serializeNode(node);
  return (chainOrOpts as FilterChain).add(node);
}

// ─── Equalizer ────────────────────────────────────────────────────────────────

export interface EqualizerOptions {
  /** Center frequency in Hz */
  frequency: number;
  /** Bandwidth in octaves (or Hz when bwtype=bwh) */
  width: number;
  /** Width type: o=octave, q=Q-factor, h=Hz, k=kHz, s=slope */
  width_type?: 'o' | 'q' | 'h' | 'k' | 's';
  /** Gain in dB, -900.0 to 900.0 */
  gain: number;
  /** Plane filter flags */
  channels?: string;
  /** Number of poles, 1 or 2. Default: 2 */
  poles?: 1 | 2;
  /** Mix between original and filtered signal */
  mix?: number;
}

export function equalizer(opts: EqualizerOptions): string;
export function equalizer(chain: FilterChain, opts: EqualizerOptions): FilterChain;
export function equalizer(chainOrOpts: FilterChain | EqualizerOptions, opts?: EqualizerOptions): FilterChain | string {
  const isStandalone = !(chainOrOpts instanceof FilterChain);
  const o = isStandalone ? (chainOrOpts as EqualizerOptions) : opts!;
  const named: Record<string, string | number | boolean> = {
    f: o.frequency,
    width: o.width,
    g: o.gain,
  };
  if (o.width_type !== undefined) named['width_type'] = o.width_type;
  if (o.channels !== undefined) named['c'] = o.channels;
  if (o.poles !== undefined) named['p'] = o.poles;
  if (o.mix !== undefined) named['mix'] = o.mix;
  const node = { name: 'equalizer', positional: [] as (string|number)[], named };
  if (isStandalone) return serializeNode(node);
  return (chainOrOpts as FilterChain).add(node);
}

/** Bass/treble boost: positive gain boosts, negative cuts */
export interface BassOptions {
  /** Gain in dB */
  gain: number;
  /** Center frequency. Default: 100Hz (bass) */
  frequency?: number;
  /** Width */
  width?: number;
  width_type?: 'o' | 'q' | 'h' | 's';
}

export function bass(chain: FilterChain, opts: BassOptions): FilterChain {
  const named: Record<string, string | number | boolean> = { g: opts.gain };
  if (opts.frequency !== undefined) named['f'] = opts.frequency;
  if (opts.width !== undefined) named['w'] = opts.width;
  if (opts.width_type !== undefined) named['t'] = opts.width_type;
  return chain.add({ name: 'bass', positional: [], named });
}

export function treble(chain: FilterChain, opts: BassOptions): FilterChain {
  const named: Record<string, string | number | boolean> = { g: opts.gain };
  if (opts.frequency !== undefined) named['f'] = opts.frequency;
  if (opts.width !== undefined) named['w'] = opts.width;
  if (opts.width_type !== undefined) named['t'] = opts.width_type;
  return chain.add({ name: 'treble', positional: [], named });
}

// ─── Afade ────────────────────────────────────────────────────────────────────

export interface AfadeOptions {
  /** Direction: in or out */
  type: 'in' | 'out';
  /** Start sample */
  start_sample?: number;
  /** Number of samples to fade */
  nb_samples?: number;
  /** Start time in seconds */
  start_time?: number | string;
  /** Duration in seconds */
  duration?: number | string;
  /** Fade curve type */
  curve?: 'tri' | 'qsin' | 'hsin' | 'esin' | 'log' | 'ipar' | 'qua'
    | 'cub' | 'squ' | 'cbr' | 'par' | 'exp' | 'iqsin' | 'ihsin' | 'dese'
    | 'desi' | 'losi' | 'sinc' | 'isinc' | 'nofade';
}

export function afade(chain: FilterChain, opts: AfadeOptions): FilterChain {
  const named: Record<string, string | number | boolean> = { type: opts.type };
  if (opts.start_sample !== undefined) named['start_sample'] = opts.start_sample;
  if (opts.nb_samples !== undefined) named['nb_samples'] = opts.nb_samples;
  if (opts.start_time !== undefined) named['start_time'] = opts.start_time;
  if (opts.duration !== undefined) named['duration'] = opts.duration;
  if (opts.curve !== undefined) named['curve'] = opts.curve;
  return chain.add({ name: 'afade', positional: [], named });
}

// ─── Asetpts ──────────────────────────────────────────────────────────────────

/** Modify audio timestamps. Common: 'PTS-STARTPTS', 'NB_CONSUMED_SAMPLES*SR' */
export function asetpts(chain: FilterChain, expr: string): FilterChain {
  return chain.add({ name: 'asetpts', positional: [expr], named: {} });
}

// ─── Atrim ────────────────────────────────────────────────────────────────────

export interface AtrimOptions {
  start?: number | string;
  end?: number | string;
  duration?: number | string;
  start_pts?: number;
  end_pts?: number;
  start_sample?: number;
  end_sample?: number;
}

export function atrim(chain: FilterChain, opts: AtrimOptions): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.start !== undefined) named['start'] = opts.start;
  if (opts.end !== undefined) named['end'] = opts.end;
  if (opts.duration !== undefined) named['duration'] = opts.duration;
  if (opts.start_pts !== undefined) named['start_pts'] = opts.start_pts;
  if (opts.end_pts !== undefined) named['end_pts'] = opts.end_pts;
  return chain.add({ name: 'atrim', positional: [], named });
}

// ─── Amerge ──────────────────────────────────────────────────────────────────

/** Merge N audio streams into a multi-channel stream */
export function amerge(chain: FilterChain, inputs = 2): FilterChain {
  return chain.add({ name: 'amerge', positional: [], named: { inputs } });
}

// ─── Amix ─────────────────────────────────────────────────────────────────────

export interface AmixOptions {
  /** Number of inputs to mix. Default: 2 */
  inputs?: number;
  /** Duration mode: longest, shortest, first */
  duration?: 'longest' | 'shortest' | 'first';
  /** Dropout detection threshold */
  dropout_transition?: number;
  /** Normalize each input's level */
  normalize?: boolean;
  /** Weights per input (space-separated) */
  weights?: string;
}

export function amix(chain: FilterChain, opts: AmixOptions = {}): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.inputs !== undefined) named['inputs'] = opts.inputs;
  if (opts.duration !== undefined) named['duration'] = opts.duration;
  if (opts.dropout_transition !== undefined) named['dropout_transition'] = opts.dropout_transition;
  if (opts.normalize !== undefined) named['normalize'] = opts.normalize ? 1 : 0;
  if (opts.weights !== undefined) named['weights'] = opts.weights;
  return chain.add({ name: 'amix', positional: [], named });
}

// ─── Pan ─────────────────────────────────────────────────────────────────────

/**
 * Pan / remix audio channels using a channel layout expression.
 * @example pan(chain, 'stereo|c0=FL|c1=FR')
 * @example pan(chain, 'stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1')
 */
export function pan(chain: FilterChain, layoutExpr: string): FilterChain {
  return chain.add({ name: 'pan', positional: [layoutExpr], named: {} });
}

// ─── Channelmap / Channelsplit ────────────────────────────────────────────────

export function channelmap(chain: FilterChain, map: string, channelLayout?: string): FilterChain {
  const named: Record<string, string | number | boolean> = { map };
  if (channelLayout !== undefined) named['channel_layout'] = channelLayout;
  return chain.add({ name: 'channelmap', positional: [], named });
}

export function channelsplit(chain: FilterChain, channelLayout?: string): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (channelLayout !== undefined) named['channel_layout'] = channelLayout;
  return chain.add({ name: 'channelsplit', positional: [], named });
}

// ─── Aresample ────────────────────────────────────────────────────────────────

export interface AresampleOptions {
  /** Target sample rate */
  sampleRate?: number;
  /** Resampler: swr (default) or soxr */
  resampler?: 'swr' | 'soxr';
  /** Sample format */
  sample_fmt?: string;
  /** Internal processing precision */
  precision?: number;
}

export function aresample(chain: FilterChain, opts: AresampleOptions | number): FilterChain {
  if (typeof opts === 'number') {
    return chain.add({ name: 'aresample', positional: [opts], named: {} });
  }
  const named: Record<string, string | number | boolean> = {};
  if (opts.sampleRate !== undefined) named['sample_rate'] = opts.sampleRate;
  if (opts.resampler !== undefined) named['resampler'] = opts.resampler;
  if (opts.precision !== undefined) named['precision'] = opts.precision;
  return chain.add({ name: 'aresample', positional: [], named });
}

// ─── Dynaudnorm ───────────────────────────────────────────────────────────────

export interface DynaudnormOptions {
  /** Frame length in ms, 10–8000. Default: 500 */
  framelen?: number;
  /** Gaussian filter window size, 3–301 (odd). Default: 31 */
  gausssize?: number;
  /** Peak value 0.0–1.0. Default: 0.95 */
  peak?: number;
  /** Max gain factor. Default: 10.0 */
  maxgain?: number;
  /** Target RMS value, 0.0–1.0. Default: 0 (disabled) */
  rms?: number;
  /** Compress factor, 0.0–30.0. Default: 0 (disabled) */
  compress?: number;
  /** Threshold. Default: 0 (disabled) */
  threshold?: number;
  /** Channels coupled. Default: true */
  coupling?: boolean;
  /** Correct DC bias. Default: false */
  correctdc?: boolean;
  /** Alternate boundary mode. Default: false */
  altboundary?: boolean;
}

export function dynaudnorm(chain: FilterChain, opts: DynaudnormOptions = {}): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.framelen !== undefined) named['f'] = opts.framelen;
  if (opts.gausssize !== undefined) named['g'] = opts.gausssize;
  if (opts.peak !== undefined) named['p'] = opts.peak;
  if (opts.maxgain !== undefined) named['m'] = opts.maxgain;
  if (opts.rms !== undefined) named['r'] = opts.rms;
  if (opts.compress !== undefined) named['s'] = opts.compress;
  if (opts.threshold !== undefined) named['t'] = opts.threshold;
  if (opts.coupling !== undefined) named['n'] = opts.coupling ? 1 : 0;
  if (opts.correctdc !== undefined) named['c'] = opts.correctdc ? 1 : 0;
  return chain.add({ name: 'dynaudnorm', positional: [], named });
}

// ─── Compand ──────────────────────────────────────────────────────────────────

export interface CompandOptions {
  /** Attack/decay times: "t1,t2 t3,t4 ..." */
  attacks?: string;
  decays?: string;
  /** Transfer function points: "dBin/dBout ..." */
  points?: string;
  /** Soft knee. Default: 0.01 */
  soft_knee?: number;
  /** Gain to apply before companding */
  gain?: number;
  /** Initial volume. Default: 0 */
  initial_volume?: number;
  /** Delay. Default: 0 */
  delay?: number;
}

export function compand(chain: FilterChain, opts: CompandOptions = {}): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.attacks !== undefined) named['attacks'] = opts.attacks;
  if (opts.decays !== undefined) named['decays'] = opts.decays;
  if (opts.points !== undefined) named['points'] = opts.points;
  if (opts.soft_knee !== undefined) named['soft_knee'] = opts.soft_knee;
  if (opts.gain !== undefined) named['gain'] = opts.gain;
  if (opts.delay !== undefined) named['delay'] = opts.delay;
  return chain.add({ name: 'compand', positional: [], named });
}

// ─── Aecho ────────────────────────────────────────────────────────────────────

export interface AechoOptions {
  /** Input gain, 0.0–1.0. Default: 0.6 */
  in_gain?: number;
  /** Output gain, 0.0–1.0. Default: 0.3 */
  out_gain?: number;
  /** Echo delays in ms (comma-separated) */
  delays?: string;
  /** Echo decay factors (comma-separated) */
  decays?: string;
}

export function aecho(chain: FilterChain, opts: AechoOptions = {}): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.in_gain !== undefined) named['in_gain'] = opts.in_gain;
  if (opts.out_gain !== undefined) named['out_gain'] = opts.out_gain;
  if (opts.delays !== undefined) named['delays'] = opts.delays;
  if (opts.decays !== undefined) named['decays'] = opts.decays;
  return chain.add({ name: 'aecho', positional: [], named });
}

// ─── Highpass / Lowpass ───────────────────────────────────────────────────────

export interface PassFilterOptions {
  /** Cutoff frequency in Hz */
  frequency: number;
  /** Bandwidth */
  width?: number;
  width_type?: 'o' | 'q' | 'h' | 's';
  /** Number of poles, 1 or 2. Default: 2 */
  poles?: 1 | 2;
  mix?: number;
}

export function highpass(chain: FilterChain, opts: PassFilterOptions | number): FilterChain {
  if (typeof opts === 'number') {
    return chain.add({ name: 'highpass', positional: [], named: { f: opts } });
  }
  const named: Record<string, string | number | boolean> = { f: opts.frequency };
  if (opts.width !== undefined) named['w'] = opts.width;
  if (opts.width_type !== undefined) named['t'] = opts.width_type;
  if (opts.poles !== undefined) named['p'] = opts.poles;
  if (opts.mix !== undefined) named['m'] = opts.mix;
  return chain.add({ name: 'highpass', positional: [], named });
}

export function lowpass(chain: FilterChain, opts: PassFilterOptions | number): FilterChain {
  if (typeof opts === 'number') {
    return chain.add({ name: 'lowpass', positional: [], named: { f: opts } });
  }
  const named: Record<string, string | number | boolean> = { f: opts.frequency };
  if (opts.width !== undefined) named['w'] = opts.width;
  if (opts.width_type !== undefined) named['t'] = opts.width_type;
  if (opts.poles !== undefined) named['p'] = opts.poles;
  if (opts.mix !== undefined) named['m'] = opts.mix;
  return chain.add({ name: 'lowpass', positional: [], named });
}

// ─── Asplit ───────────────────────────────────────────────────────────────────

/** Split audio into N identical copies */
export function asplit(chain: FilterChain, n = 2): FilterChain {
  return chain.add({ name: 'asplit', positional: [n], named: {} });
}

// ─── Silencedetect ────────────────────────────────────────────────────────────

export interface SilencedetectOptions {
  /** Silence threshold in dB or amplitude. Default: -60dB */
  noise?: string;
  /** Minimum silence duration in seconds. Default: 2 */
  duration?: number;
  /** Mono mode: average all channels */
  mono?: boolean;
}

export function silencedetect(chain: FilterChain, opts: SilencedetectOptions = {}): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.noise !== undefined) named['noise'] = opts.noise;
  if (opts.duration !== undefined) named['duration'] = opts.duration;
  if (opts.mono !== undefined) named['mono'] = opts.mono ? 1 : 0;
  return chain.add({ name: 'silencedetect', positional: [], named });
}

// ─── Rubberband (time/pitch stretch) ─────────────────────────────────────────

export interface RubberbandOptions {
  /** Tempo scale factor. 1.0 = no change, 2.0 = double speed */
  tempo?: number;
  /** Pitch scale factor. 1.0 = no change, 2.0 = octave up */
  pitch?: number;
  /** Transients: crisp, mixed, smooth */
  transients?: 'crisp' | 'mixed' | 'smooth';
  /** Detector: compound, percussive, soft */
  detector?: 'compound' | 'percussive' | 'soft';
  /** Phase: laminar, independent */
  phase?: 'laminar' | 'independent';
  /** Window: standard, short, long */
  window?: 'standard' | 'short' | 'long';
  /** Smoothing: off, on */
  smoothing?: 'off' | 'on';
  /** Formant: shifted, preserved */
  formant?: 'shifted' | 'preserved';
  /** Pitch quality: high, medium, low, very-low */
  pitchq?: 'high' | 'medium' | 'low' | 'very-low';
  /** Engine: faster, finer */
  engine?: 'faster' | 'finer';
}

export function rubberband(chain: FilterChain, opts: RubberbandOptions = {}): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.tempo !== undefined) named['tempo'] = opts.tempo;
  if (opts.pitch !== undefined) named['pitch'] = opts.pitch;
  if (opts.transients !== undefined) named['transients'] = opts.transients;
  if (opts.detector !== undefined) named['detector'] = opts.detector;
  if (opts.phase !== undefined) named['phase'] = opts.phase;
  if (opts.window !== undefined) named['window'] = opts.window;
  if (opts.smoothing !== undefined) named['smoothing'] = opts.smoothing;
  if (opts.formant !== undefined) named['formant'] = opts.formant;
  if (opts.pitchq !== undefined) named['pitchq'] = opts.pitchq;
  if (opts.engine !== undefined) named['engine'] = opts.engine;
  return chain.add({ name: 'rubberband', positional: [], named });
}

// ─── Atempo ───────────────────────────────────────────────────────────────────

/** Change audio playback speed without affecting pitch. Range: 0.5–100.0 */
export function atempo(opts: { tempo: number } | number): string;
export function atempo(chain: FilterChain, factor: number): FilterChain;
export function atempo(chainOrOpts: FilterChain | { tempo: number } | number, factor?: number): FilterChain | string {
  const isStandalone = !(chainOrOpts instanceof FilterChain);
  let f: number;
  if (isStandalone) {
    f = typeof chainOrOpts === 'number' ? chainOrOpts : (chainOrOpts as { tempo: number }).tempo;
    return serializeNode({ name: 'atempo', positional: [f], named: {} });
  }
  f = factor ?? 1;
  return (chainOrOpts as FilterChain).add({ name: 'atempo', positional: [f], named: {} });
}

// ─── Agate ────────────────────────────────────────────────────────────────────

export interface AgateOptions {
  /** Threshold level (dB). Signals below this will be attenuated. Default: -20dB */
  threshold?: number;
  /** Output gain applied in gated region, 0.0–1.0. Default: 0 */
  range?: number;
  /** Level of attack in ms. Default: 20 */
  attack?: number;
  /** Level of release in ms. Default: 250 */
  release?: number;
  /** Knee width in dB. Default: 2.828427125 */
  knee?: number;
  /** Detection mode: peak or rms. Default: rms */
  detection?: 'peak' | 'rms';
  /** Attack mode: peak or rms. Default: peak */
  link?: 'average' | 'maximum';
}

export function agate(chain: FilterChain, opts: AgateOptions = {}): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.threshold !== undefined) named['threshold'] = opts.threshold;
  if (opts.range !== undefined) named['range'] = opts.range;
  if (opts.attack !== undefined) named['attack'] = opts.attack;
  if (opts.release !== undefined) named['release'] = opts.release;
  if (opts.knee !== undefined) named['knee'] = opts.knee;
  if (opts.detection !== undefined) named['detection'] = opts.detection;
  if (opts.link !== undefined) named['link'] = opts.link;
  return chain.add({ name: 'agate', positional: [], named });
}
