/**
 * Named encode presets — opinionated, production-ready settings.
 * Each preset returns args arrays for use with .addOutputOption().
 */

export type PresetName =
  | 'web'        // H.264 + AAC, browser-safe, fast seek
  | 'web-hq'     // H.264 + AAC, higher quality
  | 'mobile'     // H.264 baseline, AAC mono/stereo, small file
  | 'archive'    // Lossless H.264 (CRF 0) + FLAC
  | 'podcast'    // Audio only, mono AAC 96k
  | 'hls-input'  // H.264 for HLS ingest
  | 'gif'        // Animated GIF via palette
  | 'discord'    // Discord-friendly: H.264 + AAC, 8MB limit friendly
  | 'instagram'  // Instagram-friendly: H.264, 1:1 or 4:5, AAC
  | 'prores'     // ProRes 422 HQ for editing
  | 'dnxhd'      // DNxHD 115 for editing

export interface PresetResult {
  videoArgs: string[];
  audioArgs: string[];
  extraArgs: string[];
}

const PRESETS: Record<PresetName, PresetResult> = {
  'web': {
    videoArgs: ['-c:v', 'libx264', '-crf', '23', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'],
    audioArgs: ['-c:a', 'aac', '-b:a', '128k', '-ar', '44100'],
    extraArgs: [],
  },
  'web-hq': {
    videoArgs: ['-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'],
    audioArgs: ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000'],
    extraArgs: [],
  },
  'mobile': {
    videoArgs: ['-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.0', '-crf', '28', '-preset', 'fast', '-pix_fmt', 'yuv420p'],
    audioArgs: ['-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-ac', '2'],
    extraArgs: ['-movflags', '+faststart'],
  },
  'archive': {
    videoArgs: ['-c:v', 'libx264', '-crf', '0', '-preset', 'veryslow', '-pix_fmt', 'yuv420p'],
    audioArgs: ['-c:a', 'flac'],
    extraArgs: [],
  },
  'podcast': {
    videoArgs: ['-vn'],
    audioArgs: ['-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-ac', '1'],
    extraArgs: [],
  },
  'hls-input': {
    videoArgs: ['-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-g', '48', '-keyint_min', '48', '-sc_threshold', '0'],
    audioArgs: ['-c:a', 'aac', '-b:a', '128k', '-ar', '44100'],
    extraArgs: [],
  },
  'gif': {
    videoArgs: [],
    audioArgs: ['-an'],
    extraArgs: [],
  },
  'discord': {
    videoArgs: ['-c:v', 'libx264', '-crf', '24', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'],
    audioArgs: ['-c:a', 'aac', '-b:a', '128k'],
    extraArgs: [],
  },
  'instagram': {
    videoArgs: ['-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'],
    audioArgs: ['-c:a', 'aac', '-b:a', '128k', '-ar', '44100'],
    extraArgs: [],
  },
  'prores': {
    videoArgs: ['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le'],
    audioArgs: ['-c:a', 'pcm_s24le'],
    extraArgs: [],
  },
  'dnxhd': {
    videoArgs: ['-c:v', 'dnxhd', '-vb', '115M', '-pix_fmt', 'yuv422p'],
    audioArgs: ['-c:a', 'pcm_s16le'],
    extraArgs: [],
  },
};

/**
 * Get args for a named preset.
 *
 * @example
 * import { ffmpeg, getPreset } from 'mediaforge';
 * const p = getPreset('web');
 * await ffmpeg('input.mp4')
 *   .output('output.mp4')
 *   .addOutputOption(...p.videoArgs)
 *   .addOutputOption(...p.audioArgs)
 *   .addOutputOption(...p.extraArgs)
 *   .run();
 */
export function getPreset(name: PresetName): PresetResult {
  const p = PRESETS[name];
  if (!p) throw new Error(`Unknown preset: "${name}". Available: ${Object.keys(PRESETS).join(', ')}`);
  return { videoArgs: [...p.videoArgs], audioArgs: [...p.audioArgs], extraArgs: [...p.extraArgs] };
}

/** List all available preset names */
export function listPresets(): PresetName[] {
  return Object.keys(PRESETS) as PresetName[];
}

/** Apply a preset to an FFmpegBuilder — returns flat arg array */
export function applyPreset(name: PresetName): string[] {
  const p = getPreset(name);
  return [...p.videoArgs, ...p.audioArgs, ...p.extraArgs];
}
