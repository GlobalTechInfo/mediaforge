import { runFFmpeg } from '../process/spawn.ts';
import { resolveBinary } from '../utils/binary.ts';

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

  // FFmpeg 7.x+ removed bgcolor and draw from showwavespic.
  // Only emit s= (size) and colors= — these are stable across v6/v7/v8.
  const filter = `[0:a:${streamIndex}]showwavespic=s=${width}x${height}:colors=${color}:scale=${scale}[v]`;

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
  color?: string;
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
  color: string, scale: string, _mode: string, streamIndex: number,
  _backgroundColor?: string,
): string {
  // bgcolor and draw removed in FFmpeg 7.x+ — never emit them
  return `[0:a:${streamIndex}]showwavespic=s=${width}x${height}:colors=${color}:scale=${scale}[v]`;
}

export function buildSpectrumFilter(width: number, height: number, color: string, fps: number): string {
  return `showspectrum=s=${width}x${height}:color=${color}:fps=${fps}:mode=combined`;
}
