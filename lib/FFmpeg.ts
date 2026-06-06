import { resolveBinary } from './utils/binary.ts';
import {
  probeVersion,
  formatVersion,
} from './utils/version.ts';
import {
  buildGlobalArgs,
  buildInputArgs,
  toBitrate,
  toDuration,
} from './utils/args.ts';
import { spawnFFmpeg, runFFmpeg, type FFmpegProcess } from './process/spawn.ts';
import { CapabilityRegistry } from './codecs/registry.ts';
import {
  guardCodec,
  guardHwaccel,
  guardFeatureVersion,
  selectBestCodec,
  selectBestHwaccel,
  GuardError,
  type CodecCandidate,
  type GuardResult,
} from './compat/guards.ts';
import type { VersionInfo } from './types/version.ts';
import type { GlobalOptions, InputOptions, OutputOptions } from './types/options.ts';
import type { LogLevel } from './types/options.ts';
import type { FilterChain } from './types/filters.ts';
import type { SpawnOptions } from './process/spawn.ts';

interface InputEntry {
  path: string;
  opts: InputOptions;
}

interface OutputEntry {
  path: string;
  opts: OutputOptions;
  videoArgs: string[];
  audioArgs: string[];
  subtitleArgs: string[];
  filterArgs: string[];
}

export class VersionError extends Error {
  constructor(feature: string, required: number, actual: number) {
    super(
      `"${feature}" requires FFmpeg v${required}+, but found v${actual}. ` +
        'Upgrade your FFmpeg installation.',
    );
    this.name = 'VersionError';
  }
}

/**
 * Fluent FFmpeg builder.
 * All methods return `this` for chaining.
 * Call `.run()` to execute or `.spawn()` for event-based control.
 *
 * @example
 * await new FFmpegBuilder('input.mp4')
 *   .videoCodec('libx264')
 *   .videoBitrate('2M')
 *   .audioCodec('aac')
 *   .output('output.mp4')
 *   .run();
 */
export class FFmpegBuilder {
  private _binary: string;
  private _version: VersionInfo | null = null;
  private _registry: CapabilityRegistry | null = null;
  private _globalOpts: GlobalOptions = { overwrite: true };
  private readonly _inputs: InputEntry[] = [];
  private _currentOutput: OutputEntry | null = null;
  private readonly _outputs: OutputEntry[] = [];
  private _complexFilter: string | null = null;

  constructor(input?: string | string[]) {
    this._binary = resolveBinary();
    if (input !== undefined) {
      const inputs = Array.isArray(input) ? input : [input];
      for (const i of inputs) this.input(i);
    }
  }

  // ─── Binary & Version ────────────────────────────────────────────────────

  /** Override the ffmpeg binary path (default: FFMPEG_PATH env or 'ffmpeg') */
  setBinary(path: string): this {
    this._binary = path;
    this._version = null;
    this._registry = null;
    return this;
  }

  /** Get (and cache) the version info for the current binary. */
  getVersion(): VersionInfo {
    if (this._version === null) {
      this._version = probeVersion(this._binary);
    }
    return this._version;
  }

  /** Get (and cache) the capability registry for the current binary. */
  getRegistry(): CapabilityRegistry {
    if (this._registry === null) {
      this._registry = new CapabilityRegistry(this._binary);
    }
    return this._registry;
  }

  // ─── Runtime guards ──────────────────────────────────────────────────────

  /**
   * Check if a codec is available in the current binary.
   * Does not throw — returns a GuardResult.
   */
  checkCodec(codec: string, direction: 'encode' | 'decode' = 'encode'): GuardResult {
    return guardCodec(this.getRegistry(), codec, direction);
  }

  /**
   * Check if a hardware accelerator is available.
   */
  checkHwaccel(accelName: string): GuardResult {
    return guardHwaccel(this.getRegistry(), accelName);
  }

  /**
   * Check if a feature is available by version gate + capability.
   */
  checkFeature(featureKey: string): GuardResult {
    return guardFeatureVersion(this.getVersion(), featureKey);
  }

  /**
   * Select the best available video codec from a priority list.
   * Returns null if none are available.
   *
   * @example
   * const codec = builder.selectVideoCodec([
   *   { codec: 'h264_nvenc', featureKey: 'nvenc' },
   *   { codec: 'h264_vaapi' },
   *   { codec: 'libx264' },
   * ]);
   * builder.videoCodec(codec ?? 'libx264');
   */
  selectVideoCodec(candidates: CodecCandidate[]): string | null {
    return selectBestCodec(this.getVersion(), this.getRegistry(), candidates);
  }

  /**
   * Select the best available hardware accelerator from a priority list.
   */
  selectHwaccel(candidates: string[]): string | null {
    return selectBestHwaccel(this.getRegistry(), candidates);
  }

  // ─── Global Options ───────────────────────────────────────────────────────

  /** Overwrite output files without asking (default: true) */
  overwrite(yes = true): this {
    this._globalOpts.overwrite = yes;
    this._globalOpts.noOverwrite = !yes;
    return this;
  }

  /** Set log level */
  logLevel(level: LogLevel): this {
    this._globalOpts.logLevel = level;
    return this;
  }

  /** Enable progress reporting on stderr */
  enableProgress(): this {
    this._globalOpts.progress = true;
    return this;
  }

  // ─── Inputs ───────────────────────────────────────────────────────────────

  /** Add an input. Chainable input options follow. */
  input(path: string, opts: InputOptions = {}): this {
    this._inputs.push({ path, opts });
    return this;
  }

  /** Seek within the last-added input (fast seek, before -i) */
  seekInput(position: string | number): this {
    const last = this._inputs[this._inputs.length - 1];
    if (last !== undefined) last.opts.seekInput = position;
    return this;
  }

  /** Limit duration of the last-added input */
  inputDuration(duration: string | number): this {
    const last = this._inputs[this._inputs.length - 1];
    if (last !== undefined) last.opts.duration = duration;
    return this;
  }

  /** Force format of the last-added input */
  inputFormat(format: string): this {
    const last = this._inputs[this._inputs.length - 1];
    if (last !== undefined) last.opts.format = format;
    return this;
  }

  // ─── Output ───────────────────────────────────────────────────────────────

  private ensureOutput(): OutputEntry {
    if (this._currentOutput === null) {
      throw new Error(
        'No output defined. Call .output("path") before codec/filter options.',
      );
    }
    return this._currentOutput;
  }

  /** Add (or switch to) an output path. Call before codec/filter options. */
  output(path: string, opts: OutputOptions = {}): this {
    const entry: OutputEntry = {
      path,
      opts,
      videoArgs: [],
      audioArgs: [],
      subtitleArgs: [],
      filterArgs: [],
    };
    this._outputs.push(entry);
    this._currentOutput = entry;
    return this;
  }

  // ─── Video Options ────────────────────────────────────────────────────────

  /** Set video codec, e.g. 'libx264', 'libx265', 'copy' */
  videoCodec(codec: string): this {
    this.ensureOutput().videoArgs.push('-c:v', codec);
    return this;
  }

  /** Set video bitrate, e.g. '2M', '4000k' */
  videoBitrate(bitrate: string | number): this {
    this.ensureOutput().videoArgs.push('-b:v', toBitrate(bitrate));
    return this;
  }

  /** Set output frame rate (-r after -i) */
  fps(rate: string | number): this {
    this.ensureOutput().videoArgs.push('-r', String(rate));
    return this;
  }

  /** Set input frame rate (-r before -i, for raw inputs) */
  inputFps(rate: string | number): this {
    const last = this._inputs[this._inputs.length - 1];
    if (last !== undefined) {
      last.opts.extraArgs ??= [];
      last.opts.extraArgs.push('-r', String(rate));
    }
    return this;
  }

  /** Set output video size, e.g. '1280x720' or '1280:720' */
  size(widthXheight: string): this {
    this.ensureOutput().videoArgs.push('-s', widthXheight);
    return this;
  }

  /** Set video filter chain (-vf). Accepts a filter string or a FilterChain / serialized filter function result. */
  videoFilter(filter: string | FilterChain | { toString(): string }): this {
    this.ensureOutput().filterArgs.push('-vf', String(filter));
    return this;
  }

  /** Set pixel format */
  pixelFormat(fmt: string): this {
    this.ensureOutput().videoArgs.push('-pix_fmt', fmt);
    return this;
  }

  /** Set CRF value (codec-dependent) */
  crf(value: number): this {
    this.ensureOutput().videoArgs.push('-crf', String(value));
    return this;
  }

  /** Disable video stream */
  noVideo(): this {
    this.ensureOutput().videoArgs.push('-vn');
    return this;
  }

  // ─── Audio Options ────────────────────────────────────────────────────────

  /** Set audio codec, e.g. 'aac', 'libopus', 'copy' */
  audioCodec(codec: string): this {
    this.ensureOutput().audioArgs.push('-c:a', codec);
    return this;
  }

  /** Set audio bitrate, e.g. '128k', '192k' */
  audioBitrate(bitrate: string | number): this {
    this.ensureOutput().audioArgs.push('-b:a', toBitrate(bitrate));
    return this;
  }

  /** Set audio sample rate, e.g. 44100, 48000 */
  audioSampleRate(rate: number): this {
    this.ensureOutput().audioArgs.push('-ar', String(rate));
    return this;
  }

  /** Set number of audio channels */
  audioChannels(channels: number): this {
    this.ensureOutput().audioArgs.push('-ac', String(channels));
    return this;
  }

  /** Set audio filter chain (-af). Accepts a filter string or a FilterChain / serialized filter function result. */
  audioFilter(filter: string | FilterChain | { toString(): string }): this {
    this.ensureOutput().filterArgs.push('-af', String(filter));
    return this;
  }

  /** Disable audio stream */
  noAudio(): this {
    this.ensureOutput().audioArgs.push('-an');
    return this;
  }

  // ─── Subtitle Options ─────────────────────────────────────────────────────

  /** Set subtitle codec */
  subtitleCodec(codec: string): this {
    this.ensureOutput().subtitleArgs.push('-c:s', codec);
    return this;
  }

  /** Disable subtitle stream */
  noSubtitle(): this {
    this.ensureOutput().subtitleArgs.push('-sn');
    return this;
  }

  // ─── Output Format & Mapping ──────────────────────────────────────────────

  /** Force output format */
  outputFormat(format: string): this {
    this.ensureOutput().opts.format = format;
    return this;
  }

  /** Add stream mapping, e.g. '0:v:0', '0:a:1' */
  map(specifier: string): this {
    const out = this.ensureOutput();
    out.opts.map ??= [];
    out.opts.map.push(specifier);
    return this;
  }

  /** Limit output duration */
  duration(d: string | number): this {
    this.ensureOutput().opts.duration = d;
    return this;
  }

  /** Seek in output (re-encode seek, accurate) */
  seekOutput(position: string | number): this {
    this.ensureOutput().opts.seekOutput = position;
    return this;
  }

  /** Pass arbitrary extra args for the current output */
  addOutputOption(...args: string[]): this {
    const out = this.ensureOutput();
    out.opts.extraArgs ??= [];
    out.opts.extraArgs.push(...args);
    return this;
  }

  /** Pass arbitrary extra args at the global level */
  addGlobalOption(...args: string[]): this {
    this._globalOpts.extraArgs ??= [];
    this._globalOpts.extraArgs.push(...args);
    return this;
  }

  // ─── Hardware Acceleration ────────────────────────────────────────────────

  /** Enable hardware acceleration (-hwaccel). Does NOT validate availability — use checkHwaccel() first. */
  hwAccel(accel: string, opts?: { device?: string }): this {
    this._globalOpts.extraArgs ??= [];
    this._globalOpts.extraArgs.push('-hwaccel', accel);
    if (opts?.device !== undefined) {
      this._globalOpts.extraArgs.push('-hwaccel_device', opts.device);
    }
    return this;
  }

  // ─── Complex Filter ───────────────────────────────────────────────────────

  /** Set -filter_complex string directly. Only the last call takes effect. */
  complexFilter(filter: string): this {
    this._complexFilter = filter;
    return this;
  }

  // ─── Arg Assembly ─────────────────────────────────────────────────────────

  /** Build and return the full argument array. */
  buildArgs(): string[] {
    const args: string[] = [];

    // Global options
    args.push(...buildGlobalArgs(this._globalOpts));

    // Inputs
    for (const { path, opts } of this._inputs) {
      args.push(...buildInputArgs(opts));
      args.push('-i', path);
    }

    // Complex filter: emitted once after all inputs, before any output-specific flags
    if (this._complexFilter !== null) {
      args.push('-filter_complex', this._complexFilter);
    }

    // Outputs — FFmpeg-correct order: seek/time opts → mapping → codec → filters → format → path
    for (const { path, opts, videoArgs, audioArgs, subtitleArgs, filterArgs } of this._outputs) {
      // 1. Output seek/time options (-ss, -t, -to) — must come first
      if (opts.seekOutput !== undefined) args.push('-ss', toDuration(opts.seekOutput));
      if (opts.to !== undefined) args.push('-to', toDuration(opts.to));
      if (opts.duration !== undefined) args.push('-t', toDuration(opts.duration));

      // 2. -map directives
      if (opts.map !== undefined) {
        for (const m of opts.map) args.push('-map', m);
      }

      // 3. Codec options (-c:v, -c:a, -c:s, -b:v, -b:a, etc.)
      args.push(...videoArgs);
      args.push(...audioArgs);
      args.push(...subtitleArgs);

      // 4. Filter options (-vf, -af)
      args.push(...filterArgs);

      // 5. Format and extra args
      if (opts.format !== undefined) args.push('-f', opts.format);
      if (opts.extraArgs !== undefined) args.push(...opts.extraArgs);

      // 6. Output path
      args.push(path);
    }

    return args;
  }

  // ─── Execution ────────────────────────────────────────────────────────────

  private _buildSpawnOpts(opts?: { parseProgress?: boolean; totalDurationUs?: number }): SpawnOptions {
    const spawnOpts: SpawnOptions = {
      binary: this._binary,
      args: this.buildArgs(),
      parseProgress: opts?.parseProgress ?? this._globalOpts.progress === true,
    };
    if (opts?.totalDurationUs !== undefined) {
      spawnOpts.totalDurationUs = opts.totalDurationUs;
    }
    return spawnOpts;
  }

  /**
   * Spawn the process with full event-emitter control.
   * Useful for streaming progress or piping stdout.
   */
  spawn(opts?: { parseProgress?: boolean; totalDurationUs?: number }): FFmpegProcess {
    return spawnFFmpeg(this._buildSpawnOpts(opts));
  }

  /**
   * Run ffmpeg and return a Promise that resolves on success.
   * Rejects with FFmpegSpawnError on non-zero exit.
   */
  async run(opts?: { parseProgress?: boolean; totalDurationUs?: number }): Promise<void> {
    await runFFmpeg(this._buildSpawnOpts(opts));
  }

  /**
   * Probe the binary version and return a human-readable string.
   * Also caches the version for subsequent requireVersion() checks.
   */
  async versionString(): Promise<string> {
    const v = await this.getVersion();
    return formatVersion(v);
  }

  /**
   * Return the CLI arguments without running ffmpeg.
   * Useful for dry-runs, inspection, or custom piping.
   *
   * @example
   * const args = ffmpeg('input.mp4').videoCodec('libx264').output('out.mp4').dry();
   * // args: ['-i', 'input.mp4', '-c:v', 'libx264', '-c:a', 'aac', 'out.mp4']
   */
  dry(): string[] {
    return this.buildArgs();
  }

  /**
   * Return a human-readable command line string.
   * Useful for debugging or logging.
   */
  dryCommand(): string {
    const args = this.dry();
    const quoted = args.map(a => /[^\w/.\-@:=_,+~]/.test(a) ? `'${a.replace(/'/g, "'\\''")}'` : a);
    return `${this._binary} ${quoted.join(' ')}`;
  }
}

/**
 * Factory function — the primary public API entry point.
 *
 * @example
 * import { ffmpeg } from 'mediaforge';
 * await ffmpeg('input.mp4').videoCodec('libx264').output('out.mp4').run();
 */
export function ffmpeg(input?: string | string[]): FFmpegBuilder {
  return new FFmpegBuilder(input);
}

// Re-export for convenience
export { GuardError };
export type { CodecCandidate, GuardResult };
