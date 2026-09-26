/**
 * Hardware filter-graph helpers.
 *
 * The `CapabilityRegistry` and the `*ToArgs` codec helpers cover hardware
 * *encoding*. This module covers the other half — keeping frames on the GPU
 * through a filter chain, which is the whole point of hardware acceleration.
 *
 * Without these, `-hwaccel cuda` uploads frames to the GPU and immediately
 * downloads them again for every software filter, which is slower than not
 * using it at all.
 */
import { FFmpegBuilder } from '../FFmpeg.ts';
import { resolveBinary } from '../utils/binary.ts';

export type Hwaccel = 'cuda' | 'vaapi' | 'qsv' | 'vulkan' | 'videotoolbox' | 'd3d11va' | 'dxva2' | 'opencl' | 'vdpau';
export type HwPixelFormat = 'nv12' | 'p010' | 'yuv420p' | 'yuv420p10le' | 'vaapi' | 'qsv' | 'cuda' | 'bgra' | 'gbrap';

export const HWACCELS: readonly Hwaccel[] = [
  'cuda', 'vaapi', 'qsv', 'vulkan', 'videotoolbox', 'd3d11va', 'dxva2', 'opencl', 'vdpau',
];

/** Pixel format the frames are in once they land on the GPU. */
const HW_UPLOAD_FORMAT: Partial<Record<Hwaccel, string>> = {
  cuda: 'cuda',
  vaapi: 'vaapi',
  qsv: 'qsv',
  vulkan: 'vulkan',
  d3d11va: 'd3d11va',
  dxva2: 'dxva2',
  opencl: 'opencl',
  vdpau: 'vdpau',
};

/**
 * Build the `hwupload` filter that moves a decoded software frame onto the GPU.
 *
 * ffmpeg's `hwupload` takes no options — it picks the hardware frame type from
 * the decoder's pixel format — so this only validates that the acceleration
 * method is one ffmpeg can actually upload into.
 */
export function buildHwUploadFilter(opts: { accel: Hwaccel }): string {
  assertAccel(opts.accel);
  if (!HW_UPLOAD_FORMAT[opts.accel]) {
    throw new Error(
      `buildHwUploadFilter: "${opts.accel}" has no hardware frame format to upload into. ` +
        'This usually means the input was not decoded on the GPU — pass -hwaccel ' +
        `${opts.accel} on the input so hwupload has frames to take.`,
    );
  }
  return 'hwupload';
}

/**
 * Build the `hwdownload` filter that brings GPU frames back to system memory.
 *
 * Always place this immediately before any software filter, and pass the format
 * the consumer expects — letting ffmpeg auto-negotiate here is a common source
 * of "no frames" errors.
 */
export function buildHwDownloadFilter(destFormat: HwPixelFormat = 'nv12'): string {
  return `hwdownload=format=${destFormat}`;
}

/** Per-vendor GPU-accelerated scaler. */
const SCALE_FILTER: Partial<Record<Hwaccel, string>> = {
  cuda: 'scale_cuda',
  vaapi: 'scale_vaapi',
  qsv: 'scale_qsv',
  vulkan: 'scale_vulkan',
};

/**
 * Build a GPU-accelerated scale filter.
 *
 * Throws for accelerations ffmpeg has no GPU scaler for (videotoolbox and the
 * D3D/DXVA/VA-API-on-Windows paths do not ship one) rather than silently
 * emitting a software `scale` the caller would think is accelerated.
 */
export function buildHwScaleFilter(opts: {
  accel: Hwaccel;
  width: number;
  height: number;
  /** Optional format string for VAAPI (e.g. 'nv12|cuda'). */
  format?: string;
  mode?: 'fast_bilinear' | 'bilinear' | 'bicubic' | 'neighbor' | 'area';
}): string {
  const { accel, width, height, format, mode } = opts;
  assertAccel(accel);

  const filter = SCALE_FILTER[accel];
  if (!filter) {
    throw new Error(
      `buildHwScaleFilter: ffmpeg has no GPU scaler for "${accel}". ` +
        `Available: ${Object.keys(SCALE_FILTER).join(', ')}. ` +
        'Use buildHwDownloadFilter() + a software scale for this device.',
    );
  }

  if (!Number.isInteger(width) || width <= 0) {
    throw new RangeError(`buildHwScaleFilter: width must be a positive integer, got ${width}`);
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new RangeError(`buildHwScaleFilter: height must be a positive integer, got ${height}`);
  }

  const parts = [`w=${width}`, `h=${height}`];
  if (format) parts.push(`format=${format}`);
  if (mode) parts.push(`mode=${mode}`);
  return `${filter}=${parts.join(':')}`;
}

/**
 * Compose a full upload → GPU work → download chain.
 *
 * `gpuFilters` run with frames resident on the device; everything between the
 * upload and the download therefore has to be a hardware filter.
 */
export function buildHwFilterChain(opts: {
  accel: Hwaccel;
  /** Hardware filters to run on the GPU, e.g. [buildHwScaleFilter(...)] */
  gpuFilters: string[];
  /** Software filters to run after downloading, e.g. ['drawtext=...'] */
  cpuFilters?: string[];
  /** Format to download to. Default: 'nv12' */
  downloadFormat?: HwPixelFormat;
}): string {
  const { accel, gpuFilters, cpuFilters = [], downloadFormat = 'nv12' } = opts;
  assertAccel(accel);
  if (gpuFilters.length === 0) {
    throw new Error(
      'buildHwFilterChain: gpuFilters is empty — uploading and downloading with no GPU ' +
        'work in between is always slower than staying in software.',
    );
  }

  const chain: string[] = [];
  chain.push(buildHwUploadFilter({ accel }));
  chain.push(...gpuFilters);
  chain.push(buildHwDownloadFilter(downloadFormat));
  if (cpuFilters.length > 0) chain.push(...cpuFilters);
  return chain.join(',');
}

function assertAccel(accel: string): asserts accel is Hwaccel {
  if (!HWACCELS.includes(accel as Hwaccel)) {
    throw new Error(`Unknown hwaccel "${accel}". Valid: ${HWACCELS.join(', ')}`);
  }
}

export interface HwTranscodeOptions {
  input: string;
  output: string;
  accel: Hwaccel;
  /** GPU filters to run, e.g. [buildHwScaleFilter({...})] */
  gpuFilters: string[];
  /** Software filters after the download. */
  cpuFilters?: string[];
  /** Hardware encoder to use, e.g. 'h264_nvenc'. */
  videoCodec?: string;
  audioCodec?: string;
  downloadFormat?: HwPixelFormat;
  binary?: string;
}

/**
 * Run a transcode with a GPU-resident filter chain.
 *
 * Sets `-hwaccel` and the matching hardware decode format, then applies the
 * upload/GPU/download chain so the frames only cross the bus once.
 */
export async function transcodeWithHwFilters(opts: HwTranscodeOptions): Promise<void> {
  const {
    input,
    output,
    accel,
    gpuFilters,
    cpuFilters,
    videoCodec,
    audioCodec = 'copy',
    downloadFormat = 'nv12',
    binary = resolveBinary(),
  } = opts;

  const filter = buildHwFilterChain(
    cpuFilters !== undefined ? { accel, gpuFilters, cpuFilters, downloadFormat } : { accel, gpuFilters, downloadFormat },
  );

  const builder = new FFmpegBuilder(input)
    .output(output)
    .videoFilter(filter)
    .audioCodec(audioCodec)
    .setBinary(binary);

  if (videoCodec) builder.videoCodec(videoCodec);
  builder.hwAccel(accel);

  await builder.run();
}
