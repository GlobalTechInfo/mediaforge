import { spawnFFmpeg, runFFmpeg } from '../process/spawn.ts';
import { resolveBinary } from '../utils/binary.ts';
import { escapeFilterValue } from '../utils/filter.ts';

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
      const endMatch = line.match(/silence_end:\s*([\d.]+)\|duration:\s*([\d.]+)/);

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
    '-vf', `select='gt(scene,${threshold})',showinfo`,
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

    proc.emitter.on('stderr', (line: string) => {
      const tsMatch = line.match(/pts_time:([\d.]+)/);
      if (tsMatch && line.includes('scene')) {
        const ts = parseFloat(tsMatch[1]!);
        scenes.push({ timestamp: ts, sceneNumber: sceneNum++ });
      }
    });

    proc.emitter.on('end', () => { cleanup(); resolve(scenes); });
    proc.emitter.on('error', (err) => { cleanup(); reject(err); });
  });
}

export function buildSceneSelectFilter(threshold: number = 0.4): string {
  return `select='gt(scene,${threshold})',showinfo`;
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
  const drawtext = `drawtext=text='${escapeFilterValue(timeExpr)}':fontsize=${fontsize}:fontcolor=${fontcolor}`;

  // Position
  let posX = x ?? '10';
  let posY = y ?? 'h-th-10';
  if (position === 'tl') { posX = '10'; posY = '10'; }
  if (position === 'tr') { posX = 'w-tw-10'; posY = '10'; }
  if (position === 'br') { posX = 'w-tw-10'; posY = 'h-th-10'; }
  if (position === 'center') { posX = '(w-tw)/2'; posY = '(h-th)/2'; }

  const filter = `${drawtext}:x=${posX}:y=${posY}${font ? `:fontfile='${font}'` : ''}`;

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
  return `drawtext=text='${timeFormat}':fontsize=${fontsize}:fontcolor=${fontcolor}:x=${x}:y=${y}${fontfile ? `:fontfile='${fontfile}'` : ''}`;
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
    return {
      inputI: typeof parsedJson['input_i'] === 'number' ? parsedJson['input_i'] : parseFloat(String(parsedJson['input_i'] ?? 0)),
      inputLra: typeof parsedJson['input_lra'] === 'number' ? parsedJson['input_lra'] : parseFloat(String(parsedJson['input_lra'] ?? 0)),
      inputTp: typeof parsedJson['input_tp'] === 'number' ? parsedJson['input_tp'] : parseFloat(String(parsedJson['input_tp'] ?? 0)),
      inputThresh: typeof parsedJson['input_thresh'] === 'number' ? parsedJson['input_thresh'] : parseFloat(String(parsedJson['input_thresh'] ?? 0)),
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
    return { inputI: targetI, inputLra: targetLra, inputTp: targetTp, inputThresh: targetI - 10, targetOffset: 0 };
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
    measured = {
      inputI: typeof parsedJson['input_i'] === 'number' ? parsedJson['input_i'] : parseFloat(String(parsedJson['input_i'] ?? targetI)),
      inputLra: typeof parsedJson['input_lra'] === 'number' ? parsedJson['input_lra'] : parseFloat(String(parsedJson['input_lra'] ?? targetLra)),
      inputTp: typeof parsedJson['input_tp'] === 'number' ? parsedJson['input_tp'] : parseFloat(String(parsedJson['input_tp'] ?? targetTp)),
      inputThresh: typeof parsedJson['input_thresh'] === 'number' ? parsedJson['input_thresh'] : parseFloat(String(parsedJson['input_thresh'] ?? targetI - 10)),
      targetOffset: typeof parsedJson['target_offset'] === 'number' ? parsedJson['target_offset'] : parseFloat(String(parsedJson['target_offset'] ?? '0')),
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
 */
function extractJsonBlock(text: string): Record<string, unknown> | null {
  let start = text.indexOf('{');
  while (start !== -1) {
    for (let end = start + 1; end <= text.length; end++) {
      if (text[end - 1] === '}') {
        try {
          const parsed = JSON.parse(text.slice(start, end));
          if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>;
        } catch {
          continue;
        }
      }
    }
    start = text.indexOf('{', start + 1);
  }
  return null;
}

// ─── Arg builders ─────────────────────────────────────────────────────────────

export function buildLoudnormFilter(
  targetI: number, targetLra: number, targetTp: number,
  measured?: { inputI: number; inputLra: number; inputTp: number; inputThresh: number; targetOffset: number },
): string {
  let filter = `loudnorm=i=${targetI}:lra=${targetLra}:tp=${targetTp}`;
  if (measured) {
    filter += `:measured_i=${measured.inputI}:measured_lra=${measured.inputLra}` +
      `:measured_tp=${measured.inputTp}:measured_thresh=${measured.inputThresh}` +
      `:offset=${measured.targetOffset}:linear=true`;
  }
  return filter;
}
