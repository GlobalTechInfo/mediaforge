import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { runFFmpeg } from '../process/spawn.ts';
import { resolveBinary } from '../utils/binary.ts';

export interface GifOptions {
  /** Input file */
  input: string;
  /** Output GIF path */
  output: string;
  /** Output width. Height auto-scales. Default: 480 */
  width?: number;
  /** Frames per second. Default: 15 */
  fps?: number;
  /** Start time */
  startTime?: string | number;
  /** Duration in seconds */
  duration?: string | number;
  /** Number of colors (2-256). Default: 256 */
  colors?: number;
  /** Dither mode. Default: 'bayer' */
  dither?: 'bayer' | 'floyd_steinberg' | 'sierra2' | 'sierra2_4a' | 'none';
  /** ffmpeg binary override */
  binary?: string;
}

/**
 * Convert video to a high-quality animated GIF using the palette method.
 * Two-pass: first generates an optimal palette, then uses it to dither.
 *
 * @example
 * await toGif({ input: 'clip.mp4', output: 'clip.gif', width: 480, fps: 15 });
 */
export async function toGif(opts: GifOptions): Promise<void> {
  const {
    input,
    output,
    width = 480,
    fps = 15,
    startTime,
    duration,
    colors = 256,
    dither = 'bayer',
    binary = resolveBinary(),
  } = opts;

  const palettePath = path.join(os.tmpdir(), `palette-${Date.now()}.png`);
  const scale = `fps=${fps},scale=${width}:-1:flags=lanczos`;

  try {
    // Pass 1: generate palette
    const pass1Args: string[] = ['-y'];
    if (startTime !== undefined) pass1Args.push('-ss', String(startTime));
    if (duration !== undefined) pass1Args.push('-t', String(duration));
    pass1Args.push(
      '-i', input,
      '-vf', `${scale},palettegen=max_colors=${colors}`,
      palettePath,
    );
    await runFFmpeg({ binary, args: pass1Args });

    // Pass 2: apply palette
    const pass2Args: string[] = ['-y'];
    if (startTime !== undefined) pass2Args.push('-ss', String(startTime));
    if (duration !== undefined) pass2Args.push('-t', String(duration));
    pass2Args.push(
      '-i', input,
      '-i', palettePath,
      '-lavfi', `${scale} [x]; [x][1:v] paletteuse=dither=${dither}`,
      output,
    );
    await runFFmpeg({ binary, args: pass2Args });
  } finally {
    if (fs.existsSync(palettePath)) fs.unlinkSync(palettePath);
  }
}

/**
 * Convert GIF to MP4 (useful for uploading to platforms that don't accept GIF).
 *
 * @example
 * await gifToMp4({ input: 'animation.gif', output: 'animation.mp4' });
 */
export interface GifToMp4Options {
  input: string;
  output: string;
  /** Output width. Default: source width */
  width?: number;
  /** ffmpeg binary override */
  binary?: string;
}

export async function gifToMp4(opts: GifToMp4Options): Promise<void> {
  const { input, output, width, binary = resolveBinary() } = opts;

  const args: string[] = ['-y', '-i', input];

  const filters: string[] = ['scale=trunc(iw/2)*2:trunc(ih/2)*2'];
  if (width) filters.unshift(`scale=${width}:-2:flags=lanczos`);

  args.push(
    '-vf', filters.join(','),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-an',
    output,
  );

  await runFFmpeg({ binary, args });
}

// ─── Arg builders ─────────────────────────────────────────────────────────────

export function buildGifPalettegenFilter(fps: number, width: number, colors: number): string {
  return `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen=max_colors=${colors}`;
}

export function buildGifPaletteuseFilter(fps: number, width: number, dither: string): string {
  const scale = `fps=${fps},scale=${width}:-1:flags=lanczos`;
  return `${scale} [x]; [x][1:v] paletteuse=dither=${dither}`;
}

export function buildGifArgs(
  input: string, palettePath: string, output: string,
  fps: number, width: number, dither: string,
  startTime?: string | number, duration?: string | number,
): { pass1: string[]; pass2: string[] } {
  const pass1: string[] = ['-y'];
  if (startTime !== undefined) pass1.push('-ss', String(startTime));
  if (duration !== undefined) pass1.push('-t', String(duration));
  const scale = `fps=${fps},scale=${width}:-1:flags=lanczos`;
  pass1.push('-i', input, '-vf', `${scale},palettegen`, palettePath);

  const pass2: string[] = ['-y'];
  if (startTime !== undefined) pass2.push('-ss', String(startTime));
  if (duration !== undefined) pass2.push('-t', String(duration));
  pass2.push('-i', input, '-i', palettePath,
    '-lavfi', `${scale} [x]; [x][1:v] paletteuse=dither=${dither}`, output);

  return { pass1, pass2 };
}
