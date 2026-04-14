import { FFmpegBuilder } from '../FFmpeg.js';
import { resolveBinary } from '../utils/binary.js';

export type WatermarkPosition =
  | 'top-left' | 'top-right' | 'top-center'
  | 'bottom-left' | 'bottom-right' | 'bottom-center'
  | 'center'
  | string; // custom overlay expression

export interface WatermarkOptions {
  /** Main video input */
  input: string;
  /** Watermark image path (PNG with transparency recommended) */
  watermark: string;
  /** Output file */
  output: string;
  /** Position. Default: 'bottom-right' */
  position?: WatermarkPosition;
  /** Margin from edges in pixels. Default: 10 */
  margin?: number;
  /** Opacity 0-1. Default: 1 */
  opacity?: number;
  /** Scale watermark to this width (height auto). Optional */
  scaleWidth?: number;
  /** Video codec. Default: 'libx264' */
  videoCodec?: string;
  /** Audio codec. Default: 'copy' */
  audioCodec?: string;
  /** ffmpeg binary override */
  binary?: string;
}

function positionToOverlay(pos: WatermarkPosition, margin: number): string {
  switch (pos) {
    case 'top-left':      return `${margin}:${margin}`;
    case 'top-right':     return `W-w-${margin}:${margin}`;
    case 'top-center':    return `(W-w)/2:${margin}`;
    case 'bottom-left':   return `${margin}:H-h-${margin}`;
    case 'bottom-right':  return `W-w-${margin}:H-h-${margin}`;
    case 'bottom-center': return `(W-w)/2:H-h-${margin}`;
    case 'center':        return `(W-w)/2:(H-h)/2`;
    default:              return pos;
  }
}

/**
 * Add an image watermark to a video.
 *
 * @example
 * await addWatermark({
 *   input: 'video.mp4',
 *   watermark: 'logo.png',
 *   output: 'watermarked.mp4',
 *   position: 'bottom-right',
 *   opacity: 0.7,
 * });
 */
export async function addWatermark(opts: WatermarkOptions): Promise<void> {
  const {
    input,
    watermark,
    output,
    position = 'bottom-right',
    margin = 10,
    opacity = 1,
    scaleWidth,
    videoCodec = 'libx264',
    audioCodec = 'copy',
    binary = resolveBinary(),
  } = opts;

  const overlayExpr = positionToOverlay(position, margin);

  // Build watermark filter chain — collect transforms into an array to avoid
  // trailing-comma bugs (e.g. "format=rgba,colorchannelmixer=aa=0.8,[wm]"
  // creates an empty filter '' that FFmpeg 8.x rejects).
  const transforms: string[] = [];
  if (scaleWidth) transforms.push(`scale=${scaleWidth}:-1`);
  if (opacity < 1) transforms.push('format=rgba', `colorchannelmixer=aa=${opacity}`);
  // Always need at least one filter between [1:v] and [wm]
  if (transforms.length === 0) transforms.push('copy');

  const wmarkFilter = `[1:v]${transforms.join(',')}[wm]`;
  const filterComplex = `${wmarkFilter};[0:v][wm]overlay=${overlayExpr}[out]`;

  await new FFmpegBuilder([input, watermark])
    .output(output)
    .complexFilter(filterComplex)
    .map('[out]')
    .map('0:a?')
    .videoCodec(videoCodec)
    .audioCodec(audioCodec)
    .setBinary(binary)
    .run();
}

/**
 * Add a text watermark to a video.
 *
 * @example
 * await addTextWatermark({
 *   input: 'video.mp4',
 *   output: 'watermarked.mp4',
 *   text: '© MyCompany 2025',
 *   position: 'bottom-right',
 *   fontSize: 24,
 *   fontColor: 'white@0.7',
 * });
 */
export interface TextWatermarkOptions {
  input: string;
  output: string;
  text: string;
  position?: WatermarkPosition;
  margin?: number;
  fontSize?: number;
  fontColor?: string;
  fontFile?: string;
  videoCodec?: string;
  audioCodec?: string;
  binary?: string;
}

export async function addTextWatermark(opts: TextWatermarkOptions): Promise<void> {
  const {
    input,
    output,
    text,
    position = 'bottom-right',
    margin = 10,
    fontSize = 24,
    fontColor = 'white@0.8',
    fontFile,
    videoCodec = 'libx264',
    audioCodec = 'copy',
    binary = resolveBinary(),
  } = opts;

  let x: string, y: string;
  switch (position) {
    case 'top-left':      x = `${margin}`; y = `${margin}`; break;
    case 'top-right':     x = `w-tw-${margin}`; y = `${margin}`; break;
    case 'top-center':    x = `(w-tw)/2`; y = `${margin}`; break;
    case 'bottom-left':   x = `${margin}`; y = `h-th-${margin}`; break;
    case 'bottom-right':  x = `w-tw-${margin}`; y = `h-th-${margin}`; break;
    case 'bottom-center': x = `(w-tw)/2`; y = `h-th-${margin}`; break;
    case 'center':        x = `(w-tw)/2`; y = `(h-th)/2`; break;
    default:              x = `${margin}`; y = `h-th-${margin}`; break;
  }

  const escaped = text.replace(/'/g, '\u2019').replace(/:/g, '\\:');
  let filter = `drawtext=text='${escaped}':fontsize=${fontSize}:fontcolor=${fontColor}:x=${x}:y=${y}`;
  if (fontFile) filter += `:fontfile='${fontFile}'`;

  await new FFmpegBuilder(input)
    .output(output)
    .videoFilter(filter)
    .videoCodec(videoCodec)
    .audioCodec(audioCodec)
    .setBinary(binary)
    .run();
}

// ─── Arg builders ─────────────────────────────────────────────────────────────

export function buildWatermarkFilter(
  position: WatermarkPosition,
  margin: number,
  opacity: number,
  scaleWidth?: number,
): string {
  const overlayExpr = positionToOverlay(position, margin);
  const transforms: string[] = [];
  if (scaleWidth) transforms.push(`scale=${scaleWidth}:-1`);
  if (opacity < 1) transforms.push('format=rgba', `colorchannelmixer=aa=${opacity}`);
  if (transforms.length === 0) transforms.push('copy');
  const wmarkFilter = `[1:v]${transforms.join(',')}[wm]`;
  return `${wmarkFilter};[0:v][wm]overlay=${overlayExpr}[out]`;
}

export function buildTextWatermarkFilter(
  text: string,
  position: WatermarkPosition,
  margin: number,
  fontSize: number,
  fontColor: string,
  fontFile?: string,
): string {
  let x: string, y: string;
  switch (position) {
    case 'top-left':      x = `${margin}`; y = `${margin}`; break;
    case 'top-right':     x = `w-tw-${margin}`; y = `${margin}`; break;
    case 'top-center':    x = `(w-tw)/2`; y = `${margin}`; break;
    case 'bottom-left':   x = `${margin}`; y = `h-th-${margin}`; break;
    case 'bottom-right':  x = `w-tw-${margin}`; y = `h-th-${margin}`; break;
    case 'bottom-center': x = `(w-tw)/2`; y = `h-th-${margin}`; break;
    case 'center':        x = `(w-tw)/2`; y = `(h-th)/2`; break;
    default:              x = `${margin}`; y = `h-th-${margin}`; break;
  }
  const escaped = text.replace(/'/g, '\u2019').replace(/:/g, '\\:');
  let filter = `drawtext=text='${escaped}':fontsize=${fontSize}:fontcolor=${fontColor}:x=${x}:y=${y}`;
  if (fontFile) filter += `:fontfile='${fontFile}'`;
  return filter;
}
