import { spawnFFmpeg, runFFmpeg } from '../process/spawn.ts';
import { resolveBinary } from '../utils/binary.ts';
import { escapeDrawtextValue } from '../utils/filter.ts';

// ─── detectSilence ─────────────────────────────────────────────────────

export interface SilenceSegment {
  /** Start time in seconds */
  start: number;
  /** End time in seconds */
  end: number;
  /** Duration in seconds */
  duration: number;
}

export interface DetectSilenceOptions {
  /** Input file path */
  input: string;
  /** Silence threshold in dB. Default: -50 */
  threshold?: number;
  /** Minimum duration in seconds to consider as silence. Default: 0.5 */
  duration?: number;
  /** ffmpeg binary override */
  binary?: string;
}

/**
 * Detect silent segments in audio/video using silencedetect filter.
 *
 * @example
 * // Detect all silence below -40dB
 * const silence = await detectSilence({
 *   input: 'audio.mp4',
 *   threshold: -40,
 *   duration: 1
 * });
 * // Returns: [{ start: 10.5, end: 12.3, duration: 1.8 }, ...]
 */
export function detectSilence(opts: DetectSilenceOptions): Promise<SilenceSegment[]> {
  const {
    input,
    threshold = -50,
    duration: minDuration = 0.5,
    binary = resolveBinary(),
  } = opts;

  const args = [
    '-i', input,
    '-af', `silencedetect=noise=${threshold}dB:d=${minDuration}`,
    '-f', 'null', '-',
  ];

  return new Promise<SilenceSegment[]>((resolve, reject) => {
    const proc = spawnFFmpeg({ binary, args });
    const segments: SilenceSegment[] = [];
    let inSilence = false;
    let silenceStart = 0;
    let settled = false;

    const cleanup = () => { if (!settled) { settled = true; try { proc.kill(); } catch { /* ok */ } } };

    const onStderr = (line: string) => {
      if (settled) return;
      const startMatch = line.match(/silence_start:\s*([\d.]+)/);
      // ffmpeg prints "silence_end: 1.800000 | silence_duration: 1.800000".
      // The previous pattern required "|duration:", which never matches
      // "| silence_duration:", so no silence segment was ever recorded.
      const endMatch = line.match(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/);

      if (startMatch) {
        const newStart = parseFloat(startMatch[1]!);
        if (inSilence) {
          segments.push({ start: silenceStart, end: newStart, duration: newStart - silenceStart });
        }
        inSilence = true;
        silenceStart = newStart;
      } else if (endMatch && inSilence) {
        inSilence = false;
        const end = parseFloat(endMatch[1]!);
        const dur = parseFloat(endMatch[2]!);
        segments.push({ start: silenceStart, end, duration: dur });
      }
    };

    proc.emitter.on('stderr', onStderr);
    proc.emitter.on('end', () => { cleanup(); proc.emitter.off('stderr', onStderr); resolve(segments); });
    proc.emitter.on('error', (err) => { cleanup(); proc.emitter.off('stderr', onStderr); reject(err); });
  });
}

/**
 * Build silencedetect filter string.
 */
export function buildSilenceDetectFilter(threshold: number = -50, minDuration: number = 0.5): string {
  return `silencedetect=noise=${threshold}dB:d=${minDuration}`;
}

// ─── detectScenes ─────────────────────────────────────────────────

export interface SceneChange {
  /** Timestamp of scene change */
  timestamp: number;
  /** Scene number */
  sceneNumber: number;
}

export interface DetectScenesOptions {
  /** Input file path */
  input: string;
  /** Scene detection threshold. Lower = more sensitive. Default: 0.4 */
  threshold?: number;
  /** Output filename for scene list (optional) */
  sceneList?: string;
  /** ffmpeg binary override */
  binary?: string;
}

/**
 * Detect scene changes using select filter + showinfo.
 *
 * @example
 * const scenes = await detectScenes({ input: 'video.mp4', threshold: 0.3 });
 * // Returns: [{ timestamp: 12.5, sceneNumber: 1 }, { timestamp: 45.2, sceneNumber: 2 }, ...]
 */
export function detectScenes(opts: DetectScenesOptions): Promise<SceneChange[]> {
  const {
    input,
    threshold = 0.4,
    sceneList,
    binary = resolveBinary(),
  } = opts;

  const args = [
    '-i', input,
    // `metadata=print` emits `lavfi.scene_score` for each selected frame, which
    // is the only place the score is actually reported. `showinfo` does not
    // print the scene score at all, so filtering on the word "scene" in its
    // output never matched anything.
    '-vf', `select='gt(scene,${threshold})',metadata=print`,
    '-f', 'null', '-',
  ];

  if (sceneList) {
    args.push('-f', 'ffmetadata', sceneList);
  }

  return new Promise<SceneChange[]>((resolve, reject) => {
    const proc = spawnFFmpeg({ binary, args });
    const scenes: SceneChange[] = [];
    let sceneNum = 1;
    let settled = false;

    const cleanup = () => { if (!settled) { settled = true; try { proc.kill(); } catch { /* ok */ } } };

    // metadata=print emits two lines per selected frame: one with the frame's
    // pts_time, then one with lavfi.scene_score. Buffer the timestamp until the
    // score line confirms the frame really was a scene change.
    let pendingTime: number | null = null;
    proc.emitter.on('stderr', (line: string) => {
      const tsMatch = /pts_time:([\d.]+)/.exec(line);
      if (tsMatch) {
        pendingTime = parseFloat(tsMatch[1]!);
        return;
      }
      if (/lavfi\.scene_score=/.test(line) && pendingTime !== null) {
        scenes.push({ timestamp: pendingTime, sceneNumber: sceneNum++ });
        pendingTime = null;
      }
    });

    proc.emitter.on('end', () => { cleanup(); resolve(scenes); });
    proc.emitter.on('error', (err) => { cleanup(); reject(err); });
  });
}

export function buildSceneSelectFilter(threshold: number = 0.4): string {
  return `select='gt(scene,${threshold})',metadata=print`;
}

// ─── cropDetect ────────────────────────────────────────────────────

export interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropDetectOptions {
  /** Input file path */
  input: string;
  /** Maximum frames to scan. Default: 100 */
  limit?: number;
  /** Skip initial seconds. Default: 5 */
  skip?: number;
  /** ffmpeg binary override */
  binary?: string;
}

/**
 * Detect letterbox/pillar bars using cropdetect filter.
 *
 * @example
 * const crop = await cropDetect({ input: 'video.mp4' });
 * // Returns: { x: 0, y: 120, width: 1920, height: 1080 }
 */
export function cropDetect(opts: CropDetectOptions): Promise<CropRegion | null> {
  const {
    input,
    limit = 100,
    skip = 5,
    binary = resolveBinary(),
  } = opts;

  const args = [
    '-ss', String(skip),
    '-i', input,
    '-vf', `cropdetect=limit=24:round=2`,
    '-vframes', String(limit),
    '-f', 'null', '-',
  ];

  return new Promise<CropRegion | null>((resolve, reject) => {
    const proc = spawnFFmpeg({ binary, args });
    let cropLine = '';
    let settled = false;

    const cleanup = () => { if (!settled) { settled = true; proc.kill(); } };

    proc.emitter.on('stderr', (line: string) => {
      if (line.includes('crop')) {
        cropLine = line;
      }
    });

    proc.emitter.on('end', () => {
      cleanup();
      // Parse crop=width:height:x:y from output
      const match = cropLine.match(/crop=(\d+):(\d+):(\d+):(\d+)/);
      if (match) {
        resolve({
          width: parseInt(match[1]!),
          height: parseInt(match[2]!),
          x: parseInt(match[3]!),
          y: parseInt(match[4]!),
        });
      } else {
        resolve(null);
      }
    });
    proc.emitter.on('error', (err) => { cleanup(); reject(err); });
  });
}

// ─── burnTimecode ─────────────────────────────────────────────────

export interface BurnTimecodeOptions {
  /** Input file path */
  input: string;
  /** Output file path */
  output: string;
  /** Timecode format: 'HH:MM:SS:FF' or frame number. Default: full timecode */
  format?: string;
  /** Font file path (optional) */
  font?: string;
  /** Fontsize. Default: 48 */
  fontsize?: number;
  /** Font color. Default: 'white' */
  fontcolor?: string;
  /** Position: 'tl', 'tr', 'bl', 'br', 'center'. Default: 'bl' */
  position?: 'tl' | 'tr' | 'bl' | 'br' | 'center';
  /** x and y offset */
  x?: string;
  y?: string;
  /** ffmpeg binary override */
  binary?: string;
}

/**
 * Burn timecode overlay onto video.
 *
 * @example
 * // Simple timecode at bottom-left
 * await burnTimecode({
 *   input: 'video.mp4',
 *   output: 'with-tc.mp4',
 *   format: '%{pts_hms}'
 * });
 */
export async function burnTimecode(opts: BurnTimecodeOptions): Promise<void> {
  const {
    input,
    output,
    format,
    font,
    fontsize = 48,
    fontcolor = 'white',
    position = 'bl',
    x,
    y,
    binary = resolveBinary(),
  } = opts;

  // Build drawtext expression for timecode
  const timeExpr = format || '%{pts_hms}';
  const drawtext = `drawtext=text='${escapeDrawtextValue(timeExpr)}':fontsize=${fontsize}:fontcolor=${fontcolor}`;

  // Position
  let posX = x ?? '10';
  let posY = y ?? 'h-th-10';
  if (position === 'tl') { posX = '10'; posY = '10'; }
  if (position === 'tr') { posX = 'w-tw-10'; posY = '10'; }
  if (position === 'br') { posX = 'w-tw-10'; posY = 'h-th-10'; }
  if (position === 'center') { posX = '(w-tw)/2'; posY = '(h-th)/2'; }

  const filter = `${drawtext}:x=${posX}:y=${posY}${font ? `:fontfile='${escapeDrawtextValue(font)}'` : ''}`;

  const args = ['-y', '-i', input, '-vf', filter, '-c:a', 'copy', output];

  await runFFmpeg({ binary, args });
}

export function buildBurnTimecodeFilter(
  timeFormat: string = '%{pts_hms}',
  fontsize: number = 48,
  fontcolor: string = 'white',
  fontfile?: string,
  x: string = '10',
  y: string = 'h-th-10'
): string {
  return `drawtext=text='${escapeDrawtextValue(timeFormat)}':fontsize=${fontsize}:fontcolor=${fontcolor}:x=${x}:y=${y}${fontfile ? `:fontfile='${escapeDrawtextValue(fontfile)}'` : ''}`;
}

// ─── parseLoudnorm ───────────────────────────────────────────────────

export interface EbuR128Result {
  /** Integrated loudness in LUFS */
  inputI: number;
  /** Loudness range in LU */
  inputLra: number;
  /** True peak in dBTP */
  inputTp: number;
  /** Threshold in LUFS */
  inputThresh: number;
}

export interface ParseLoudnormOptions {
  /** Input file path or direct output from loudnorm first-pass */
  input: string;
  /** Mode: 'file' for probe, or 'output' for parsing loudnorm output */
  mode?: 'file' | 'output';
  /** ffmpeg binary override */
  binary?: string;
}

/**
 * Parse EBU R128 loudness measurements from a file or loudnorm output.
 *
 * @example
 * // Get loudness stats from a file
 * const stats = await parseLoudnorm({ input: 'audio.mp4' });
 * // Returns: { inputI: -23, inputLra: 7, inputTp: -1, inputThresh: -40 }
 */
export async function parseLoudnorm(opts: ParseLoudnormOptions): Promise<EbuR128Result> {
  const {
    input,
    mode = 'file',
    binary = resolveBinary(),
  } = opts;

  let output = '';

  if (mode === 'file') {
    // Run loudnorm in measured mode without output to get stats
    const args = [
      '-i', input,
      '-af', 'loudnorm=I=-23:print_format=json',
      '-f', 'null', '-',
    ];

    const proc = spawnFFmpeg({ binary, args });

    const chunks: string[] = [];
    proc.emitter.on('stderr', (line: string) => chunks.push(line));
    await new Promise<void>((resolve, reject) => {
      proc.emitter.on('end', resolve);
      proc.emitter.on('error', reject);
    });
    output = chunks.join('');
  } else {
    output = input; // Direct output string
  }

  // Parse JSON from output using brace-depth tracking for robustness
  const parsedJson = extractJsonBlock(output);
  if (parsedJson) {
    const num = (key: string): number => {
      const raw = parsedJson[key];
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? 0));
      return Number.isNaN(n) ? 0 : n;
    };
    return {
      inputI: num('input_i'),
      inputLra: num('input_lra'),
      inputTp: num('input_tp'),
      inputThresh: num('input_thresh'),
    };
  }

  const iMatch = output.match(/"input_i"\s*:\s*([-\d.]+)/);
  const lraMatch = output.match(/"input_lra"\s*:\s*([-\d.]+)/);
  const tpMatch = output.match(/"input_tp"\s*:\s*([-\d.]+)/);
  const threshMatch = output.match(/"input_thresh"\s*:\s*([-\d.]+)/);

  return {
    inputI: iMatch ? parseFloat(iMatch[1]!) : 0,
    inputLra: lraMatch ? parseFloat(lraMatch[1]!) : 0,
    inputTp: tpMatch ? parseFloat(tpMatch[1]!) : 0,
    inputThresh: threshMatch ? parseFloat(threshMatch[1]!) : 0,
  };
}

export interface NormalizeOptions {
  input: string;
  output: string;
  /** Target integrated loudness in LUFS. Default: -23 (EBU R128) */
  targetI?: number;
  /** Target loudness range in LU. Default: 7 */
  targetLra?: number;
  /** Target true peak in dBTP. Default: -2 */
  targetTp?: number;
  /** Two-pass for accuracy. Default: true */
  twoPass?: boolean;
  /** Video codec. Default: 'copy' */
  videoCodec?: string;
  binary?: string;
}

export interface NormalizeResult {
  inputI: number;
  inputLra: number;
  inputTp: number;
  inputThresh: number;
  targetOffset: number;
}

/**
 * Normalize audio loudness (EBU R128 / ITU-R BS.1770).
 *
 * @example
 * const result = await normalizeAudio({ input: 'raw.mp4', output: 'norm.mp4', targetI: -16 });
 */
export async function normalizeAudio(opts: NormalizeOptions): Promise<NormalizeResult> {
  const {
    input,
    output,
    targetI = -23,
    targetLra = 7,
    targetTp = -2,
    twoPass = true,
    videoCodec = 'copy',
    binary = resolveBinary(),
  } = opts;

  if (!twoPass) {
    await runFFmpeg({
      binary,
      args: ['-y', '-i', input, '-c:v', videoCodec, '-af', `loudnorm=i=${targetI}:lra=${targetLra}:tp=${targetTp}`, output],
    });
    // Single-pass loudnorm never measures the source, so the input_* fields
    // are genuinely unknown. They are reported as NaN rather than being
    // forced through `as unknown as number` casts on null.
    return {
      inputI: Number.NaN,
      inputLra: Number.NaN,
      inputTp: Number.NaN,
      inputThresh: Number.NaN,
      targetOffset: 0,
    };
  }

  // Pass 1: measure
  const stderrLines: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const proc = spawnFFmpeg({
      binary,
      args: ['-y', '-i', input, '-af', `loudnorm=i=${targetI}:lra=${targetLra}:tp=${targetTp}:print_format=json`, '-f', 'null', '-'],
    });
    proc.emitter.on('stderr', (line: string) => stderrLines.push(line));
    proc.emitter.on('end', resolve);
    proc.emitter.on('error', reject);
  });

  let measured: NormalizeResult = { inputI: targetI, inputLra: targetLra, inputTp: targetTp, inputThresh: targetI - 10, targetOffset: 0 };
  const jsonStr = stderrLines.join('\n');
  const parsedJson = extractJsonBlock(jsonStr);
  if (parsedJson) {
    const num = (key: string, fallback: number): number => {
      const raw = parsedJson[key];
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? fallback));
      return Number.isNaN(n) ? fallback : n;
    };
    measured = {
      inputI: num('input_i', targetI),
      inputLra: num('input_lra', targetLra),
      inputTp: num('input_tp', targetTp),
      inputThresh: num('input_thresh', targetI - 10),
      targetOffset: num('target_offset', 0),
    };
  }

  // Pass 2: apply
  const applyFilter = `loudnorm=i=${targetI}:lra=${targetLra}:tp=${targetTp}:measured_i=${measured.inputI}:measured_lra=${measured.inputLra}:measured_tp=${measured.inputTp}:measured_thresh=${measured.inputThresh}:offset=${measured.targetOffset}:linear=true`;
  await runFFmpeg({
    binary,
    args: ['-y', '-i', input, '-c:v', videoCodec, '-af', applyFilter, output],
  });

  return measured;
}

export interface AdjustVolumeOptions {
  input: string;
  output: string;
  volume: string;
  videoCodec?: string;
  binary?: string;
}

/**
 * Adjust volume by a multiplier or dB value.
 * @example
 * await adjustVolume({ input: 'in.mp4', output: 'out.mp4', volume: '0.5' });
 * await adjustVolume({ input: 'in.mp4', output: 'out.mp4', volume: '6dB' });
 */
export async function adjustVolume(opts: AdjustVolumeOptions): Promise<void> {
  const { input, output, volume, videoCodec = 'copy', binary = resolveBinary() } = opts;
  await runFFmpeg({
    binary,
    args: ['-y', '-i', input, '-c:v', videoCodec, '-af', `volume=${volume}`, output],
  });
}

/**
 * Extract a JSON object from a string by tracking brace depth.
 * This is more robust than regex for parsing nested JSON in stderr output.
 *
 * Single pass: the previous implementation tried JSON.parse on every `{`..`}`
 * candidate, which is O(n^2) parses and became a CPU sink on large stderr
 * dumps (e.g. loudnorm over a long file).
 */
function extractJsonBlock(text: string): Record<string, unknown> | null {
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{') continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i]!;

      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }

      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            const parsed: unknown = JSON.parse(text.slice(start, i + 1));
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
              return parsed as Record<string, unknown>;
            }
          } catch {
            // Not valid JSON — keep scanning for a later candidate.
          }
          break;
        }
      }
    }
  }
  return null;
}

// ─── Arg builders ─────────────────────────────────────────────────────────────

/**
 * Build a `loudnorm` filter string.
 *
 * `measured` accepts the result of {@link parseLoudnorm} directly
 * (`EbuR128Result`, camelCase). The ffmpeg-native snake_case spelling
 * (`input_i`, `input_lra`, `input_tp`, `input_thresh`, `target_offset`) is also
 * accepted, since that is the spelling ffmpeg prints in its analysis output.
 * `targetOffset` is optional — when omitted the `offset=` option is left out
 * entirely, because emitting `offset=undefined` makes ffmpeg abort with
 * `Unable to parse option value "undefined"`.
 */
export function buildLoudnormFilter(
  targetI: number, targetLra: number, targetTp: number,
  measured?: {
    inputI?: number;
    inputLra?: number;
    inputTp?: number;
    inputThresh?: number;
    targetOffset?: number;
    input_i?: number;
    input_lra?: number;
    input_tp?: number;
    input_thresh?: number;
    target_offset?: number;
  },
): string {
  let filter = `loudnorm=i=${targetI}:lra=${targetLra}:tp=${targetTp}`;
  if (measured) {
    const pick = (camel: number | undefined, snake: number | undefined): number | undefined =>
      typeof camel === 'number' ? camel : snake;

    const i = pick(measured.inputI, measured.input_i);
    const lra = pick(measured.inputLra, measured.input_lra);
    const tp = pick(measured.inputTp, measured.input_tp);
    const thresh = pick(measured.inputThresh, measured.input_thresh);

    const missing = (
      [
        ['inputI', i],
        ['inputLra', lra],
        ['inputTp', tp],
        ['inputThresh', thresh],
      ] as const
    ).find(([, v]) => typeof v !== 'number' || !Number.isFinite(v));

    if (missing) {
      throw new Error(
        `buildLoudnormFilter: measured.${missing[0]} is missing or not a finite number. ` +
          'Pass the result of parseLoudnorm(), or the equivalent snake_case keys ' +
          '(input_i, input_lra, input_tp, input_thresh).',
      );
    }

    filter += `:measured_i=${i}:measured_lra=${lra}` +
      `:measured_tp=${tp}:measured_thresh=${thresh}`;

    const offset = pick(measured.targetOffset, measured.target_offset);
    if (typeof offset === 'number' && Number.isFinite(offset)) {
      filter += `:offset=${offset}`;
    }
    filter += ':linear=true';
  }
  return filter;
}
