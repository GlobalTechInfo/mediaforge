/**
 * HDR → SDR tone mapping.
 *
 * `isHdr()` in the probe helpers tells you whether a file is HDR; this module
 * is what you do about it. It builds the standard HDR-to-SDR chain:
 * set the input colour properties, tone-map the transfer function down to
 * BT.709, convert primaries, and write ordinary SDR signalling flags so players
 * don't try to treat the result as HDR again.
 */
import { FFmpegBuilder } from '../FFmpeg.ts';
import { resolveBinary } from '../utils/binary.ts';
import { probeAsync, isHdr } from '../probe/ffprobe.ts';

export type ToneMapAlgorithm = 'hable' | 'mobius' | 'reinhard' | 'clip' | 'linear' | 'spline';

/** Algorithms accepted by ffmpeg's `tonemap` filter's `tonemap` option. */
export const TONE_MAP_ALGORITHMS: Record<string, ToneMapAlgorithm> = {
  hable: 'hable',
  mobius: 'mobius',
  reinhard: 'reinhard',
  clip: 'clip',
  linear: 'linear',
  spline: 'spline',
};
export type ToneMapOutput = 'bt709' | 'bt470bg' | 'smpte170m' | 'smpte240m' | 'iec61966-2-1';

/** Static colour properties describing the HDR source. */
export const HDR_SOURCE_PROPERTIES: Record<string, string> = {
  color_primaries: 'bt2020',
  color_trc: 'smpte2084',
  colorspace: 'bt2020nc',
};

/** Static colour properties describing a BT.709 SDR target. */
export const SDR_TARGET_PROPERTIES: Record<string, string> = {
  color_primaries: 'bt709',
  color_trc: 'bt709',
  colorspace: 'bt709',
  color_range: 'tv',
};

export interface ToneMapFilterOptions {
  /**
   * Tone-mapping curve. Default: 'mobius' — the perceptually best of the
   * built-ins for HDR→SDR at typical content levels.
   */
  algorithm?: ToneMapAlgorithm;
  /** Peak luminance of the source in nits, e.g. 1000 for a PQ 1000-nit master. */
  peak?: number;
  /** Desired output peak in nits. Default: 100 (SDR reference white). */
  targetPeak?: number;
  /**
   * Parametric tuning used by the mobius/reinhard/linear algorithms.
   * Ignored by hable, clip and spline.
   */
  parameter?: number;
  /** Desaturation applied to out-of-range colours, 0-1. Default: 0.6 */
  desaturation?: number;
  /** Output colour space. Default: 'bt709' */
  output?: ToneMapOutput;
  /**
   * Correct the source primaries/transfer before tone mapping. Default: true.
   * Set false if the input is already tagged correctly and you only want the
   * transfer-function curve applied.
   */
  normalizeInput?: boolean;
}

/**
 * Build the HDR→SDR `-vf` filter chain.
 *
 * Example output:
 * `zscale=t=linear:npl=100,tonemap=tonemap=hable:peak=1000:desat=0.6,zscale=t=bt709:p=bt709:r=tv,format=yuv420p`
 */
export function buildToneMapFilter(options: ToneMapFilterOptions = {}): string {
  const {  algorithm = 'mobius',
  peak = 1000,
  targetPeak = 100,
  parameter,
  desaturation = 0.6,
  output = 'bt709',
  normalizeInput = true,
  } = options;

  const PARAMETRIC: readonly ToneMapAlgorithm[] = ['mobius', 'reinhard', 'linear'];
  if (!(Object.values(TONE_MAP_ALGORITHMS) as readonly ToneMapAlgorithm[]).includes(algorithm)) {
    throw new Error(
      `buildToneMapFilter: unknown algorithm "${algorithm}". ` +
        `Valid: ${Object.values(TONE_MAP_ALGORITHMS).join(', ')}.`,
    );
  }
  if (parameter !== undefined && !PARAMETRIC.includes(algorithm)) {
    // These ignore `parameter` entirely; accepting it silently would suggest
    // a tuning that never reaches ffmpeg.
    throw new Error(
      `buildToneMapFilter: parameter only applies to the ${PARAMETRIC.join('/')} algorithms, not '${algorithm}'`,
    );
  }
  if (parameter !== undefined && (!Number.isFinite(parameter) || parameter <= 0)) {
    throw new RangeError(`buildToneMapFilter: parameter must be a positive finite number, got ${parameter}`);
  }

  if (!Number.isFinite(peak) || peak <= 0) {
    throw new RangeError(`buildToneMapFilter: peak must be a positive finite number, got ${peak}`);
  }
  if (!Number.isFinite(targetPeak) || targetPeak <= 0) {
    throw new RangeError(`buildToneMapFilter: targetPeak must be a positive finite number, got ${targetPeak}`);
  }
  if (!Number.isFinite(desaturation) || desaturation < 0 || desaturation > 1) {
    throw new RangeError(`buildToneMapFilter: desaturation must be between 0 and 1, got ${desaturation}`);
  }

  const chain: string[] = [];

  if (normalizeInput) {
    // zscale with explicit input properties converts BT.2020/PQ into a linear
    // working space, which is the only sane input for `tonemap`.
    // NOTE the short option names: zscale uses w/h for pixel dimensions and
    // t/p/m/r for transfer/primaries/matrix/range. `width=bt2020` is a pixel
    // size, not a colour space, and ffmpeg rejects it as "Invalid size".
    chain.push(
      `zscale=t=linear:npl=${peak}:` +
        `p=${HDR_SOURCE_PROPERTIES['color_primaries']}:` +
        `t=${HDR_SOURCE_PROPERTIES['color_trc']}:` +
        `r=tv:` +
        `m=${HDR_SOURCE_PROPERTIES['colorspace']}`,
    );
  }

  const tm = [`tonemap=tonemap=${algorithm}`, `peak=${peak}`];
  if (['mobius', 'reinhard', 'linear'].includes(algorithm) && parameter !== undefined) {
    tm.push(`param=${parameter}`);
  }
  if (algorithm !== 'clip' && algorithm !== 'spline') {
    tm.push(`desat=${desaturation}`);
  }
  chain.push(tm.join(':'));

  // Convert the tone-mapped result back to the target space and tag it as SDR.
  chain.push(`zscale=t=${output}:p=${output}:m=${output}:r=tv`);

  return chain.join(',');
}

export interface ToneMapOptions extends Omit<ToneMapFilterOptions, 'output'> {
  input: string;
  output: string;
  /** Target colour space for the SDR result. Default: 'bt709' */
  outputColorSpace?: ToneMapOutput;
  videoCodec?: string;
  audioCodec?: string;
  binary?: string;
  /**
   * Reject the job unless the input actually looks like HDR. Default: true —
   * tone mapping an already-SDR source is almost always a mistake.
   */
  requireHdrInput?: boolean;
}

/**
 * Tone-map an HDR file down to SDR.
 *
 * Probes the input first and refuses to run on non-HDR sources unless
 * `requireHdrInput` is false.
 */
export async function toneMapHdrToSdr(opts: ToneMapOptions): Promise<void> {
  const {
    input,
    output,
    videoCodec = 'libx264',
    audioCodec = 'aac',
    binary = resolveBinary(),
    requireHdrInput = true,
    ...filterOpts
  } = opts;
  const { outputColorSpace, ...restFilterOpts } = filterOpts as {
    outputColorSpace?: ToneMapOutput;
  } & ToneMapFilterOptions;

  if (requireHdrInput) {
    const info = await probeAsync(input);
    if (!isHdr(info)) {
      throw new Error(
        `toneMapHdrToSdr: "${input}" does not look like HDR (no BT.2020 primaries and no ` +
          'PQ/HLG transfer). Pass requireHdrInput: false to tone map it anyway.',
      );
    }
  }

  const filter = buildToneMapFilter(
    outputColorSpace !== undefined ? { ...restFilterOpts, output: outputColorSpace } : restFilterOpts,
  );

  await new FFmpegBuilder(input)
    .output(output)
    .videoFilter(filter)
    .videoCodec(videoCodec)
    .audioCodec(audioCodec)
    // Tag the output as ordinary SDR so players and editors don't re-apply an
    // HDR display transform on top of what we just did.
    .setColorProperties(SDR_TARGET_PROPERTIES)
    .setBinary(binary)
    .run();
}
