import { spawnFFmpeg, runFFmpeg } from '../process/spawn.js';
import { resolveBinary } from '../utils/binary.js';

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
  const match = jsonStr.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  if (match) {
    try {
      const j = JSON.parse(match[0]);
      measured = {
        inputI: parseFloat(j.input_i),
        inputLra: parseFloat(j.input_lra),
        inputTp: parseFloat(j.input_tp),
        inputThresh: parseFloat(j.input_thresh),
        targetOffset: parseFloat(j.target_offset),
      };
    } catch { /* use defaults */ }
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
