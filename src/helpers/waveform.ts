import { runFFmpeg } from '../process/spawn.js';
import { resolveBinary } from '../utils/binary.js';

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
  /** Background color. Default: '#000000' */
  backgroundColor?: string;
  /** Drawing mode: 'line', 'point', 'p2p', 'cline'. Default: 'line' */
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
 *   backgroundColor: '#1a1a2e',
 * });
 */
export async function generateWaveform(opts: WaveformOptions): Promise<void> {
  const {
    input,
    output,
    width = 1920,
    height = 240,
    color = '#00ff00',
    backgroundColor = '#000000',
    mode = 'line',
    scale = 'lin',
    streamIndex = 0,
    binary = resolveBinary(),
  } = opts;

  // Build showwavespic params conditionally — FFmpeg 7.x removed bgcolor and draw
  const params: string[] = [];
  params.push(`s=${width}x${height}`);
  params.push(`colors=${color}`);

  // Only emit bgcolor when it is explicitly non-default (black); FFmpeg 7.x rejects it
  if (backgroundColor && backgroundColor.toLowerCase() !== '#000000') {
    params.push(`bgcolor=${backgroundColor}`);
  }

  params.push(`scale=${scale}`);

  // draw was removed in FFmpeg 7.x — omit when it is the default value
  if (mode && mode !== 'line') {
    params.push(`draw=${mode}`);
  }

  const filter = `[0:a:${streamIndex}]showwavespic=${params.join(':')}[v]`;

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
  color: string, scale: string, mode: string, streamIndex: number,
  backgroundColor?: string,
): string {
  const params: string[] = [];
  params.push(`s=${width}x${height}`);
  params.push(`colors=${color}`);

  if (backgroundColor && backgroundColor.toLowerCase() !== '#000000') {
    params.push(`bgcolor=${backgroundColor}`);
  }

  params.push(`scale=${scale}`);

  if (mode && mode !== 'line') {
    params.push(`draw=${mode}`);
  }

  return `[0:a:${streamIndex}]showwavespic=${params.join(':')}[v]`;
}

export function buildSpectrumFilter(width: number, height: number, color: string, fps: number): string {
  return `showspectrum=s=${width}x${height}:color=${color}:fps=${fps}:mode=combined`;
}
