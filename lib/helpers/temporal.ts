/**
 * Temporal video processing: frame-rate interpolation, scene-driven cutting,
 * silence removal, and segment-muxer output.
 *
 * These are the "consume the analysis" operations that pair with
 * `detectScenes()` / `detectSilence()` in `normalize.ts` — the analysis helpers
 * tell you *where* something happens, these act on it.
 */
import { spawnFFmpeg, runFFmpeg } from '../process/spawn.ts';
import { resolveBinary } from '../utils/binary.ts';
import { FFmpegBuilder } from '../FFmpeg.ts';
import { parseAllProgress } from '../process/progress.ts';
import { detectScenes, type SceneChange } from './normalize.ts';
import type { SilenceSegment } from './normalize.ts';
import { probeAsync } from '../probe/ffprobe.ts';
import { resolveProbe } from '../utils/binary.ts';

/**
 * The input length in microseconds, for the progress parser.
 *
 * Returns an empty fragment when the file cannot be probed: the caller still
 * gets `out_time`, it just has no percentage to divide by.
 */
async function durationUs(input: string): Promise<{ totalDurationUs?: number }> {
  try {
    const info = await probeAsync(input, { binary: resolveProbe() });
    const seconds = info.format?.duration;
    return seconds !== undefined ? { totalDurationUs: Math.round(parseFloat(seconds) * 1_000_000) } : {};
  } catch {
    return {};
  }
}

// ─── Frame interpolation ─────────────────────────────────────────────────────

/**
 * Motion-interpolation mode (`minterpolate`'s `mi_mode`).
 *
 * 'mci' synthesises new frames with motion compensation (the good one),
 * 'blend' cross-fades the nearest two frames (fast, some ghosting), and 'dup'
 * simply repeats frames.
 */
export type InterpolationMethod = 'mci' | 'blend' | 'dup';

/** Motion-compensation mode (`mc_mode`). */
export type McMode = 'obmc' | 'aobmc';

/** Motion-estimation mode (`me_mode`). */
export type MeMode = 'bidir' | 'bilat';

export interface InterpolateOptions {
  input: string;
  output: string;
  /** Playback frame rate to interpolate to, e.g. 60. */
  fps: number;
  /** Interpolation algorithm. Default: 'mci' (best quality) */
  method?: InterpolationMethod;
  /** Motion-compensation mode, used only when method is 'mci'. Default: 'obmc' */
  mcMode?: McMode;
  /** Motion-estimation mode, used only when method is 'mci'. Default: 'bidir' */
  meMode?: MeMode;
  /** Block size in pixels for motion estimation. Default: 8 */
  mbSize?: number;
  /** Motion-estimation search method. Default: 'epzs' */
  meMethod?: string;
  videoCodec?: string;
  audioCodec?: string;
  binary?: string;
  onProgress?: (percent: number) => void;
}

const INTERP_METHODS: readonly InterpolationMethod[] = ['mci', 'blend', 'dup'];
const MC_MODES: readonly McMode[] = ['obmc', 'aobmc'];
const ME_MODES: readonly MeMode[] = ['bidir', 'bilat'];

/** Build a `minterpolate` filter string. */
export function buildInterpolateFilter(opts: {
  fps: number;
  method?: InterpolationMethod;
  mcMode?: McMode;
  meMode?: MeMode;
  mbSize?: number;
  meMethod?: string;
}): string {
  const { fps, method = 'mci', mcMode = 'obmc', meMode = 'bidir', mbSize = 8, meMethod } = opts;

  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError(`buildInterpolateFilter: fps must be a positive finite number, got ${fps}`);
  }
  if (!INTERP_METHODS.includes(method)) {
    throw new Error(
      `buildInterpolateFilter: unknown method "${method}". Valid: ${INTERP_METHODS.join(', ')}`,
    );
  }
  if (!MC_MODES.includes(mcMode)) {
    throw new Error(`buildInterpolateFilter: unknown mcMode "${mcMode}". Valid: ${MC_MODES.join(', ')}`);
  }
  if (!ME_MODES.includes(meMode)) {
    throw new Error(`buildInterpolateFilter: unknown meMode "${meMode}". Valid: ${ME_MODES.join(', ')}`);
  }
  if (!Number.isInteger(mbSize) || mbSize < 4) {
    throw new RangeError(`buildInterpolateFilter: mbSize must be an integer >= 4, got ${mbSize}`);
  }

  const parts = [`fps=${fps}`, `mi_mode=${method}`];
  // mb_size/me are only meaningful for motion-compensated interpolation;
  // emitting them for dup/blend is rejected by ffmpeg.
  if (method === 'mci') {
    parts.push(`mc_mode=${mcMode}`, `me_mode=${meMode}`, `mb_size=${mbSize}`);
    if (meMethod !== undefined) parts.push(`me=${meMethod}`);
  }
  return `minterpolate=${parts.join(':')}`;
}

/**
 * Interpolate a video to a higher frame rate with motion compensation.
 *
 * This is the correct way to make slow-motion (or a 24→60fps conversion) rather
 * than duplicating frames, though it is significantly slower than a plain
 * `fps` conversion.
 */
export async function interpolateFrames(opts: InterpolateOptions): Promise<void> {
  const {
    input,
    output,
    fps,
    method = 'mci',
    mcMode,
    meMode,
    mbSize = 8,
    meMethod,
    videoCodec = 'libx264',
    audioCodec = 'aac',
    binary = resolveBinary(),
    onProgress,
  } = opts;

  const filterOpts: Parameters<typeof buildInterpolateFilter>[0] = { fps, method, mbSize };
  if (mcMode !== undefined) filterOpts.mcMode = mcMode;
  if (meMode !== undefined) filterOpts.meMode = meMode;
  if (meMethod !== undefined) filterOpts.meMethod = meMethod;
  const filter = buildInterpolateFilter(filterOpts);

  if (onProgress) {
    // The parser only produces a percentage when it knows the total, so probe
    // once here: without it every callback carries `percent: undefined`.
    const proc = spawnFFmpeg({
      binary,
      args: buildArgs(input, output, filter, videoCodec, audioCodec),
      parseProgress: true,
      ...await durationUs(input),
    });
    proc.emitter.on('progress', info => {
      if (info.percent !== undefined) onProgress(info.percent);
    });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; proc.kill(); reject(new Error('interpolateFrames timed out')); }
      }, 3_600_000);
      proc.emitter.on('end', () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } });
      proc.emitter.on('error', e => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } });
    });
    return;
  }

  await runFFmpeg({ binary, args: buildArgs(input, output, filter, videoCodec, audioCodec) });
}

function buildArgs(input: string, output: string, filter: string, videoCodec: string, audioCodec: string): string[] {
  return [
    '-y', '-i', input,
    '-vf', filter,
    '-c:v', videoCodec,
    '-c:a', audioCodec,
    output,
  ];
}

// ─── Scene-driven cutting ────────────────────────────────────────────────────

export interface CutToScenesOptions {
  input: string;
  output: string;
  /** Scene-change detection threshold, 0-1. Default: 0.4 */
  threshold?: number;
  /** Skip the first N seconds of every clip. Default: 0 */
  trimStart?: number;
  /** Stop at this time. */
  endTime?: number;
  videoCodec?: string;
  audioCodec?: string;
  binary?: string;
  onProgress?: (percent: number) => void;
}

/**
 * Build the `-ss`/`-to` seek arguments for a set of scene windows.
 *
 * A scene-change list marks the *boundaries* between scenes, so the windows are
 * `[0, s0], [s0, s1], …, [sn, end]` — the clip before the first boundary runs
 * from the start of the file, not from the boundary.
 *
 * `trimStart` shortens each window from its end, which is what you want for
 * dropping the static tail that usually follows a hard cut.
 *
 * Exported separately so the exact cuts can be asserted without running ffmpeg.
 */
export function buildSceneCutArgs(
  scenes: SceneChange[],
  opts: { trimStart?: number; endTime?: number } = {},
): string[] {
  const { trimStart = 0, endTime } = opts;
  if (trimStart < 0) throw new RangeError(`buildSceneCutArgs: trimStart must be >= 0, got ${trimStart}`);

  // Boundaries in ascending order, de-duplicated.
  const bounds = [...new Set(scenes.map(s => s.timestamp))].sort((a, b) => a - b);

  const args: string[] = [];
  let start = 0;
  for (const boundary of bounds) {
    const end = endTime !== undefined ? Math.min(boundary, endTime) : boundary;
    if (end - trimStart > start) {
      args.push('-ss', start.toFixed(3), '-to', (end - trimStart).toFixed(3));
    }
    start = end;
  }
  return args;
}

/**
 * Cut the input into one clip per detected scene, then concatenate them.
 *
 * This is the "auto-edit" counterpart to `detectScenes()`: instead of learning
 * where the cuts are, it uses them as an edit decision list.
 */
export async function cutToScenes(opts: CutToScenesOptions): Promise<void> {
  const {
    input,
    output,
    threshold = 0.4,
    trimStart = 0,
    endTime,
    videoCodec = 'libx264',
    audioCodec = 'aac',
    binary = resolveBinary(),
    onProgress,
  } = opts;

  const scenes = await detectScenes({ input, threshold, binary });
  if (scenes.length === 0) {
    throw new Error('cutToScenes: no scene changes were detected, so there is nothing to cut');
  }

  const args = buildSceneCutArgs(
    scenes,
    endTime !== undefined ? { trimStart, endTime } : { trimStart },
  );
  if (args.length === 0) {
    throw new Error('cutToScenes: every detected window was empty after trimming');
  }

  const runArgs = [
    '-y', '-i', input,
    ...args,
    '-c:v', videoCodec,
    '-c:a', audioCodec,
    '-map', '0',
    output,
  ];

  if (onProgress) {
    const proc = spawnFFmpeg({ binary, args: runArgs, parseProgress: true, ...await durationUs(input) });
    proc.emitter.on('progress', i => { if (i.percent !== undefined) onProgress(i.percent); });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; proc.kill(); reject(new Error('cutToScenes timed out')); } }, 3_600_000);
      proc.emitter.on('end', () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } });
      proc.emitter.on('error', e => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } });
    });
    return;
  }
  await runFFmpeg({ binary, args: runArgs });
}

// ─── Silence removal ─────────────────────────────────────────────────────────

export interface RemoveSilenceOptions {
  input: string;
  output: string;
  /** dB threshold for what counts as silence. Default: -50 */
  threshold?: number;
  /** Minimum silence length in seconds. Default: 0.5 */
  minDuration?: number;
  /** Also drop the audio track (video-only output). Default: false */
  videoOnly?: boolean;
  videoCodec?: string;
  audioCodec?: string;
  binary?: string;
  onProgress?: (percent: number) => void;
}

/** Build the `silenceremove` filter from a threshold and duration. */
export function buildSilenceRemoveFilter(opts: { threshold?: number; minDuration?: number } = {}): string {
  const { threshold = -50, minDuration = 0.5 } = opts;
  if (!Number.isFinite(threshold) || threshold > 0 || threshold < -200) {
    throw new RangeError(`buildSilenceRemoveFilter: threshold must be a dB value in (-200, 0], got ${threshold}`);
  }
  if (!Number.isFinite(minDuration) || minDuration <= 0) {
    throw new RangeError(`buildSilenceRemoveFilter: minDuration must be a positive number, got ${minDuration}`);
  }
  // stop_periods: drop [start, end] pairs. ffmpeg's silenceremove takes
  // start= and end= pairs, repeated, all expressed in the same units.
  return `silenceremove=start_periods=1:start_duration=${minDuration}:start_threshold=${threshold}dB:stop_periods=-1:stop_duration=${minDuration}:stop_threshold=${threshold}dB`;
}

/**
 * Strip silent stretches out of a file.
 *
 * The inverse of `detectSilence()`: same detection settings, but the result is
 * used to cut rather than to report.
 */
export async function removeSilence(opts: RemoveSilenceOptions): Promise<void> {
  const {
    input,
    output,
    threshold = -50,
    minDuration = 0.5,
    videoOnly = false,
    videoCodec = 'libx264',
    audioCodec = 'aac',
    binary = resolveBinary(),
    onProgress,
  } = opts;

  const filter = buildSilenceRemoveFilter({ threshold, minDuration });
  const args = [
    '-y', '-i', input,
    '-af', filter,
    '-c:v', videoOnly ? 'copy' : videoCodec,
    ...(videoOnly ? ['-an'] : ['-c:a', audioCodec]),
    output,
  ];

  if (onProgress) {
    const proc = spawnFFmpeg({ binary, args, parseProgress: true, ...await durationUs(input) });
    proc.emitter.on('progress', i => { if (i.percent !== undefined) onProgress(i.percent); });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; proc.kill(); reject(new Error('removeSilence timed out')); } }, 3_600_000);
      proc.emitter.on('end', () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } });
      proc.emitter.on('error', e => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } });
    });
    return;
  }
  await runFFmpeg({ binary, args });
}

// ─── Segmented output ────────────────────────────────────────────────────────

export interface SegmentOutputOptions {
  input: string;
  /** Output pattern; must contain %d, e.g. 'seg%03d.ts' */
  outputPattern: string;
  /** Segment length in seconds. Default: 2 */
  segmentTime?: number;
  /**
   * Force a keyframe exactly at each segment boundary.
   *
   * The segment muxer can only cut on a keyframe, so without this a 2s file
   * with `segmentTime: 1` and a large GOP can come out as a single segment.
   * Default: true.
   */
  forceKeyFrames?: boolean;
  /** Reset each segment's timestamps to zero. Default: true */
  resetTimestamps?: boolean;
  videoCodec?: string;
  audioCodec?: string;
  binary?: string;
}

/** Build argv for the segment muxer. */
export function buildSegmentArgs(opts: SegmentOutputOptions): string[] {
  const {
    input,
    outputPattern,
    segmentTime = 2,
    forceKeyFrames = true,
    resetTimestamps = true,
    videoCodec = 'libx264',
    audioCodec = 'aac',
  } = opts;

  if (!outputPattern.includes('%')) {
    throw new Error(
      `buildSegmentArgs: outputPattern must contain a printf-style index (e.g. 'seg%03d.ts'), got "${outputPattern}"`,
    );
  }
  if (!Number.isFinite(segmentTime) || segmentTime <= 0) {
    throw new RangeError(`buildSegmentArgs: segmentTime must be a positive number, got ${segmentTime}`);
  }

  return [
    '-y', '-i', input,
    '-c:v', videoCodec,
    '-c:a', audioCodec,
    // Without an explicit keyframe interval the muxer cannot hit the requested
    // boundaries and silently emits fewer, longer segments than asked for.
    ...(forceKeyFrames ? ['-force_key_frames', `expr:gte(t,n_forced*${segmentTime})`] : []),
    '-f', 'segment',
    '-segment_time', String(segmentTime),
    ...(resetTimestamps ? ['-reset_timestamps', '1'] : []),
    outputPattern,
  ];
}

/**
 * Split a file into fixed-length segments using ffmpeg's segment muxer.
 *
 * Unlike the HLS muxer this writes plain numbered files with no playlist,
 * which is what you want for upload batches and CDN pre-segmented delivery.
 */
export async function writeSegments(opts: SegmentOutputOptions): Promise<void> {
  const { binary = resolveBinary() } = opts;
  // The segment muxer will not create its output directory, so a pattern like
  // 'out/seg%03d.ts' fails unless the directory already exists.
  const { mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  mkdirSync(dirname(opts.outputPattern), { recursive: true });
  await runFFmpeg({ binary, args: buildSegmentArgs(opts) });
}

// Re-exported so callers can build follow-up work from the same detections
// without importing two modules.
export type { SceneChange, SilenceSegment };
export { parseAllProgress, FFmpegBuilder };
