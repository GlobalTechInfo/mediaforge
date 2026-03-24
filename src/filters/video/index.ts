import { FilterChain } from '../../types/filters.js';
import type { PixelFormat } from '../../types/codecs.js';

// ─── Scale ────────────────────────────────────────────────────────────────────

export interface ScaleOptions {
  width: number | string;
  height: number | string;
  /** Scaling algorithm. Default: bicubic */
  flags?: 'fast_bilinear' | 'bilinear' | 'bicubic' | 'experimental'
    | 'neighbor' | 'area' | 'bicublin' | 'gauss' | 'sinc' | 'lanczos' | 'spline';
  /** Force aspect ratio: decrease, increase, or disable */
  force_original_aspect_ratio?: 'disable' | 'decrease' | 'increase';
  /** Force divisibility by N (common: 2) */
  force_divisible_by?: number;
  /** Evaluate expressions: init or frame */
  eval?: 'init' | 'frame';
}

export function scale(chain: FilterChain, opts: ScaleOptions): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.flags !== undefined) named['flags'] = opts.flags;
  if (opts.force_original_aspect_ratio !== undefined)
    named['force_original_aspect_ratio'] = opts.force_original_aspect_ratio;
  if (opts.force_divisible_by !== undefined)
    named['force_divisible_by'] = opts.force_divisible_by;
  if (opts.eval !== undefined) named['eval'] = opts.eval;
  return chain.add({
    name: 'scale',
    positional: [String(opts.width), String(opts.height)],
    named,
  });
}

// ─── Crop ─────────────────────────────────────────────────────────────────────

export interface CropOptions {
  width: number | string;
  height: number | string;
  /** X offset from left. Default: (iw-ow)/2 */
  x?: number | string;
  /** Y offset from top. Default: (ih-oh)/2 */
  y?: number | string;
  /** Keep aspect ratio of the output */
  keep_aspect?: boolean;
  /** Apply cropping to each frame or only once at init */
  exact?: boolean;
}

export function crop(chain: FilterChain, opts: CropOptions): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.x !== undefined) named['x'] = opts.x;
  if (opts.y !== undefined) named['y'] = opts.y;
  if (opts.keep_aspect !== undefined) named['keep_aspect'] = opts.keep_aspect ? 1 : 0;
  if (opts.exact !== undefined) named['exact'] = opts.exact ? 1 : 0;
  return chain.add({
    name: 'crop',
    positional: [String(opts.width), String(opts.height)],
    named,
  });
}

// ─── Pad ──────────────────────────────────────────────────────────────────────

export interface PadOptions {
  width: number | string;
  height: number | string;
  /** X position of input in padded output. Default: 0 */
  x?: number | string;
  /** Y position of input in padded output. Default: 0 */
  y?: number | string;
  /** Pad color. Default: black */
  color?: string;
  /** Aspect ratio */
  aspect?: string;
}

export function pad(chain: FilterChain, opts: PadOptions): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.x !== undefined) named['x'] = opts.x;
  if (opts.y !== undefined) named['y'] = opts.y;
  if (opts.color !== undefined) named['color'] = opts.color;
  if (opts.aspect !== undefined) named['aspect'] = opts.aspect;
  return chain.add({
    name: 'pad',
    positional: [String(opts.width), String(opts.height)],
    named,
  });
}

// ─── Overlay ──────────────────────────────────────────────────────────────────

export interface OverlayOptions {
  /** X position of overlay. Supports expressions like 'main_w-overlay_w-10' */
  x: number | string;
  /** Y position of overlay */
  y: number | string;
  /** Evaluation mode: init or frame */
  eval?: 'init' | 'frame';
  /** Stream timing shortest/longest/first */
  shortest?: boolean;
  /** Format of pixel data */
  format?: 'yuv420' | 'yuv422' | 'yuv444' | 'rgb' | 'gbrp';
  /** Alpha blending: straight or premultiplied */
  alpha?: 'straight' | 'premultiplied';
}

export function overlay(chain: FilterChain, opts: OverlayOptions): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.eval !== undefined) named['eval'] = opts.eval;
  if (opts.shortest !== undefined) named['shortest'] = opts.shortest ? 1 : 0;
  if (opts.format !== undefined) named['format'] = opts.format;
  if (opts.alpha !== undefined) named['alpha'] = opts.alpha;
  return chain.add({
    name: 'overlay',
    positional: [String(opts.x), String(opts.y)],
    named,
  });
}

// ─── Drawtext ─────────────────────────────────────────────────────────────────

export interface DrawtextOptions {
  /** Text string or file expression */
  text?: string;
  /** Path to a text file */
  textfile?: string;
  /** Font file path */
  fontfile?: string;
  /** Font family name */
  font?: string;
  /** Font size. Default: 16 */
  fontsize?: number | string;
  /** Font color. Default: black */
  fontcolor?: string;
  /** Font color with alpha, e.g. 'white@0.5' */
  fontcolor_expr?: string;
  /** Background box color, e.g. 'black@0.5' */
  boxcolor?: string;
  /** Draw background box: 0 or 1 */
  box?: boolean;
  /** Box border width */
  boxborderw?: number;
  /** X position. Supports expressions: 'w-tw-10' */
  x?: number | string;
  /** Y position */
  y?: number | string;
  /** Text shadow color */
  shadowcolor?: string;
  /** Shadow X offset */
  shadowx?: number;
  /** Shadow Y offset */
  shadowy?: number;
  /** Text border width */
  borderw?: number;
  /** Border color */
  bordercolor?: string;
  /** Line spacing */
  line_spacing?: number;
  /** Start drawing text at this time (seconds) */
  enable?: string;
  /** Text expansion mode: none, normal, strftime */
  expansion?: 'none' | 'normal' | 'strftime';
  /** Time code base for timecode mode */
  tc24hmax?: boolean;
  /** Text alignment: left, center, right */
  text_align?: 'left' | 'center' | 'right';
}

export function drawtext(chain: FilterChain, opts: DrawtextOptions): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.text !== undefined) named['text'] = opts.text;
  if (opts.textfile !== undefined) named['textfile'] = opts.textfile;
  if (opts.fontfile !== undefined) named['fontfile'] = opts.fontfile;
  if (opts.font !== undefined) named['font'] = opts.font;
  if (opts.fontsize !== undefined) named['fontsize'] = opts.fontsize;
  if (opts.fontcolor !== undefined) named['fontcolor'] = opts.fontcolor;
  if (opts.fontcolor_expr !== undefined) named['fontcolor_expr'] = opts.fontcolor_expr;
  if (opts.boxcolor !== undefined) named['boxcolor'] = opts.boxcolor;
  if (opts.box !== undefined) named['box'] = opts.box ? 1 : 0;
  if (opts.boxborderw !== undefined) named['boxborderw'] = opts.boxborderw;
  if (opts.x !== undefined) named['x'] = opts.x;
  if (opts.y !== undefined) named['y'] = opts.y;
  if (opts.shadowcolor !== undefined) named['shadowcolor'] = opts.shadowcolor;
  if (opts.shadowx !== undefined) named['shadowx'] = opts.shadowx;
  if (opts.shadowy !== undefined) named['shadowy'] = opts.shadowy;
  if (opts.borderw !== undefined) named['borderw'] = opts.borderw;
  if (opts.bordercolor !== undefined) named['bordercolor'] = opts.bordercolor;
  if (opts.line_spacing !== undefined) named['line_spacing'] = opts.line_spacing;
  if (opts.enable !== undefined) named['enable'] = opts.enable;
  if (opts.expansion !== undefined) named['expansion'] = opts.expansion;
  if (opts.text_align !== undefined) named['text_align'] = opts.text_align;
  return chain.add({ name: 'drawtext', positional: [], named });
}

// ─── FPS ─────────────────────────────────────────────────────────────────────

export interface FpsOptions {
  /** Target frame rate, e.g. 30, '24000/1001', '30000/1001' */
  fps: number | string;
  /** Frame time rounding: zero, inf, down, up, near, auto */
  round?: 'zero' | 'inf' | 'down' | 'up' | 'near' | 'auto';
  /** EOFs action: round, pass */
  eof_action?: 'round' | 'pass';
}

export function fps(chain: FilterChain, opts: FpsOptions): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.round !== undefined) named['round'] = opts.round;
  if (opts.eof_action !== undefined) named['eof_action'] = opts.eof_action;
  return chain.add({ name: 'fps', positional: [String(opts.fps)], named });
}

// ─── Setpts ───────────────────────────────────────────────────────────────────

/** Modify video timestamps. Common: 'PTS-STARTPTS', '2*PTS', 'PTS/2' */
export function setpts(chain: FilterChain, expr: string): FilterChain {
  return chain.add({ name: 'setpts', positional: [expr], named: {} });
}

// ─── Trim ─────────────────────────────────────────────────────────────────────

export interface TrimOptions {
  /** Start time in seconds or HH:MM:SS.mmm */
  start?: number | string;
  /** End time */
  end?: number | string;
  /** Duration */
  duration?: number | string;
  /** Start frame number */
  start_frame?: number;
  /** End frame number */
  end_frame?: number;
}

export function trim(chain: FilterChain, opts: TrimOptions): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.start !== undefined) named['start'] = opts.start;
  if (opts.end !== undefined) named['end'] = opts.end;
  if (opts.duration !== undefined) named['duration'] = opts.duration;
  if (opts.start_frame !== undefined) named['start_frame'] = opts.start_frame;
  if (opts.end_frame !== undefined) named['end_frame'] = opts.end_frame;
  return chain.add({ name: 'trim', positional: [], named });
}

// ─── Format / Setsar / Setdar ─────────────────────────────────────────────────

/** Convert pixel format */
export function format(chain: FilterChain, pixFmt: PixelFormat | PixelFormat[]): FilterChain {
  const fmts = Array.isArray(pixFmt) ? pixFmt.join('|') : pixFmt;
  return chain.add({ name: 'format', positional: [fmts], named: {} });
}

/** Set sample aspect ratio */
export function setsar(chain: FilterChain, ratio: string, max?: number): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (max !== undefined) named['max'] = max;
  return chain.add({ name: 'setsar', positional: [ratio], named });
}

/** Set display aspect ratio */
export function setdar(chain: FilterChain, ratio: string, max?: number): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (max !== undefined) named['max'] = max;
  return chain.add({ name: 'setdar', positional: [ratio], named });
}

// ─── Flip / Rotate ────────────────────────────────────────────────────────────

export function vflip(chain: FilterChain): FilterChain {
  return chain.add({ name: 'vflip', positional: [], named: {} });
}

export function hflip(chain: FilterChain): FilterChain {
  return chain.add({ name: 'hflip', positional: [], named: {} });
}

export interface RotateOptions {
  /** Rotation angle in radians. Supports expressions: 'PI/2', 'PI' */
  angle: number | string;
  /** Output width expression */
  ow?: string;
  /** Output height expression */
  oh?: string;
  /** Fill color for empty areas. Default: black */
  fillcolor?: string;
  /** Use bilinear interpolation */
  bilinear?: boolean;
}

export function rotate(chain: FilterChain, opts: RotateOptions): FilterChain {
  const named: Record<string, string | number | boolean> = {
    a: String(opts.angle),
  };
  if (opts.ow !== undefined) named['ow'] = opts.ow;
  if (opts.oh !== undefined) named['oh'] = opts.oh;
  if (opts.fillcolor !== undefined) named['fillcolor'] = opts.fillcolor;
  if (opts.bilinear !== undefined) named['bilinear'] = opts.bilinear ? 1 : 0;
  return chain.add({ name: 'rotate', positional: [], named });
}

// ─── Transpose ────────────────────────────────────────────────────────────────

/** 0=90CCW+vflip, 1=90CW, 2=90CCW, 3=90CW+vflip, passthrough=none */
export type TransposeDir = 0 | 1 | 2 | 3;

export function transpose(chain: FilterChain, dir: TransposeDir): FilterChain {
  return chain.add({ name: 'transpose', positional: [dir], named: {} });
}

// ─── Sharpening / Blurring ────────────────────────────────────────────────────

export interface UnsharpOptions {
  /** Luma matrix horizontal size, odd 3–23. Default: 5 */
  lx?: number;
  /** Luma matrix vertical size, odd 3–23. Default: 5 */
  ly?: number;
  /** Luma effect strength, -1.5 to 1.5. Default: 1.0 (sharpen) */
  la?: number;
  /** Chroma horizontal size */
  cx?: number;
  /** Chroma vertical size */
  cy?: number;
  /** Chroma effect strength */
  ca?: number;
  /** Alpha horizontal size */
  ax?: number;
  /** Alpha vertical size */
  ay?: number;
  /** Alpha effect strength */
  aa?: number;
}

export function unsharp(chain: FilterChain, opts: UnsharpOptions = {}): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.lx !== undefined) named['lx'] = opts.lx;
  if (opts.ly !== undefined) named['ly'] = opts.ly;
  if (opts.la !== undefined) named['la'] = opts.la;
  if (opts.cx !== undefined) named['cx'] = opts.cx;
  if (opts.cy !== undefined) named['cy'] = opts.cy;
  if (opts.ca !== undefined) named['ca'] = opts.ca;
  return chain.add({ name: 'unsharp', positional: [], named });
}

export interface GblurOptions {
  /** Gaussian blur sigma, 0.01–1024. Default: 0.5 */
  sigma?: number;
  /** Number of steps, 1–6. Default: 1 */
  steps?: number;
  /** Plane filter flags: 0x1=Y 0x2=U 0x4=V 0x8=A */
  planes?: number;
  /** Horizontal sigma (overrides sigma) */
  sigmaV?: number;
}

export function gblur(chain: FilterChain, opts: GblurOptions = {}): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.sigma !== undefined) named['sigma'] = opts.sigma;
  if (opts.steps !== undefined) named['steps'] = opts.steps;
  if (opts.planes !== undefined) named['planes'] = opts.planes;
  if (opts.sigmaV !== undefined) named['sigmaV'] = opts.sigmaV;
  return chain.add({ name: 'gblur', positional: [], named });
}

export interface BoxblurOptions {
  /** Luma radius expression. Default: 2 */
  luma_radius?: number | string;
  /** Luma power. Default: 2 */
  luma_power?: number;
  /** Chroma radius */
  chroma_radius?: number | string;
  /** Chroma power */
  chroma_power?: number;
  /** Alpha radius */
  alpha_radius?: number | string;
  /** Alpha power */
  alpha_power?: number;
}

export function boxblur(chain: FilterChain, opts: BoxblurOptions = {}): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.luma_radius !== undefined) named['luma_radius'] = opts.luma_radius;
  if (opts.luma_power !== undefined) named['luma_power'] = opts.luma_power;
  if (opts.chroma_radius !== undefined) named['chroma_radius'] = opts.chroma_radius;
  if (opts.chroma_power !== undefined) named['chroma_power'] = opts.chroma_power;
  return chain.add({ name: 'boxblur', positional: [], named });
}

// ─── Eq (equalizer / color correction) ───────────────────────────────────────

export interface EqOptions {
  /** Brightness, -1.0 to 1.0. Default: 0 */
  brightness?: number | string;
  /** Contrast, -1000.0 to 1000.0. Default: 1 */
  contrast?: number | string;
  /** Saturation, 0.0 to 3.0. Default: 1 */
  saturation?: number | string;
  /** Gamma, 0.1 to 10.0. Default: 1 */
  gamma?: number | string;
  /** Gamma weight, 0.0 to 1.0. Default: 1 */
  gamma_weight?: number | string;
  /** Red gamma */
  gamma_r?: number | string;
  /** Green gamma */
  gamma_g?: number | string;
  /** Blue gamma */
  gamma_b?: number | string;
  /** Evaluate mode: init or frame */
  eval?: 'init' | 'frame';
}

export function eq(chain: FilterChain, opts: EqOptions): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.brightness !== undefined) named['brightness'] = opts.brightness;
  if (opts.contrast !== undefined) named['contrast'] = opts.contrast;
  if (opts.saturation !== undefined) named['saturation'] = opts.saturation;
  if (opts.gamma !== undefined) named['gamma'] = opts.gamma;
  if (opts.gamma_weight !== undefined) named['gamma_weight'] = opts.gamma_weight;
  if (opts.gamma_r !== undefined) named['gamma_r'] = opts.gamma_r;
  if (opts.gamma_g !== undefined) named['gamma_g'] = opts.gamma_g;
  if (opts.gamma_b !== undefined) named['gamma_b'] = opts.gamma_b;
  if (opts.eval !== undefined) named['eval'] = opts.eval;
  return chain.add({ name: 'eq', positional: [], named });
}

// ─── Hue / Colorbalance / Curves ─────────────────────────────────────────────

export interface HueOptions {
  /** Hue angle in degrees */
  h?: number | string;
  /** Saturation multiplier */
  s?: number | string;
  /** Brightness multiplier */
  b?: number | string;
}

export function hue(chain: FilterChain, opts: HueOptions): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.h !== undefined) named['h'] = opts.h;
  if (opts.s !== undefined) named['s'] = opts.s;
  if (opts.b !== undefined) named['b'] = opts.b;
  return chain.add({ name: 'hue', positional: [], named });
}

export interface ColorbalanceOptions {
  /** Shadow red adjustment, -1.0 to 1.0 */
  rs?: number; gs?: number; bs?: number;
  /** Midtone adjustments */
  rm?: number; gm?: number; bm?: number;
  /** Highlight adjustments */
  rh?: number; gh?: number; bh?: number;
}

export function colorbalance(chain: FilterChain, opts: ColorbalanceOptions): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(opts)) {
    if (v !== undefined) named[k] = v;
  }
  return chain.add({ name: 'colorbalance', positional: [], named });
}

// ─── Deinterlace ──────────────────────────────────────────────────────────────

export interface YadifOptions {
  /** Mode: 0=send frame, 1=send field, 2=send frame nospatial, 3=send field nospatial */
  mode?: 0 | 1 | 2 | 3;
  /** Parity: -1=auto, 0=TFF, 1=BFF */
  parity?: -1 | 0 | 1;
  /** Deint: 0=all frames, 1=only interlaced frames */
  deint?: 0 | 1;
}

export function yadif(chain: FilterChain, opts: YadifOptions = {}): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.mode !== undefined) named['mode'] = opts.mode;
  if (opts.parity !== undefined) named['parity'] = opts.parity;
  if (opts.deint !== undefined) named['deint'] = opts.deint;
  return chain.add({ name: 'yadif', positional: [], named });
}

// ─── Denoise ─────────────────────────────────────────────────────────────────

export interface HqdenOptions {
  /** Strength for Y component */
  s0?: number;
  /** Strength for U component */
  s1?: number;
  /** Strength for V component */
  s2?: number;
  /** Strength for A component */
  s3?: number;
}

export function hqdn3d(chain: FilterChain, opts: HqdenOptions = {}): FilterChain {
  // hqdn3d positional: luma_spatial:chroma_spatial:luma_tmp:chroma_tmp
  const pos: number[] = [];
  if (opts.s0 !== undefined) pos.push(opts.s0);
  if (opts.s1 !== undefined) pos.push(opts.s1);
  if (opts.s2 !== undefined) pos.push(opts.s2);
  if (opts.s3 !== undefined) pos.push(opts.s3);
  return chain.add({ name: 'hqdn3d', positional: pos, named: {} });
}

export interface NlmeansOptions {
  /** Denoising strength (h): 1–30. Default: 8 */
  h?: number;
  /** Research window size (patch): 3–99. Default: 7 */
  r?: number;
  /** Patch size: 3–99. Default: 3 */
  p?: number;
  /** Plane filter flags */
  s?: number;
}

export function nlmeans(chain: FilterChain, opts: NlmeansOptions = {}): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.h !== undefined) named['h'] = opts.h;
  if (opts.r !== undefined) named['r'] = opts.r;
  if (opts.p !== undefined) named['p'] = opts.p;
  if (opts.s !== undefined) named['s'] = opts.s;
  return chain.add({ name: 'nlmeans', positional: [], named });
}

// ─── Thumbnail ────────────────────────────────────────────────────────────────

/** Select the best frame from a group of N frames for thumbnail generation */
export function thumbnail(chain: FilterChain, n = 100): FilterChain {
  return chain.add({ name: 'thumbnail', positional: [n], named: {} });
}

// ─── Select ──────────────────────────────────────────────────────────────────

/** Select specific frames using an expression, e.g. 'not(mod(n,10))' */
export function select(chain: FilterChain, expr: string): FilterChain {
  return chain.add({ name: 'select', positional: [expr], named: {} });
}

// ─── Concat ──────────────────────────────────────────────────────────────────

export interface ConcatOptions {
  /** Number of segments. Default: 2 */
  n?: number;
  /** Number of video streams per segment. Default: 1 */
  v?: number;
  /** Number of audio streams per segment. Default: 0 */
  a?: number;
  /** Use unsafe mode (allow differing properties) */
  unsafe?: boolean;
}

export function concat(chain: FilterChain, opts: ConcatOptions = {}): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.n !== undefined) named['n'] = opts.n;
  if (opts.v !== undefined) named['v'] = opts.v;
  if (opts.a !== undefined) named['a'] = opts.a;
  if (opts.unsafe === true) named['unsafe'] = 1;
  return chain.add({ name: 'concat', positional: [], named });
}

// ─── Split ────────────────────────────────────────────────────────────────────

/** Split a video into N identical copies for multi-output filter graphs */
export function split(chain: FilterChain, n = 2): FilterChain {
  return chain.add({ name: 'split', positional: [n], named: {} });
}

// ─── Tile ─────────────────────────────────────────────────────────────────────

export interface TileOptions {
  /** Grid layout as "COLSxROWS", e.g. "4x3" */
  layout: string;
  /** Number of frames to batch. Default: same as grid cells */
  nb_frames?: number;
  /** Pixel gap between tiles */
  margin?: number;
  /** Padding between tiles */
  padding?: number;
  /** Background color */
  color?: string;
  /** Overlap rows/columns from previous tile */
  overlap?: number;
  /** Initial padding */
  init_padding?: number;
}

export function tile(chain: FilterChain, opts: TileOptions): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.nb_frames !== undefined) named['nb_frames'] = opts.nb_frames;
  if (opts.margin !== undefined) named['margin'] = opts.margin;
  if (opts.padding !== undefined) named['padding'] = opts.padding;
  if (opts.color !== undefined) named['color'] = opts.color;
  if (opts.overlap !== undefined) named['overlap'] = opts.overlap;
  return chain.add({ name: 'tile', positional: [opts.layout], named });
}

// ─── Colorkey / Chromakey ─────────────────────────────────────────────────────

export interface ColorKeyOptions {
  /** Color to key out, e.g. '#00ff00', 'green' */
  color: string;
  /** Similarity threshold, 0.01–1.0 */
  similarity?: number;
  /** Blend amount, 0.0–1.0 */
  blend?: number;
}

export function colorkey(chain: FilterChain, opts: ColorKeyOptions): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.similarity !== undefined) named['similarity'] = opts.similarity;
  if (opts.blend !== undefined) named['blend'] = opts.blend;
  return chain.add({ name: 'colorkey', positional: [opts.color], named });
}

export function chromakey(chain: FilterChain, opts: ColorKeyOptions): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.similarity !== undefined) named['similarity'] = opts.similarity;
  if (opts.blend !== undefined) named['blend'] = opts.blend;
  return chain.add({ name: 'chromakey', positional: [opts.color], named });
}

// ─── Subtitles ────────────────────────────────────────────────────────────────

export interface SubtitleOptions {
  /** Path to subtitle file */
  filename: string;
  /** Stream index in the subtitle file */
  si?: number;
  /** Original video size (for ASS rendering) */
  original_size?: string;
  /** Character encoding */
  charenc?: string;
  /** Force style override */
  force_style?: string;
}

export function subtitles(chain: FilterChain, opts: SubtitleOptions): FilterChain {
  const named: Record<string, string | number | boolean> = { filename: opts.filename };
  if (opts.si !== undefined) named['si'] = opts.si;
  if (opts.original_size !== undefined) named['original_size'] = opts.original_size;
  if (opts.charenc !== undefined) named['charenc'] = opts.charenc;
  if (opts.force_style !== undefined) named['force_style'] = opts.force_style;
  return chain.add({ name: 'subtitles', positional: [], named });
}

// ─── Vulkan filters (v8+) ─────────────────────────────────────────────────────

export interface AvgblurVulkanOptions {
  /** Horizontal radius. Default: 3 */
  sizeX?: number;
  /** Vertical radius. Default: same as sizeX */
  sizeY?: number;
  /** Plane filter flags */
  planes?: number;
}

export function avgblurVulkan(chain: FilterChain, opts: AvgblurVulkanOptions = {}): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.sizeX !== undefined) named['sizeX'] = opts.sizeX;
  if (opts.sizeY !== undefined) named['sizeY'] = opts.sizeY;
  if (opts.planes !== undefined) named['planes'] = opts.planes;
  return chain.add({ name: 'avgblur_vulkan', positional: [], named });
}

export function nlmeansVulkan(chain: FilterChain, opts: NlmeansOptions = {}): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.h !== undefined) named['h'] = opts.h;
  if (opts.r !== undefined) named['r'] = opts.r;
  if (opts.p !== undefined) named['p'] = opts.p;
  return chain.add({ name: 'nlmeans_vulkan', positional: [], named });
}

// ─── Fade ─────────────────────────────────────────────────────────────────────

export interface FadeOptions {
  /** Direction: in or out */
  type: 'in' | 'out';
  /** Frame number to start fade */
  start_frame?: number;
  /** Number of frames for fade */
  nb_frames?: number;
  /** Start time in seconds (alternative to start_frame) */
  start_time?: number | string;
  /** Duration in seconds (alternative to nb_frames) */
  duration?: number | string;
  /** Fade color. Default: black */
  color?: string;
  /** Apply to alpha channel */
  alpha?: boolean;
}

export function fade(chain: FilterChain, opts: FadeOptions): FilterChain {
  const named: Record<string, string | number | boolean> = { type: opts.type };
  if (opts.start_frame !== undefined) named['start_frame'] = opts.start_frame;
  if (opts.nb_frames !== undefined) named['nb_frames'] = opts.nb_frames;
  if (opts.start_time !== undefined) named['start_time'] = opts.start_time;
  if (opts.duration !== undefined) named['duration'] = opts.duration;
  if (opts.color !== undefined) named['color'] = opts.color;
  if (opts.alpha !== undefined) named['alpha'] = opts.alpha ? 1 : 0;
  return chain.add({ name: 'fade', positional: [], named });
}

// ─── Zoompan ──────────────────────────────────────────────────────────────────

export interface ZoompanOptions {
  /** Zoom expression, e.g. 'min(zoom+0.0015,1.5)' */
  zoom?: string;
  /** X pan expression */
  x?: string;
  /** Y pan expression */
  y?: string;
  /** Output duration in frames */
  d?: number;
  /** Output frame size */
  s?: string;
  /** Frame rate */
  fps?: number | string;
}

export function zoompan(chain: FilterChain, opts: ZoompanOptions = {}): FilterChain {
  const named: Record<string, string | number | boolean> = {};
  if (opts.zoom !== undefined) named['zoom'] = opts.zoom;
  if (opts.x !== undefined) named['x'] = opts.x;
  if (opts.y !== undefined) named['y'] = opts.y;
  if (opts.d !== undefined) named['d'] = opts.d;
  if (opts.s !== undefined) named['s'] = opts.s;
  if (opts.fps !== undefined) named['fps'] = opts.fps;
  return chain.add({ name: 'zoompan', positional: [], named });
}
