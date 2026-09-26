/**
 * Objective video quality measurement.
 *
 * Wraps ffmpeg's `libvmaf`, `ssim` and `psnr` filters so you can gate an encode
 * on a quality floor, or compare two encodes of the same source. The filter
 * strings are exported separately from the runner so they can be inspected in a
 * dry run (and unit-tested) without an encoder.
 *
 * Requires a libvmaf-enabled ffmpeg build; `ssim` and `psnr` are always
 * available.
 */
import { runFFmpeg } from '../process/spawn.ts';
import { resolveBinary } from '../utils/binary.ts';

/**
 * Escape a value for a single-quoted filtergraph option.
 *
 * Inside `'...'` ffmpeg only needs quotes and backslashes escaped — escaping
 * `=`, `:` or spaces there produces a literal backslash in the value.
 */
function quoteFilterValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
}

export type QualityMetric = 'vmaf' | 'ssim' | 'psnr';

// ─── Filter builders ─────────────────────────────────────────────────────────

export interface VmafFilterOptions {
  /** Target VMAF score, 0-100. Default: null (report only) */
  target?: number;
  /** Drop frames scoring below this. ffmpeg refuses to go above 100. Default: null */
  minScore?: number;
  /** Pool of models, e.g. 'version=v0.6.1' */
  model?: string;
}

/**
 * Build a `libvmaf` filter.
 *
 * Emits `libvmaf=...:log_fmt=json` and returns the string. The runner appends
 * `log_path` when it needs to read the per-frame JSON back out.
 */
export function buildVmafFilter(options: VmafFilterOptions = {}): string {
  const { target, minScore, model } = options;

  if (target !== undefined && (!Number.isFinite(target) || target < 0 || target > 100)) {
    throw new RangeError(`buildVmafFilter: target must be between 0 and 100, got ${target}`);
  }
  if (minScore !== undefined && (!Number.isFinite(minScore) || minScore < 0 || minScore > 100)) {
    throw new RangeError(`buildVmafFilter: minScore must be between 0 and 100, got ${minScore}`);
  }

  const parts: string[] = ['log_fmt=json'];
  if (target !== undefined) parts.push(`target=${target}`);
  if (minScore !== undefined) parts.push(`min_score=${minScore}`);
  if (model !== undefined) {
    // Only quotes and backslashes need escaping inside a single-quoted
    // filtergraph value. escapeFilterValue also escapes '=', which would turn
    // a model spec like `version=v0.6.1` into `version\=v0.6.1` and make
    // ffmpeg reject the model name.
    const safeModel = model.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
    parts.push(`model='${safeModel}'`);
  }
  return `libvmaf=${parts.join(':')}`;
}

export interface SsimFilterOptions {
  /** Write per-frame stats here. */
  statsFile?: string;
  /** Reference the reference input instead of comparing two given streams. */
  reference?: boolean;
}

/** Build an `ssim` filter. Returns the full filtergraph fragment. */
export function buildSsimFilter(options: SsimFilterOptions = {}): string {
  const parts: string[] = [];
  if (options.statsFile) parts.push(`stats_file='${quoteFilterValue(options.statsFile)}'`);
  return parts.length > 0 ? `ssim=${parts.join(':')}` : 'ssim';
}

export interface PsnrFilterOptions {
  statsFile?: string;
}

/** Build a `psnr` filter. */
export function buildPsnrFilter(options: PsnrFilterOptions = {}): string {
  const parts: string[] = [];
  if (options.statsFile) parts.push(`stats_file='${quoteFilterValue(options.statsFile)}'`);
  return parts.length > 0 ? `psnr=${parts.join(':')}` : 'psnr';
}

// ─── Score parsing ───────────────────────────────────────────────────────────

export interface QualityScore {
  /** VMAF overall score, 0-100. Absent for ssim/psnr runs. */
  vmaf?: number;
  /** Mean SSIM, 0-1. */
  ssim?: number;
  /** Mean PSNR in dB. */
  psnr?: number;
  /** Number of frames compared. */
  frames?: number;
  /** Raw metric, whichever was requested. */
  value: number;
  metric: QualityMetric;
}

/**
 * Parse a libvmaf JSON log written by `log_path`.
 *
 * ffmpeg writes `{"version": "...", "frames": [...], "pooled_metrics": {...}}`.
 * The pooled `vmaf.mean` is the overall score.
 */
export function parseVmafLog(json: string): QualityScore {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    throw new Error(`parseVmafLog: not valid JSON (${(e as Error).message})`);
  }
  const root = data as {
    pooled_metrics?: Record<string, { mean?: number }>;
    frames?: unknown[];
  };
  const mean = root.pooled_metrics?.['vmaf']?.mean;
  if (typeof mean !== 'number' || !Number.isFinite(mean)) {
    throw new Error('parseVmafLog: log has no pooled_metrics.vmaf.mean (was the filter run to completion?)');
  }
  const score: QualityScore = { vmaf: mean, value: mean, metric: 'vmaf' };
  if (typeof root.frames?.length === 'number') score.frames = root.frames.length;
  return score;
}

/**
 * Parse a `stats_file` written by the ssim or psnr filter.
 *
 * Each line is `n:<frame> ... All:<value>` (ssim) or `psnr_avg:<value>` /
 * `psnr_y:...` (psnr). Returns the arithmetic mean.
 */
export function parseStatsFile(contents: string, metric: 'ssim' | 'psnr'): QualityScore {
  const lines = contents.split('\n').filter(l => l.trim() !== '');
  if (lines.length === 0) {
    throw new Error(`parseStatsFile: ${metric} stats file is empty`);
  }

  if (metric === 'ssim') {
    // "n:0 mse_avg:1.2 ... All:0.998765 (30.0)"
    const values: number[] = [];
    for (const line of lines) {
      const m = /All:([0-9.]+)/.exec(line);
      if (m?.[1]) values.push(parseFloat(m[1]));
    }
    if (values.length === 0) throw new Error('parseStatsFile: no "All:" scores found (is this an ssim stats file?)');
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return { ssim: mean, value: mean, metric: 'ssim', frames: values.length };
  }

  // psnr stats lines look like:
  // "n:1 mse_avg:0.50 mse_y:0.60 ... psnr_avg:51.13 psnr_y:52.07 ..."
  // An identical frame reports "psnr_avg:inf" — that is a real result, not a
  // parse failure, so "inf" must be accepted and carried through.
  const values: number[] = [];
  for (const line of lines) {
    const m = /psnr_avg:([0-9.]+|inf|nan)/.exec(line);
    if (m?.[1]) {
      const v = m[1] === 'inf' ? Number.POSITIVE_INFINITY : parseFloat(m[1]);
      if (Number.isNaN(v)) continue;
      values.push(v);
    }
  }
  if (values.length === 0) throw new Error('parseStatsFile: no "psnr_avg:" values found (is this a psnr stats file?)');
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { psnr: mean, value: mean, metric: 'psnr', frames: values.length };
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export interface MeasureQualityOptions {
  /** The reference / source encode. */
  reference: string;
  /** The encode under test. */
  distorted: string;
  /** Which metric to compute. Default: 'vmaf' */
  metric?: QualityMetric;
  /** VMAF options (target/minScore/model). Ignored for ssim/psnr. */
  vmaf?: VmafFilterOptions;
  /** Minimum acceptable score; throws if the result is below it. */
  minScore?: number;
  /** ffmpeg binary override */
  binary?: string;
}

const METRIC_AVAILABLE: Record<QualityMetric, string> = {
  vmaf: 'libvmaf',
  ssim: 'ssim',
  psnr: 'psnr',
};

/**
 * Measure the quality of `distorted` relative to `reference`.
 *
 * Runs a single ffmpeg pass with the two inputs, decodes the metric's report
 * from the log/stats file, and returns the pooled score. Throws when
 * `minScore` is not met — so this works directly as a CI gate.
 */
export async function measureQuality(opts: MeasureQualityOptions): Promise<QualityScore> {
  const {
    reference,
    distorted,
    metric = 'vmaf',
    vmaf,
    minScore,
    binary = resolveBinary(),
  } = opts;

  if (metric !== 'vmaf' && vmaf?.target !== undefined) {
    throw new Error(`measureQuality: vmaf.target only applies to metric 'vmaf', not '${metric}'`);
  }

  const logFile = `mediaforge-quality-${process.pid}-${Date.now()}.json`;
  const statsFile = `mediaforge-quality-${process.pid}-${Date.now()}.log`;

  const filter =
    metric === 'vmaf'
      ? buildVmafFilter(vmaf).replace('libvmaf=', `libvmaf=log_path='${logFile}':`)
      : metric === 'ssim'
        ? buildSsimFilter({ statsFile })
        : buildPsnrFilter({ statsFile });

  // [1:v][0:v] — libvmaf/ssim/psnr take main = distorted, reference = the
  // second input, so the order in the graph is [dist][ref].
  const filterComplex = `[1:v][0:v]${filter}[out]`;

  const args = [
    '-y',
    '-i', reference,
    '-i', distorted,
    '-filter_complex', filterComplex,
    '-map', '[out]',
    '-f', 'null',
    '-',
  ];

  try {
    await runFFmpeg({ binary, args });

    if (metric === 'vmaf') {
      const { readFileSync, rmSync } = await import('node:fs');
      let score: QualityScore;
      try {
        score = parseVmafLog(readFileSync(logFile, 'utf8'));
      } finally {
        rmSync(logFile, { force: true });
      }
      assertMinScore(score, minScore, 'vmaf');
      return score;
    }

    const { readFileSync, rmSync } = await import('node:fs');
    let contents: string;
    try {
      contents = readFileSync(statsFile, 'utf8');
    } finally {
      rmSync(statsFile, { force: true });
    }
    const score = parseStatsFile(contents, metric);
    assertMinScore(score, minScore, metric);
    return score;
  } catch (e) {
    if (e instanceof Error && /No such filter|Invalid argument/.test(e.message)) {
      throw new Error(
        `measureQuality: the '${METRIC_AVAILABLE[metric]}' filter is not available in this ` +
          'ffmpeg build. VMAF requires an ffmpeg compiled with libvmaf.',
      );
    }
    throw e;
  }
}

function assertMinScore(score: QualityScore, minScore: number | undefined, metric: string): void {
  // An identical reference gives PSNR of Infinity, which trivially clears any
  // minimum — do not let Infinity < Infinity reject a perfect result.
  if (minScore !== undefined && score.value < minScore && Number.isFinite(score.value)) {
    throw new Error(
      `measureQuality: ${metric} score ${score.value.toFixed(4)} is below the required minimum ${minScore}`,
    );
  }
}
