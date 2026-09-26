import { runFFmpeg } from '../process/spawn.ts';
import { resolveBinary } from '../utils/binary.ts';

/**
 * Palettes accepted by the `showspectrum` filter's `color` option.
 * These map to ffmpeg's integer enum (0–14) — they are not CSS colours.
 */
export const SPECTRUM_COLORS = [
  'channel',
  'intensity',
  'rainbow',
  'moreland',
  'nebulae',
  'fire',
  'fiery',
  'fruit',
  'cool',
  'magma',
  'green',
  'viridis',
  'plasma',
  'cividis',
  'terrain',
] as const;

export type SpectrumColor = (typeof SPECTRUM_COLORS)[number];

function assertSpectrumColor(color: string): asserts color is SpectrumColor {
  if (!(SPECTRUM_COLORS as readonly string[]).includes(color)) {
    throw new Error(
      `Invalid showspectrum color "${color}". ` +
        `This is a palette name, not a CSS colour. Valid values: ${SPECTRUM_COLORS.join(', ')}.`,
    );
  }
}

export interface WaveformOptions {
  /** Input audio/video file */
  input: string;
  /** Output image path (.png) */
  output: string;
  /** Image width in pixels. Default: 1920 */
  width?: number;
  /** Image height in pixels. Default: 240 */
  height?: number;
  /** Waveform color. Default: '#00ff00' */
  color?: string;
  /**
   * Background color.
   * @deprecated FFmpeg 7.x+ removed the bgcolor parameter from showwavespic.
   * This option is accepted for API compatibility but has no effect.
   */
  backgroundColor?: string;
  /**
   * Drawing mode: 'line', 'point', 'p2p', 'cline'.
   * @deprecated FFmpeg 7.x+ removed the draw parameter from showwavespic.
   * This option is accepted for API compatibility but has no effect.
   */
  mode?: 'line' | 'point' | 'p2p' | 'cline';
  /** Display scale: 'lin' or 'log'. Default: 'lin' */
  scale?: 'lin' | 'log';
  /** Audio stream index. Default: 0 */
  streamIndex?: number;
  /** ffmpeg binary override */
  binary?: string;
}

/**
 * Generate a waveform image from an audio or video file.
 *
 * @example
 * await generateWaveform({
 *   input: 'audio.mp3',
 *   output: 'waveform.png',
 *   width: 1920, height: 240,
 *   color: '#00aaff',
 * });
 */
export async function generateWaveform(opts: WaveformOptions): Promise<void> {
  const {
    input,
    output,
    width = 1920,
    height = 240,
    color = '#00ff00',
    scale = 'lin',
    streamIndex = 0,
    binary = resolveBinary(),
  } = opts;

  if (opts.backgroundColor !== undefined || opts.mode !== undefined) {
    // deno-lint-ignore no-explicit-any
    (globalThis as any).console?.warn?.(
      'WaveformOptions.backgroundColor and .mode are deprecated in FFmpeg 7+ and silently ignored. ' +
      'Remove these options for forward compatibility.',
    );
  }
  const colorArg = color.startsWith('#') ? color.slice(1) : color;
  const filter = `[0:a:${streamIndex}]showwavespic=s=${width}x${height}:colors=${colorArg}:scale=${scale}[v]`;

  const args: string[] = [
    '-y', '-i', input,
    '-filter_complex', filter,
    '-map', '[v]',
    '-frames:v', '1',
    output,
  ];

  await runFFmpeg({ binary, args });
}

/**
 * Generate a real-time audio spectrum visualizer video.
 * Useful for podcasts, music visualizations.
 *
 * @example
 * await generateSpectrum({
 *   input: 'podcast.mp3',
 *   output: 'spectrum.mp4',
 *   width: 1280, height: 720,
 * });
 */
export interface SpectrumOptions {
  input: string;
  output: string;
  width?: number;
  height?: number;
  /**
   * Colour scheme. Default: 'fire'.
   *
   * This is NOT a CSS colour — `showspectrum`'s `color` option is an integer
   * enum of named palettes. Passing e.g. 'red' (or '#ff0000') makes ffmpeg fail
   * with `Undefined constant or missing '(' in 'red'`. Note that 'green' happens
   * to be a valid palette name, which makes the failure mode easy to miss.
   */
  color?: SpectrumColor;
  fps?: number;
  binary?: string;
}

export async function generateSpectrum(opts: SpectrumOptions): Promise<void> {
  const {
    input,
    output,
    width = 1280,
    height = 720,
    color = 'fire',
    fps = 25,
    binary = resolveBinary(),
  } = opts;

  assertSpectrumColor(color);

  const filter = `showspectrum=s=${width}x${height}:color=${color}:fps=${fps}:mode=combined`;

  await runFFmpeg({
    binary,
    args: [
      '-y', '-i', input,
      '-filter_complex', `[0:a]${filter}[v]`,
      '-map', '[v]',
      '-map', '0:a',
      '-c:v', 'libx264', '-c:a', 'aac',
      output,
    ],
  });
}

// ─── Arg builders ─────────────────────────────────────────────────────────────

export function buildWaveformFilter(
  width: number, height: number,
  color: string, scale: string, streamIndex = 0,
): string {
  // NOTE: the color is passed through verbatim here, while generateWaveform()
  // strips a leading '#'. Both forms are accepted by showwavespic, so the
  // builder keeps the caller's value unchanged.
  return `[0:a:${streamIndex}]showwavespic=s=${width}x${height}:colors=${color}:scale=${scale}[v]`;
}

export function buildSpectrumFilter(
  width: number,
  height: number,
  color: SpectrumColor,
  fps: number,
): string {
  assertSpectrumColor(color);
  return `showspectrum=s=${width}x${height}:color=${color}:fps=${fps}:mode=combined`;
}
