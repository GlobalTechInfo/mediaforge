/**
 * Task commands that expose the rest of the library surface.
 *
 * `tasks.ts` covers the common editing operations. This module covers the parts
 * of the public API that had no CLI equivalent at all: the typed filter
 * registry, filter graphs, encoder argument builders, the stream-mapping DSL,
 * presets, media analysis, hardware filter chains, and the pure arg builders.
 *
 * The guiding rule is that anything reachable from `lib/index.ts` should be
 * reachable from `mediaforge …`. Where a library export is deliberately
 * library-only it is listed in `LIBRARY_ONLY` below with the reason, so a
 * missing CLI command is always a decision rather than an oversight.
 */
import * as m from '../index.ts';
import { FilterChain } from '../types/filters.ts';
import { FILTER_REGISTRY, filterNames } from './filter-registry.ts';
import { bool, list, num, parseOptions, requireFlag, str } from './flags.ts';
import type { PcmFormat, PcmOptions } from '../codecs/audio.ts';
import type { CliFlags, CliTask } from './types.ts';

type Rec = Record<string, string | number | boolean>;

function need(pos: string[], task: string, n: number): string[] {
  if (pos.length < n) {
    throw new Error(
      `${task} needs ${n} argument${n === 1 ? '' : 's'}. Usage: ${EXTRA_TASKS[task]?.usage ?? task}`,
    );
  }
  return pos;
}

/** Render an argv array as a copy/pasteable shell command. */
function shellQuote(args: string[]): string {
  return args
    .map(a => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`))
    .join(' ');
}

function printArgs(title: string, args: string[]): void {
  console.log(`${title}\n${shellQuote(args)}`);
}

// ─── Option readers ──────────────────────────────────────────────────────────

/**
 * Typed accessors over a bag of `key=value` CLI options.
 *
 * `json` exists because several arg builders take arrays, records or tuples
 * with no scalar CLI representation; those options are declared as JSON and
 * parsed here rather than being silently stringified.
 */
interface Opts {
  /** Raw value, or undefined when the option was not supplied. */
  v(k: string): string | number | boolean | undefined;
  /** Required string. */
  s(k: string): string;
  /** Optional string. */
  so(k: string): string | undefined;
  /** Required number. */
  n(k: string): number;
  /** Optional number. */
  no(k: string): number | undefined;
  /** JSON value, or `fallback` when the option was not supplied. */
  json<T>(k: string, fallback: T): T;
  /** Split a whitespace-separated option into argv tokens. */
  argv(k: string): string[];
  /** Split a comma-separated option, trimming each entry. */
  csv(k: string): string[];
}

function makeOpts(rec: Rec): Opts {
  const present = (k: string): string | number | boolean | undefined => rec[k];
  const asString = (k: string): string => {
    const v = present(k);
    if (v === undefined) throw new Error(`"${k}" is required`);
    // The CLI coerces `key=2` to a number, and several builders take a numeric
    // option typed as a string, so a number is stringified rather than rejected.
    if (typeof v === 'number') return String(v);
    if (typeof v !== 'string') throw new Error(`"${k}" must be a string or a number`);
    return v;
  };
  const asNumber = (k: string): number => {
    const v = present(k);
    if (v === undefined) throw new Error(`"${k}" is required`);
    if (typeof v !== 'number') throw new Error(`"${k}" must be a number`);
    return v;
  };
  const opt = <T>(k: string, want: 'string' | 'number', cb: (v: string | number) => T): T | undefined => {
    const v = present(k);
    if (v === undefined) return undefined;
    // A numeric option must keep its number: builders that validate ranges
    // (silenceremove's dB threshold, for one) reject a stringified "-40".
    if (want === 'number') {
      if (typeof v !== 'number') throw new Error(`"${k}" must be a number`);
      return cb(v);
    }
    return cb(asString(k));
  };
  const o: Opts = {
    v: present,
    s: asString,
    so: k => opt(k, 'string', v => v as string),
    n: asNumber,
    no: k => opt(k, 'number', v => v as number),
    json<T>(k: string, fallback: T): T {
      const raw = o.so(k);
      if (raw === undefined || raw === '') return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch (err) {
        throw new Error(`"${k}" must be valid JSON: ${(err as Error).message}`);
      }
    },
    argv: k => (o.so(k) ?? '').split(/\s+/).filter(Boolean),
    csv: k => (o.so(k) ?? '').split(',').map(x => x.trim()).filter(Boolean),
  };
  return o;
}

// ─── Filters ─────────────────────────────────────────────────────────────────

/** Apply a `name:key=value|key=value|name2` chain spec to a fresh FilterChain. */
function applyChain(spec: string, forceAudio: boolean): { chain: string; audio: boolean } {
  const chain = new FilterChain();
  let audio = forceAudio;
  for (const seg of spec.split('|').map(x => x.trim()).filter(Boolean)) {
    const colon = seg.indexOf(':');
    const name = colon === -1 ? seg : seg.slice(0, colon);
    const entry = FILTER_REGISTRY[name];
    if (entry === undefined) {
      throw new Error(`unknown filter "${name}" in --chain. Run \`mediaforge filter --list\`.`);
    }
    const rec: Rec = colon === -1
      ? {}
      : parseOptions(seg.slice(colon + 1).split(',').filter(Boolean));
    for (const req of entry.required ?? []) {
      if (rec[req] === undefined) throw new Error(`filter "${name}" requires ${req}=<value>`);
    }
    entry.apply(chain, rec);
    if (entry.stream === 'audio') audio = true;
  }
  return { chain: chain.toString(), audio };
}

/** Encode a FilterChain with an explicit -vf or -af. */
async function runWithFilter(
  chain: string,
  audio: boolean,
  input: string,
  output: string,
  f: CliFlags,
): Promise<void> {
  const b = m.ffmpeg(input).output(output);
  if (audio) {
    b.audioFilter(chain).audioCodec(str(f, 'acodec') ?? 'aac');
  } else {
    b.videoFilter(chain)
      .videoCodec(str(f, 'codec') ?? 'libx264')
      .audioCodec(str(f, 'acodec') ?? 'aac');
  }
  await b.run();
  console.log(`Wrote ${output}`);
}

// ─── Codec arg builders ──────────────────────────────────────────────────────

/**
 * Every value `PcmFormat` accepts, in the type's own order. Typed as the union so
 * a format added to the library without a CLI entry is a compile error.
 */
const PCM_FORMATS: readonly PcmFormat[] = [
  'pcm_s16le', 'pcm_s16be', 'pcm_s24le', 'pcm_s24be', 'pcm_s32le', 'pcm_s32be',
  'pcm_f32le', 'pcm_f32be', 'pcm_f64le', 'pcm_f64be', 'pcm_u8', 'pcm_s8',
  'pcm_alaw', 'pcm_mulaw',
];

/** A required positional that precedes the options, e.g. PCM's sample format. */
interface CodecLeading {
  /** Placeholder used in the usage line, e.g. `<format>`. */
  label: string;
  /** The accepted values, checked before the builder is called. */
  values: readonly string[];
}

interface CodecEntry {
  keys: string[];
  /** Set for builders that take a positional before their options object. */
  leading?: CodecLeading;
  /** Receives the parsed `key=value` options, coerced to the builder's types. */
  build: (rec: Rec, leading?: string) => string[];
}

/** Shorthand that keeps the table readable. */
function codec(keys: string[], fn: (o: never) => string[]): CodecEntry {
  // The builders take a typed options object rather than an argv list, so the
  // CLI's coerced `key=value` record is handed straight through.
  return { keys, build: rec => fn(rec as never) };
}

const CODEC_BUILDERS = new Map<string, CodecEntry>([
  ['x264', codec(
    ['preset', 'tune', 'profile', 'crf', 'qp', 'bFrames', 'bPyramid', 'aqMode', 'aqStrength', 'weightp', 'refs', 'subq', 'me', 'meRange', 'trellis', 'deblock', 'nalHrd', 'bitrate', 'maxrate', 'bufsize', 'qpMin', 'qpMax', 'keyintMax', 'keyintMin', 'scenecutThreshold', 'x264Params', 'pixFmt'],
    m.x264ToArgs,
  )],
  ['x265', codec(
    ['preset', 'tune', 'profile', 'crf', 'qp', 'bitrate', 'maxrate', 'bufsize', 'keyintMax', 'bFrames', 'refs', 'dolbyVision', 'x265Params', 'pixFmt'],
    m.x265ToArgs,
  )],
  ['svtav1', codec(
    ['preset', 'crf', 'qp', 'bitrate', 'bFrames', 'keyintMax', 'enableSceneDetect', 'dolbyVision', 'svtav1Params', 'pixFmt'],
    m.svtav1ToArgs,
  )],
  ['vp9', codec(
    ['bitrate', 'minrate', 'maxrate', 'crf', 'quality', 'cpuUsed', 'tileColumns', 'tileRows', 'rowMt', 'aqMode', 'lagInFrames', 'autoAltRef', 'arnrMaxFrames', 'pass', 'passlogfile', 'keyintMax', 'pixFmt', 'deadline'],
    m.vp9ToArgs,
  )],
  ['prores', codec(['profile', 'bits', 'vendor', 'alphaQuality', 'mbs'], m.proResToArgs)],
  ['dnxhd', codec(['profile', 'bitrate', 'pixFmt'], m.dnxhdToArgs)],
  ['mjpeg', codec(['qscale', 'huffman', 'pixFmt'], m.mjpegToArgs)],
  ['mpeg2', codec(['bitrate', 'maxrate', 'bufsize', 'gopSize', 'profile', 'level', 'interlaced'], m.mpeg2ToArgs)],
  ['mpeg4', codec(['bitrate', 'maxrate', 'qscale', 'gopSize', 'bFrames', 'me'], m.mpeg4ToArgs)],
  ['vp8', codec(['bitrate', 'minrate', 'maxrate', 'crf', 'cpuUsed', 'quality', 'keyintMax'], m.vp8ToArgs)],
  ['theora', codec(['qscale', 'bitrate'], m.theoraToArgs)],
  ['ffv1', codec(['level', 'context', 'slices', 'sliceCrc'], m.ffv1ToArgs)],
  ['nvenc', codec(
    ['preset', 'tune', 'rcMode', 'constqp', 'bitrate', 'maxrate', 'bufsize', 'cq', 'qpI', 'qpP', 'qpB', 'bFrames', 'refs', 'gopSize', 'aqStrength', 'temporalAq', 'weightedPred', 'level', 'profile', 'rcLookahead', 'gpuDevice'],
    m.nvencToArgs,
  )],
  ['vaapi', codec(['qp', 'bitrate', 'maxrate', 'keyintMax', 'bFrames', 'refs', 'profile', 'level', 'rcMode'], m.vaapiToArgs)],
  ['qsv', codec(['preset', 'globalQuality', 'bitrate', 'maxrate', 'gopSize', 'bFrames', 'lowLatency'], m.qsvToArgs)],
  ['mediacodec', codec(['ndkCodec', 'bitrate', 'iFrameInterval', 'level'], m.mediacodecToArgs)],
  ['vulkan', codec(['bitrate', 'qp', 'gopSize', 'bFrames'], m.vulkanToArgs)],
  ['amf', codec(['bitrate', 'qp', 'quality', 'rateControl', 'maxrate', 'gopSize'], m.amfToArgs)],
  ['videotoolbox', codec(['bitrate', 'quality', 'allowFrameReordering', 'maxKeyFrameInterval', 'profile'], m.videotoolboxToArgs)],
  ['aac', codec(['aacCoder', 'vbr', 'bitrate', 'sampleRate', 'channels', 'channelLayout', 'sampleFmt', 'profile'], m.aacToArgs)],
  ['opus', codec(['bitrate', 'vbr', 'application', 'frameDuration', 'compressionLevel', 'packetLoss', 'fec', 'dtx', 'channels', 'sampleRate'], m.opusToArgs)],
  ['mp3', codec(['qscale', 'bitrate', 'compressionLevel', 'reservoir', 'jointStereo', 'abr', 'sampleRate', 'channels'], m.mp3ToArgs)],
  ['flac', codec(['compressionLevel', 'lpcOrder', 'lpcCoeffPrecision', 'predictionOrderMethod', 'minPartitionOrder', 'maxPartitionOrder'], m.flacToArgs)],
  ['ac3', codec(['bitrate', 'dialogueLevel', 'centerMixLevel', 'surroundMixLevel', 'audioCodingMode', 'channels', 'sampleRate'], m.ac3ToArgs)],
  ['alac', codec(['minPredictionOrder', 'maxPredictionOrder'], m.alacToArgs)],
  ['eac3', codec(['bitrate', 'dialNorm', 'mixLevel', 'roomType', 'centerMixLevel', 'surroundMixLevel'], m.eac3ToArgs)],
  ['truehd', codec(['sampleRate', 'channelLayout'], m.truehdToArgs)],
  ['vorbis', codec(['qscale', 'bitrate', 'minrate', 'maxrate', 'cutoff', 'sampleRate', 'channels'], m.vorbisToArgs)],
  ['wavpack', codec(['quality', 'bitrate', 'extra'], m.wavpackToArgs)],
  // `pcmToArgs` takes the sample format as its first argument, so this one entry
  // carries a leading positional instead of taking the options object first.
  ['pcm', {
    keys: ['sampleRate', 'channels'],
    leading: { label: '<format>', values: PCM_FORMATS },
    build: (rec, format) => m.pcmToArgs((format ?? 'pcm_s16le') as PcmFormat, rec as PcmOptions),
  }],
  ['mp2', codec(['bitrate', 'sampleRate'], m.mp2ToArgs)],
  // Alias exports of the same builders, so the shorter command names and the
  // library names both work.
  ['libmp3lame', codec(['qscale', 'bitrate', 'compressionLevel', 'reservoir', 'jointStereo', 'abr', 'sampleRate', 'channels'], m.libMp3LameToArgs)],
  ['libopus', codec(['bitrate', 'vbr', 'application', 'frameDuration', 'compressionLevel', 'packetLoss', 'fec', 'dtx', 'channels', 'sampleRate'], m.libOpusToArgs)],
  ['svt-av1', codec(['preset', 'crf', 'qp', 'bitrate', 'bFrames', 'keyintMax', 'enableSceneDetect', 'dolbyVision', 'svtav1Params', 'pixFmt'], m.svtAv1ToArgs)],
  ['mediacodec-video', codec(['bitrate', 'quality', 'operatingRate', 'profile', 'level'], m.mediacodecVideoToArgs)],
  ['vulkan-video', codec(['crf', 'bitrate'], m.vulkanVideoToArgs)],
]);

// ─── Arg-builder ops ─────────────────────────────────────────────────────────

interface ArgOp {
  description: string;
  /** `args` builders take positional parameters; `opts` builders take an object. */
  kind: 'args' | 'opts';
  /** Option names, in positional order for `args` builders. */
  keys: string[];
  required: string[];
  /**
   * Produces the values to print. Most builders return an argv array; the
   * filter-string builders and the parsers return a single string, which the
   * caller normalises.
   */
  run: (o: Opts) => ArgOpResult;
}

/** Builders are sync except the ones that shell out to parse a measurement. */
type ArgOpResult = Array<string | string[]> | Promise<Array<string | string[]>>;

/** Shorthand for a builder that takes positional parameters. */
function argOp(
  description: string,
  keys: string[],
  required: string[],
  fn: (o: Opts) => ArgOpResult,
): ArgOp {
  return { description, kind: 'args', keys, required, run: fn };
}

/** Shorthand for a builder that takes an options object. */
function optOp(
  description: string,
  keys: string[],
  required: string[],
  fn: (o: Opts) => ArgOpResult,
): ArgOp {
  return { description, kind: 'opts', keys, required, run: fn };
}

const ARG_OPS = new Map<string, ArgOp>([
  ['global', optOp('buildGlobalArgs — -y/-n/-loglevel/-progress/-stats_period',
    ['overwrite', 'noOverwrite', 'logLevel', 'progress', 'statsInterval', 'extraArgs'], [],
    o => [m.buildGlobalArgs(o.v('overwrite') !== undefined || o.v('logLevel') !== undefined
      ? {
        ...(o.v('overwrite') !== undefined ? { overwrite: true } : {}),
        ...(o.so('logLevel') !== undefined ? { logLevel: o.so('logLevel') as never } : {}),
        ...(o.v('noOverwrite') !== undefined ? { noOverwrite: true } : {}),
        ...(o.v('progress') !== undefined ? { progress: true } : {}),
        ...(o.no('statsInterval') !== undefined ? { statsInterval: o.no('statsInterval')! } : {}),
        ...(o.argv('extraArgs').length > 0 ? { extraArgs: o.argv('extraArgs') } : {}),
      }
      : {
        ...(o.v('noOverwrite') !== undefined ? { noOverwrite: true } : {}),
        ...(o.v('progress') !== undefined ? { progress: true } : {}),
        ...(o.no('statsInterval') !== undefined ? { statsInterval: o.no('statsInterval')! } : {}),
        ...(o.argv('extraArgs').length > 0 ? { extraArgs: o.argv('extraArgs') } : {}),
      })])],

  ['input', optOp('buildInputArgs — -loop/-f/-r/-ss/-to/-t',
    ['loop', 'format', 'frameRate', 'seekInput', 'to', 'duration'], [],
    o => [m.buildInputArgs({
      ...(o.no('loop') !== undefined ? { loop: o.no('loop')! } : {}),
      ...(o.so('format') !== undefined ? { format: o.so('format')! } : {}),
      ...(o.v('frameRate') !== undefined ? { frameRate: o.v('frameRate') as string | number } : {}),
      ...(o.v('seekInput') !== undefined ? { seekInput: o.v('seekInput') as string | number } : {}),
      ...(o.v('to') !== undefined ? { to: o.v('to') as string | number } : {}),
      ...(o.v('duration') !== undefined ? { duration: o.v('duration') as string | number } : {}),
    })])],

  ['output', optOp('buildOutputArgs — output -ss/-to/-t/-f and repeated -map',
    ['seekOutput', 'duration', 'to', 'format', 'map'], [],
    o => [m.buildOutputArgs({
      ...(o.v('seekOutput') !== undefined ? { seekOutput: o.v('seekOutput') as string | number } : {}),
      ...(o.v('duration') !== undefined ? { duration: o.v('duration') as string | number } : {}),
      ...(o.v('to') !== undefined ? { to: o.v('to') as string | number } : {}),
      ...(o.so('format') !== undefined ? { format: o.so('format')! } : {}),
      ...(o.csv('map').length > 0 ? { map: o.csv('map') } : {}),
    })])],

  ['screenshot', argOp('buildScreenshotArgs — one frame at a timestamp',
    ['input', 'output', 'timestamp', 'size'], ['input', 'output', 'timestamp'],
    o => [m.buildScreenshotArgs(o.s('input'), o.s('output'), o.n('timestamp'), o.so('size'))])],

  ['framebuffer', argOp('buildFrameBufferArgs — one frame to stdout in a raw format',
    ['input', 'timestamp', 'format', 'size'], ['input', 'timestamp', 'format'],
    o => [m.buildFrameBufferArgs(o.s('input'), o.n('timestamp'), o.s('format'), o.so('size'))])],

  ['timestamp-filename', argOp('buildTimestampFilename — expand frame_%04d style patterns',
    ['pattern', 'index', 'ext'], ['pattern', 'index', 'ext'],
    o => [[m.buildTimestampFilename(o.s('pattern'), o.n('index'), o.s('ext'))]])],

  ['frames', argOp('buildExtractFramesArgs — extract frames at an fps',
    ['input', 'output', 'fps', 'startTime', 'endTime', 'size', 'format'], ['input', 'output', 'fps'],
    o => [m.buildExtractFramesArgs(
      o.s('input'), o.s('output'), o.s('fps'),
      o.so('startTime'), o.so('endTime'), o.so('size'), o.so('format') ?? 'png',
    )])],

  ['gif', argOp('buildGifArgs — the palettegen and paletteuse passes',
    ['input', 'palette', 'output', 'fps', 'width', 'dither', 'startTime', 'duration', 'colors'],
    ['input', 'palette', 'output', 'fps', 'width', 'dither'],
    o => {
      const g = m.buildGifArgs(
        o.s('input'), o.s('palette'), o.s('output'),
        o.n('fps'), o.n('width'), o.s('dither'),
        o.so('startTime'), o.so('duration'), o.no('colors') ?? 256,
      );
      return [g.pass1, g.pass2];
    })],

  ['gif-palette', argOp('buildGifPalettegenFilter / buildGifPaletteuseFilter',
    ['fps', 'width', 'colors', 'dither'], ['fps', 'width'],
    o => [[
      m.buildGifPalettegenFilter(o.n('fps'), o.n('width'), o.no('colors') ?? 256),
      m.buildGifPaletteuseFilter(o.n('fps'), o.n('width'), o.so('dither') ?? 'sierra2_4a'),
    ].join('\n')])],

  ['hls', optOp('buildHlsArgs — HLS muxer arguments',
    ['input', 'outputDir', 'segmentDuration', 'playlistName', 'hlsListSize', 'hlsFlags', 'videoCodec', 'videoBitrate', 'audioCodec', 'audioBitrate'],
    ['input', 'outputDir'],
    o => [m.buildHlsArgs(o.s('input'), o.s('outputDir'), {
      ...(o.no('segmentDuration') !== undefined ? { segmentDuration: o.no('segmentDuration')! } : {}),
      ...(o.so('playlistName') !== undefined ? { playlistName: o.so('playlistName')! } : {}),
      ...(o.no('hlsListSize') !== undefined ? { hlsListSize: o.no('hlsListSize')! } : {}),
      ...(o.so('hlsFlags') !== undefined ? { hlsFlags: o.so('hlsFlags')! } : {}),
      ...(o.so('videoCodec') !== undefined ? { videoCodec: o.so('videoCodec')! } : {}),
      ...(o.so('videoBitrate') !== undefined ? { videoBitrate: o.so('videoBitrate')! } : {}),
      ...(o.so('audioCodec') !== undefined ? { audioCodec: o.so('audioCodec')! } : {}),
      ...(o.so('audioBitrate') !== undefined ? { audioBitrate: o.so('audioBitrate')! } : {}),
    })])],

  ['dash', optOp('buildDashArgs — DASH muxer arguments',
    ['input', 'output', 'segmentDuration', 'videoCodec', 'videoBitrate', 'audioCodec', 'audioBitrate'],
    ['input', 'output'],
    o => [m.buildDashArgs(o.s('input'), o.s('output'), {
      ...(o.no('segmentDuration') !== undefined ? { segmentDuration: o.no('segmentDuration')! } : {}),
      ...(o.so('videoCodec') !== undefined ? { videoCodec: o.so('videoCodec')! } : {}),
      ...(o.so('videoBitrate') !== undefined ? { videoBitrate: o.so('videoBitrate')! } : {}),
      ...(o.so('audioCodec') !== undefined ? { audioCodec: o.so('audioCodec')! } : {}),
      ...(o.so('audioBitrate') !== undefined ? { audioBitrate: o.so('audioBitrate')! } : {}),
    })])],

  ['metadata', optOp('buildMetadataArgs — -metadata and -metadata:s: arguments',
    ['global', 'streams'], ['global'],
    o => [m.buildMetadataArgs(
      o.json<Record<string, string>>('global', {}),
      o.json<Record<string, Record<string, string>>>('streams', {}),
    )])],

  ['chapters', optOp('buildChapterContent — an ffmetadata chapter file body',
    ['chapters'], ['chapters'],
    o => [[m.buildChapterContent(o.json('chapters', []))]])],

  ['two-pass', optOp('buildTwoPassArgs — both passes plus the passlog path',
    ['input', 'output', 'videoBitrate', 'videoCodec', 'audioCodec', 'audioBitrate', 'passlogfile'],
    ['input', 'output', 'videoBitrate'],
    o => {
      const t = m.buildTwoPassArgs({
        input: o.s('input'),
        output: o.s('output'),
        videoBitrate: o.s('videoBitrate'),
        videoCodec: o.so('videoCodec') ?? 'libx264',
        ...(o.so('audioCodec') !== undefined ? { audioCodec: o.so('audioCodec')! } : {}),
        ...(o.so('audioBitrate') !== undefined ? { audioBitrate: o.so('audioBitrate')! } : {}),
        ...(o.so('passlogfile') !== undefined ? { passlogfile: o.so('passlogfile')! } : {}),
      });
      return [t.pass1, t.pass2, ['-passlogfile', t.passlog]];
    })],

  ['pipe', argOp('buildPipeThroughArgs — transcode through a pipe',
    ['inputFormat', 'outputArgs', 'outputFormat'], ['outputArgs'],
    o => [m.buildPipeThroughArgs(o.so('inputFormat'), o.argv('outputArgs'), o.so('outputFormat'))])],

  ['stream-output', argOp('buildStreamOutputArgs — one stream to stdout in a container',
    ['input', 'outputArgs', 'outputFormat', 'seekInput'], ['input', 'outputArgs', 'outputFormat'],
    o => [m.buildStreamOutputArgs(o.s('input'), o.argv('outputArgs'), o.s('outputFormat'), o.so('seekInput'))])],

  ['concat-transitions', argOp('buildConcatTransitionArgs — the xfade filter_complex',
    ['inputs', 'output', 'transition', 'duration', 'videoCodec', 'audioCodec', 'fps', 'resolution', 'audioFormat', 'durations'],
    ['inputs', 'output', 'transition', 'duration'],
    o => [m.buildConcatTransitionArgs(
      o.csv('inputs'),
      o.s('output'),
      o.s('transition') as never,
      o.n('duration'),
      o.so('videoCodec') ?? 'libx264',
      o.so('audioCodec') ?? 'aac',
      o.so('fps'),
      o.so('resolution'),
      o.so('audioFormat'),
      o.json<number[]>('durations', []),
    )])],

  ['loudnorm', optOp('buildLoudnormFilter — the two-pass loudnorm filter string',
    ['targetI', 'targetLra', 'targetTp', 'measured'], ['targetI', 'targetLra', 'targetTp'],
    o => {
      // The two-pass form needs measurements; the one-pass form must not be
      // given an empty `measured`, which the builder rejects.
      const measured = o.json<{
        inputI?: number; inputLra?: number; inputTp?: number;
        inputThresh?: number; targetOffset?: number;
      }>('measured', {});
      return [o.v('measured') === undefined
        ? m.buildLoudnormFilter(o.n('targetI'), o.n('targetLra'), o.n('targetTp'))
        : m.buildLoudnormFilter(o.n('targetI'), o.n('targetLra'), o.n('targetTp'), measured)];
    })],

  ['abr-filter', optOp('buildAbrLadderFilter — the split/scale/hwdownload ABR graph',
    ['variants'], ['variants'],
    o => [m.buildAbrLadderFilter({ variants: o.json('variants', []) })])],

  ['abr-args', optOp('buildAbrLadderArgs — the multi-variant HLS encode arguments',
    ['input', 'outputPattern', 'variants', 'segmentDuration', 'videoCodec', 'audioCodec', 'masterPlaylist', 'hlsFlags'],
    ['input', 'outputPattern', 'variants'],
    o => [m.buildAbrLadderArgs({
      input: o.s('input'),
      outputPattern: o.s('outputPattern'),
      variants: o.json('variants', []),
      ...(o.no('segmentDuration') !== undefined ? { segmentDuration: o.no('segmentDuration')! } : {}),
      ...(o.so('videoCodec') !== undefined ? { videoCodec: o.so('videoCodec')! } : {}),
      ...(o.so('audioCodec') !== undefined ? { audioCodec: o.so('audioCodec')! } : {}),
      ...(o.so('masterPlaylist') !== undefined ? { masterPlaylist: o.so('masterPlaylist')! } : {}),
      ...(o.so('hlsFlags') !== undefined ? { hlsFlags: o.so('hlsFlags')! } : {}),
    })])],

  ['var-stream-map', optOp('buildVarStreamMap — the -var_stream_map value for a ladder',
    ['variants'], ['variants'],
    o => {
      const r = m.buildVarStreamMap(o.json('variants', []));
      return [[`-var_stream_map ${r.map}`, `stream count: ${r.streamCount}`]];
    })],

  ['abr-validate', optOp('validateAbrVariants — check a ladder before encoding',
    ['variants', 'context'], ['variants'],
    o => {
      m.validateAbrVariants(o.json('variants', []), o.so('context') ?? 'mediaforge abr');
      return [['ABR variants are valid']];
    })],

  ['atempo-chain', argOp('buildAtempoChain — the atempo chain for a speed factor',
    ['speed'], ['speed'],
    o => [m.buildAtempoChain(o.n('speed'))])],

  ['to-duration', argOp('toDuration — normalise a duration argument',
    ['value'], ['value'],
    o => [m.toDuration(o.s('value'))])],

  ['to-bitrate', argOp('toBitrate — normalise a bitrate argument',
    ['value'], ['value'],
    o => [m.toBitrate(o.s('value'))])],

  ['parse-duration', argOp('parseDuration — parse a duration string to seconds',
    ['value'], ['value'],
    o => [String(m.parseDuration(o.s('value')))])],

  ['parse-bitrate', argOp('parseBitrate — parse a bitrate string to bits per second',
    ['value'], ['value'],
    o => [String(m.parseBitrate(o.s('value')))])],

  ['parse-framerate', argOp('parseFrameRate — parse an N/D frame rate',
    ['value'], ['value'],
    o => [JSON.stringify(m.parseFrameRate(o.s('value')), null, 2)])],

  ['duration-to-us', argOp('durationToMicroseconds — seconds to microseconds',
    ['seconds'], ['seconds'],
    o => [String(m.durationToMicroseconds(o.n('seconds')))])],

  ['subtitle-codec', argOp('subtitleCodecFor — the ffmpeg subtitle codec for a format',
    ['format'], ['format'],
    o => [m.subtitleCodecFor(o.s('format') as never)])],

  ['subtitle-extension', argOp('subtitleExtensionFor — the file extension for a format',
    ['format'], ['format'],
    o => [m.subtitleExtensionFor(o.s('format') as never)])],


  ['version-satisfies', argOp('satisfiesVersion — check the installed ffmpeg against a minimum',
    ['minMajor', 'minMinor', 'minPatch'], ['minMajor'],
    o => {
      const v = m.probeVersion(m.resolveBinary());
      return [String(m.satisfiesVersion(v, o.n('minMajor'), o.no('minMinor') ?? 0, o.no('minPatch') ?? 0))];
    })],

  ['silence-detect', argOp('buildSilenceDetectFilter — the silencedetect filter string',
    ['threshold', 'minDuration'], [],
    o => [m.buildSilenceDetectFilter(o.no('threshold') ?? -50, o.no('minDuration') ?? 0.5)])],

  ['silence-remove', optOp('buildSilenceRemoveFilter — the silenceremove filter string',
    ['threshold', 'minDuration'], [],
    o => [m.buildSilenceRemoveFilter({
      ...(o.no('threshold') !== undefined ? { threshold: o.no('threshold')! } : {}),
      ...(o.no('minDuration') !== undefined ? { minDuration: o.no('minDuration')! } : {}),
    })])],

  ['scene-cut', optOp('buildSceneCutArgs — one output per detected scene',
    ['scenes', 'trimStart', 'endTime'], ['scenes'],
    o => [m.buildSceneCutArgs(o.json('scenes', []), {
      ...(o.no('trimStart') !== undefined ? { trimStart: o.no('trimStart')! } : {}),
      ...(o.no('endTime') !== undefined ? { endTime: o.no('endTime')! } : {}),
    })])],

  ['segments', optOp('buildSegmentArgs — fixed-length segments with forced keyframes',
    ['input', 'outputPattern', 'segmentTime', 'forceKeyFrames', 'resetTimestamps', 'videoCodec', 'audioCodec'],
    ['input', 'outputPattern'],
    o => [m.buildSegmentArgs({
      input: o.s('input'),
      outputPattern: o.s('outputPattern'),
      ...(o.no('segmentTime') !== undefined ? { segmentTime: o.no('segmentTime')! } : {}),
      ...(o.v('forceKeyFrames') !== undefined ? { forceKeyFrames: o.v('forceKeyFrames') !== false && o.v('forceKeyFrames') !== 'false' } : {}),
      ...(o.v('resetTimestamps') !== undefined ? { resetTimestamps: o.v('resetTimestamps') !== false && o.v('resetTimestamps') !== 'false' } : {}),
      ...(o.so('videoCodec') !== undefined ? { videoCodec: o.so('videoCodec')! } : {}),
      ...(o.so('audioCodec') !== undefined ? { audioCodec: o.so('audioCodec')! } : {}),
    })])],

  ['tonemap', optOp('buildToneMapFilter — the HDR→SDR zscale+tonemap chain',
    ['algorithm', 'peak', 'targetPeak', 'parameter', 'desaturation'], [],
    o => [m.buildToneMapFilter({
      ...(o.so('algorithm') !== undefined ? { algorithm: o.so('algorithm') as never } : {}),
      ...(o.no('peak') !== undefined ? { peak: o.no('peak')! } : {}),
      ...(o.no('targetPeak') !== undefined ? { targetPeak: o.no('targetPeak')! } : {}),
      ...(o.no('parameter') !== undefined ? { parameter: o.no('parameter')! } : {}),
      ...(o.no('desaturation') !== undefined ? { desaturation: o.no('desaturation')! } : {}),
    })])],

  ['interpolate', optOp('buildInterpolateFilter — the frame interpolation filter string',
    ['fps', 'method', 'mcMode', 'meMode', 'mbSize', 'meMethod'], ['fps'],
    o => [m.buildInterpolateFilter({
      fps: o.n('fps'),
      ...(o.so('method') !== undefined ? { method: o.so('method') as never } : {}),
      ...(o.so('mcMode') !== undefined ? { mcMode: o.so('mcMode') as never } : {}),
      ...(o.so('meMode') !== undefined ? { meMode: o.so('meMode') as never } : {}),
      ...(o.no('mbSize') !== undefined ? { mbSize: o.no('mbSize')! } : {}),
      ...(o.so('meMethod') !== undefined ? { meMethod: o.so('meMethod')! } : {}),
    })])],

  ['vmaf', optOp('buildVmafFilter — the libvmaf quality filter string',
    ['target', 'minScore', 'model'], [],
    o => [m.buildVmafFilter({
      ...(o.no('target') !== undefined ? { target: o.no('target')! } : {}),
      ...(o.no('minScore') !== undefined ? { minScore: o.no('minScore')! } : {}),
      ...(o.so('model') !== undefined ? { model: o.so('model')! } : {}),
    })])],

  ['ssim', optOp('buildSsimFilter — the ssim quality filter string', ['statsFile'], [],
    o => [m.buildSsimFilter(o.so('statsFile') !== undefined ? { statsFile: o.so('statsFile')! } : {})])],

  ['psnr', optOp('buildPsnrFilter — the psnr quality filter string', ['statsFile'], [],
    o => [m.buildPsnrFilter(o.so('statsFile') !== undefined ? { statsFile: o.so('statsFile')! } : {})])],

  ['hw-upload', optOp('buildHwUploadFilter — the hwupload filter string', ['accel'], ['accel'],
    o => [m.buildHwUploadFilter({
      accel: o.s('accel') as never,
    })])],

  ['hw-download', optOp('buildHwDownloadFilter — the hwdownload filter string', ['destFormat'], [],
    o => [m.buildHwDownloadFilter((o.so('destFormat') ?? 'nv12') as never)])],

  ['hw-scale', optOp('buildHwScaleFilter — the per-accelerator GPU scaler',
    ['accel', 'width', 'height', 'format', 'mode'], ['accel', 'width', 'height'],
    o => [m.buildHwScaleFilter({
      accel: o.s('accel') as never,
      width: o.n('width'),
      height: o.n('height'),
      ...(o.so('format') !== undefined ? { format: o.so('format')! } : {}),
      ...(o.so('mode') !== undefined ? { mode: o.so('mode') as never } : {}),
    })])],

  ['hw-chain', optOp('buildHwFilterChain — upload → GPU work → download',
    ['accel', 'gpuFilters', 'cpuFilters', 'downloadFormat'], ['accel', 'gpuFilters'],
    o => [m.buildHwFilterChain({
      accel: o.s('accel') as never,
      gpuFilters: o.json<string[]>('gpuFilters', []),
      ...(o.csv('cpuFilters').length > 0 ? { cpuFilters: o.csv('cpuFilters') } : {}),
      ...(o.so('downloadFormat') !== undefined ? { downloadFormat: o.so('downloadFormat') as never } : {}),
    })])],

  ['watermark', argOp('buildWatermarkFilter — overlay a watermark image',
    ['position', 'margin', 'opacity', 'scaleWidth'], ['position', 'margin', 'opacity'],
    o => [m.buildWatermarkFilter(o.s('position') as never, o.n('margin'), o.n('opacity'), o.no('scaleWidth'))])],

  ['text-watermark', argOp('buildTextWatermarkFilter — a drawtext overlay',
    ['text', 'position', 'margin', 'fontSize', 'fontColor', 'fontFile'],
    ['text', 'position', 'margin', 'fontSize', 'fontColor'],
    o => [m.buildTextWatermarkFilter(
      o.s('text'), o.s('position') as never, o.n('margin'), o.n('fontSize'), o.s('fontColor'), o.so('fontFile'),
    )])],

  ['burn-subtitles', argOp('buildBurnSubtitlesFilter — the subtitles filter with force_style',
    ['subtitleFile', 'fontSize', 'fontName', 'primaryColor'], ['subtitleFile'],
    o => [m.buildBurnSubtitlesFilter(o.s('subtitleFile'), o.no('fontSize'), o.so('fontName'), o.so('primaryColor'))])],

  ['burn-timecode', argOp('buildBurnTimecodeFilter — a drawtext timecode counter',
    ['timeFormat', 'fontsize', 'fontcolor', 'fontfile', 'x', 'y'], [],
    o => [m.buildBurnTimecodeFilter(
      o.so('timeFormat') ?? '%{pts_hms}',
      o.no('fontsize') ?? 48,
      o.so('fontcolor') ?? 'white',
      o.so('fontfile'),
      o.so('x') ?? '10',
      o.so('y') ?? 'h-th-10',
    )])],

  ['waveform', argOp('buildWaveformFilter — the showwavespic filter string',
    ['width', 'height', 'color', 'scale', 'streamIndex'], ['width', 'height', 'color', 'scale'],
    o => [m.buildWaveformFilter(o.n('width'), o.n('height'), o.s('color'), o.s('scale'), o.no('streamIndex') ?? 0)])],

  ['spectrum', argOp('buildSpectrumFilter — the showspectrumpic filter string',
    ['width', 'height', 'color', 'fps'], ['width', 'height', 'color', 'fps'],
    o => [m.buildSpectrumFilter(o.n('width'), o.n('height'), o.s('color') as never, o.n('fps'))])],

  ['scene-select', argOp('buildSceneSelectFilter — the scene-score select expression',
    ['threshold'], [],
    o => [m.buildSceneSelectFilter(o.no('threshold') ?? 0.4)])],

  ['loudnorm-parse', argOp('parseLoudnorm — parse EBU R128 measurements from a file or loudnorm output',
    ['input', 'mode'], ['input'],
    async o => [JSON.stringify(await m.parseLoudnorm({
      input: o.s('input'),
      ...(o.so('mode') !== undefined ? { mode: o.so('mode') as 'file' | 'output' } : {}),
    }), null, 2)])],

  ['vmaf-parse', argOp('parseVmafLog — parse a libvmaf JSON log into a score',
    ['json'], ['json'],
    o => [JSON.stringify(m.parseVmafLog(o.s('json')), null, 2)])],

  ['stats-parse', argOp('parseStatsFile — parse an ssim/psnr stats file into a score',
    ['contents', 'metric'], ['contents', 'metric'],
    o => [JSON.stringify(m.parseStatsFile(o.s('contents'), o.s('metric') as 'ssim' | 'psnr'), null, 2)])],
]);

// ─── Commands ────────────────────────────────────────────────────────────────

const EXTRA_TASKS: Record<string, CliTask> = {
  filter: {
    name: 'filter',
    summary: 'Apply any built-in filter by name (--list for all)',
    usage:
      'mediaforge filter <name> [key=value ...] <input> <output> [--list] [--print] [--chain name:key=value|…] [--audio] [--codec libx264] [--acodec aac]',
    flags: {
      list: 'print every filter name with its option keys',
      print: 'print the serialised filter instead of encoding',
      chain: '=apply several filters: name:key=value|name2',
      audio: '=use -af instead of -vf',
      codec: '=video codec (default libx264)',
      acodec: '=audio codec (default aac)',
    },
    positionals: ['name', 'key=value…', 'input', 'output'],
    async run(pos, f) {
      if (bool(f, 'list') === true) {
        for (const name of filterNames()) {
          const e = FILTER_REGISTRY[name]!;
          const req = e.required?.length ? ` (required: ${e.required.join(', ')})` : '';
          console.log(`  ${name.padEnd(18)} ${e.stream.padEnd(5)} ${e.kind.padEnd(5)} ${e.keys.join(', ')}${req}`);
        }
        console.log(`\n${filterNames().length} filters`);
        return;
      }
      const chainSpec = str(f, 'chain');
      if (chainSpec !== undefined) {
        const built = applyChain(chainSpec, bool(f, 'audio') === true);
        if (bool(f, 'print') === true) { console.log(built.chain); return; }
        const [input, output] = need(pos, 'filter', 2);
        await runWithFilter(built.chain, built.audio, input!, output!, f);
        return;
      }
      const name = pos[0];
      if (name === undefined) {
        throw new Error(`filter needs a filter name. Usage: ${EXTRA_TASKS['filter']!.usage}`);
      }
      const entry = FILTER_REGISTRY[name];
      if (entry === undefined) {
        throw new Error(
          `unknown filter "${name}". Run \`mediaforge filter --list\` for the ${filterNames().length} available filters.`,
        );
      }
      // `name` is positional[0]; the rest is key=value tokens plus the paths.
      const opts: string[] = [];
      const paths: string[] = [];
      for (const tok of pos.slice(1)) {
        if (tok.includes('=')) opts.push(tok);
        else paths.push(tok);
      }
      if (paths.length < 2 && bool(f, 'print') !== true) {
        throw new Error(`filter needs <input> <output> after the options. Usage: ${EXTRA_TASKS['filter']!.usage}`);
      }
      const rec = parseOptions(opts);
      for (const req of entry.required ?? []) {
        if (rec[req] === undefined) {
          throw new Error(
            `filter "${name}" requires ${req}=<value>. Accepted: ${entry.keys.join(', ') || '(none)'}`,
          );
        }
      }
      for (const k of Object.keys(rec)) {
        if (!entry.keys.includes(k)) {
          throw new Error(`filter "${name}" has no option "${k}". Accepted: ${entry.keys.join(', ') || '(none)'}`);
        }
      }
      const chain = entry.apply(new FilterChain(), rec).toString();
      const audio = bool(f, 'audio') === true || entry.stream === 'audio';
      if (bool(f, 'print') === true) { console.log(chain); return; }
      await runWithFilter(chain, audio, paths[0]!, paths[1]!, f);
    },
  },

  graph: {
    name: 'graph',
    summary: 'Build a complex filter graph and print or run -filter_complex',
    usage:
      'mediaforge graph <input> <output> --pipeline \'[{"from":"0:v","filter":"scale","args":["1280","720"],"out":"scaled"}]\' [--print] [--map 0:v] [--codec libx264] [--acodec aac]',
    flags: {
      pipeline: '=JSON array of {from,filter,args?,named?,out?} steps',
      print: 'print the -filter_complex string instead of encoding',
      map: '=comma-separated output maps',
      codec: '=video codec (default libx264)',
      acodec: '=audio codec (default aac)',
    },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = need(pos, 'graph', 2);
      const raw = requireFlag(f, 'pipeline', 'graph');
      let steps: Array<{ from?: unknown; filter?: unknown; args?: unknown[]; named?: Rec; out?: string }>;
      try {
        steps = JSON.parse(raw) as typeof steps;
      } catch (err) {
        throw new Error(`--pipeline must be a JSON array of steps: ${(err as Error).message}`);
      }
      if (!Array.isArray(steps) || steps.length === 0) {
        throw new Error('--pipeline must be a non-empty JSON array of steps');
      }
      const g = m.filterGraph();
      // The last step's output label has to be mapped explicitly: a filtergraph
      // whose final output is not mapped fails with "unconnected output".
      let lastLabel: string | undefined;
      steps.forEach((step, i) => {
        if (typeof step?.from !== 'string' || typeof step?.filter !== 'string') {
          throw new Error(`pipeline step ${i} needs "from" and "filter" strings`);
        }
        const node = g.from(step.from).filter(
          step.filter,
          (step.args ?? []).map(String),
          step.named ?? {},
        );
        const isLast = i === steps.length - 1;
        if (isLast) lastLabel = node.mapOut().label;
        else if (step.out !== undefined) node.out(step.out);
        else node.out();
      });
      const filterComplex = g.toString();
      if (bool(f, 'print') === true) { console.log(filterComplex); return; }
      const b = m.ffmpeg(input!)
        .output(output!)
        .complexFilter(filterComplex)
        .videoCodec(str(f, 'codec') ?? 'libx264')
        .audioCodec(str(f, 'acodec') ?? 'aac');
      const maps = list(f, 'map');
      if (lastLabel !== undefined && !maps.includes(`[${lastLabel}]`)) maps.push(`[${lastLabel}]`);
      for (const spec of maps) b.map(spec);
      await b.run();
      console.log(`Wrote ${output}`);
    },
  },

  codec: {
    name: 'codec',
    summary: 'Show the encoder arguments a codec builder produces (--list for all)',
    usage: 'mediaforge codec <name> [<format>] [key=value ...] [--list]',
    flags: { list: 'print every encoder builder with its option keys' },
    positionals: ['name', '<format> (pcm only)', 'key=value…'],
    run(pos, f) {
      if (bool(f, 'list') === true) {
        for (const name of codecBuilderNames()) {
          const entry = CODEC_BUILDERS.get(name)!;
          const head = entry.leading === undefined ? '' : `${entry.leading.label} `;
          console.log(`  ${name.padEnd(22)} ${head}${entry.keys.join(', ') || '(no options)'}`);
        }
        console.log(`\n${CODEC_BUILDERS.size} encoder builders`);
        return;
      }
      const name = pos[0];
      if (name === undefined) {
        throw new Error(`codec needs a codec name. Usage: ${EXTRA_TASKS['codec']!.usage}`);
      }
      const entry = CODEC_BUILDERS.get(name);
      if (entry === undefined) {
        throw new Error(`unknown codec builder "${name}". Run \`mediaforge codec --list\`.`);
      }
      let leading: string | undefined;
      if (entry.leading !== undefined) {
        leading = pos[1];
        if (leading === undefined) {
          throw new Error(
            `codec "${name}" needs a ${entry.leading.label}, e.g. ${entry.leading.values[0]}. ` +
            `Usage: ${EXTRA_TASKS['codec']!.usage}`,
          );
        }
        if (!entry.leading.values.includes(leading)) {
          throw new Error(
            `codec "${name}" has no format "${leading}". Accepted: ${entry.leading.values.join(', ')}`,
          );
        }
      }
      const rec = parseOptions(pos.slice(entry.leading === undefined ? 1 : 2));
      for (const k of Object.keys(rec)) {
        if (!entry.keys.includes(k)) {
          throw new Error(`codec "${name}" has no option "${k}". Accepted: ${entry.keys.join(', ') || '(none)'}`);
        }
      }
      const args = entry.build(rec, leading);
      if (args.length === 0) {
        throw new Error(`codec "${name}" produced no arguments — set at least one option`);
      }
      printArgs(`${name} → ffmpeg args`, args);
    },
  },

  map: {
    name: 'map',
    summary: 'Build -map arguments from the stream-mapping DSL',
    usage:
      'mediaforge map <input> <output> [--all] [--remux] [--default] [--av] [--spec 0:a:1] [--video all|0|1] [--audio all|0] [--subs none|0] [--label vout] [--exclude 0:a:2] [--disposition v:0=default+forced] [--copy-stream v:0=copy] [--codec-stream v:0=libx264] [--metadata title:Clip] [--stream-meta a:0=language=eng] [--print]',
    flags: {
      all: 'map every stream from the input',
      remux: 'copy every stream into a new container (-c copy)',
      spec: '=comma-separated raw stream specifiers (e.g. 0:a:1)',
      default: 'map the first video and first audio stream',
      av: 'map all video and audio, no subtitles or data',
      video: '=all, none, or a stream index',
      audio: '=all, none, or a stream index',
      subs: '=all, none, or a stream index',
      disposition: '=comma-separated v:0=default+forced entries',
      'copy-stream': '=comma-separated v:0=copy entries (per-stream codec)',
      'codec-stream': '=comma-separated v:0=libx264 entries (per-stream codec)',
      label: '=comma-separated filter_complex output labels',
      exclude: '=comma-separated stream specifiers to exclude',
      metadata: '=comma-separated key:value pairs',
      'stream-meta': '=comma-separated a:0=language=eng entries',
      print: 'print the args instead of remuxing',
    },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = need(pos, 'map', 2);
      const args: string[] = [];
      const pick = (
        spec: string | undefined,
        all: () => string[],
        one: (i: number) => string[],
      ): void => {
        if (spec === undefined || spec === 'none') return;
        if (spec === 'all') { args.push(...all()); return; }
        const i = Number(spec);
        if (!Number.isInteger(i) || i < 0) {
          throw new Error(`expected "all", "none" or an index, got "${spec}"`);
        }
        args.push(...one(i));
      };
      if (bool(f, 'remux') === true) args.push(...m.remuxAll());
      if (bool(f, 'all') === true) args.push(...m.mapAll(0));
      for (const spec of list(f, 'spec')) args.push(...m.mapStream(spec));
      if (bool(f, 'default') === true) args.push(...m.mapDefaultStreams(0));
      if (bool(f, 'av') === true) args.push(...m.mapAVS(0));
      pick(str(f, 'video'), () => m.mapAllVideo(0), i => [...m.mapVideo(0, i)]);
      pick(str(f, 'audio'), () => m.mapAllAudio(0), i => [...m.mapAudio(0, i)]);
      pick(str(f, 'subs'), () => m.mapAllSubtitles(0), i => [...m.mapSubtitle(0, i)]);
      for (const label of list(f, 'label')) args.push(...m.mapLabel(label));
      for (const spec of list(f, 'exclude')) args.push(...m.negateMap(spec));
      for (const d of list(f, 'disposition')) {
        const eq = d.indexOf('=');
        if (eq === -1) throw new Error(`--disposition entry "${d}" must be v:0=default+forced`);
        const [type, idx] = d.slice(0, eq).split(':');
        if (type === undefined || idx === undefined) {
          throw new Error(`--disposition entry "${d}" must be v:0=default+forced`);
        }
        args.push(...m.setDisposition(0, type as never, Number(idx), d.slice(eq + 1).split('+')));
      }
      // A per-stream codec entry is `v:0=copy` (copyStream) or `v:0=libx264`
      // (streamCodec); the two builders differ only in the codec they emit.
      for (const entry of [...list(f, 'copy-stream'), ...list(f, 'codec-stream')]) {
        const eq = entry.indexOf('=');
        if (eq === -1) throw new Error(`--copy-stream entry "${entry}" must be v:0=copy`);
        const [type, idx] = entry.slice(0, eq).split(':');
        if (type === undefined || idx === undefined) {
          throw new Error(`--copy-stream entry "${entry}" must be v:0=copy`);
        }
        args.push(...(entry === 'copy'
          ? m.copyStream(type as never, Number(idx))
          : m.streamCodec(type as never, Number(idx), entry.slice(eq + 1))));
      }
      for (const pair of list(f, 'metadata')) {
        const colon = pair.indexOf(':');
        if (colon === -1) throw new Error(`--metadata entry "${pair}" must be key:value`);
        args.push(...m.setMetadata(pair.slice(0, colon), pair.slice(colon + 1)));
      }
      for (const entry of list(f, 'stream-meta')) {
        const firstColon = entry.indexOf(':');
        const eq = entry.indexOf('=');
        if (firstColon === -1 || eq === -1 || eq < firstColon) {
          throw new Error(`--stream-meta entry "${entry}" must be a:0=language=eng`);
        }
        const [type, idx] = entry.slice(0, firstColon).split(':');
        const rest = entry.slice(eq + 1);
        const keyEq = rest.indexOf('=');
        args.push(...m.setStreamMetadata(
          0, type as never, Number(idx), rest.slice(0, keyEq), rest.slice(keyEq + 1),
        ));
      }
      if (args.length === 0) {
        throw new Error('map needs at least one of --all/--default/--av/--video/--audio/--subs/--label');
      }
      if (bool(f, 'print') === true) {
        printArgs('map → ffmpeg args', ['-y', '-i', input!, ...args, '-c', 'copy', output!]);
        return;
      }
      const b = m.ffmpeg(input!).output(output!);
      for (let i = 0; i < args.length; i += 2) b.addOutputOption(args[i]!, args[i + 1]!);
      await b.run();
      console.log(`Wrote ${output}`);
    },
  },

  preset: {
    name: 'preset',
    summary: 'List, inspect or apply a named encode preset',
    usage: 'mediaforge preset [name] <input> <output> [--list] [--print] [--size WxH] [--crf n]',
    flags: {
      list: 'list every preset name',
      print: 'print the preset args instead of encoding',
      size: '=override the output size',
      crf: '=override the quality value',
    },
    positionals: ['name', 'input', 'output'],
    async run(pos, f) {
      if (bool(f, 'list') === true) {
        for (const name of m.listPresets()) {
          const p = m.getPreset(name);
          console.log(`  ${name.padEnd(12)} v:${p.videoArgs.join(' ') || '(copy)'} | a:${p.audioArgs.join(' ') || '(none)'}`);
        }
        return;
      }
      const [name, input, output] = need(pos, 'preset', 3);
      if (!(m.listPresets() as string[]).includes(name!)) {
        throw new Error(`unknown preset "${name}". Available: ${m.listPresets().join(', ')}`);
      }
      const args = m.applyPreset(name as never);
      if (str(f, 'size') !== undefined) args.push('-s', str(f, 'size')!);
      if (str(f, 'crf') !== undefined) args.push('-crf', str(f, 'crf')!);
      if (bool(f, 'print') === true) {
        printArgs(`preset ${name} → ffmpeg args`, ['-y', '-i', input!, ...args, output!]);
        return;
      }
      await m.runFFmpeg({ binary: m.resolveBinary(), args: ['-y', '-i', input!, ...args, output!] });
      console.log(`Wrote ${output}`);
    },
  },

  analyze: {
    name: 'analyze',
    summary: 'Print a structured media report (streams, chapters, HDR, interlacing)',
    usage: 'mediaforge analyze <file> [--json]',
    flags: { json: 'emit compact JSON instead of an indented report' },
    positionals: ['file'],
    run(pos, f) {
      const [file] = need(pos, 'analyze', 1);
      const info = m.probe(file!);
      const defaultVideo = m.getDefaultVideoStream(info);
      const defaultAudio = m.getDefaultAudioStream(info);
      const report = {
        file: file!,
        format: info.format?.format_name ?? 'unknown',
        durationSec: m.getMediaDuration(info),
        sizeBytes: info.format?.size !== undefined ? Number(info.format.size) : null,
        bitrate: info.format?.bit_rate ?? null,
        hdr: m.isHdr(info),
        interlaced: m.isInterlaced(info),
        video: m.getVideoStreams(info).map(s => ({
          ...m.summarizeVideoStream(s),
          language: m.getStreamLanguage(s),
          ...(s.index === defaultVideo?.index ? { default: true } : {}),
        })),
        audio: m.getAudioStreams(info).map(s => ({
          ...m.summarizeAudioStream(s),
          language: m.getStreamLanguage(s),
          ...(s.index === defaultAudio?.index ? { default: true } : {}),
        })),
        subtitles: m.getSubtitleStreams(info).map(s => ({
          index: s.index,
          codec: s.codec_name ?? 'unknown',
          language: m.getStreamLanguage(s),
        })),
        chapters: m.getChapterList(info).map(c => ({
          title: c.title, startSec: c.startSec, endSec: c.endSec,
        })),
      };
      console.log(JSON.stringify(report, null, bool(f, 'json') === true ? 0 : 2));
    },
  },

  features: {
    name: 'features',
    summary: 'List ffmpeg feature gates for the installed binary',
    usage: 'mediaforge features [--ffmpeg-version <major.minor>] [--missing]',
    flags: {
      'ffmpeg-version': 'evaluate the gates for this version instead of the installed binary',
      missing: 'only print the gates that are unavailable',
    },
    positionals: [],
    run(_pos, f) {
      let major: number;
      let minor = 0;
      const requested = str(f, 'ffmpeg-version');
      if (requested !== undefined) {
        const parsed = /^(\d+)(?:\.(\d+))?/.exec(requested);
        if (parsed === null) {
          throw new Error(`--ffmpeg-version must look like "7.0" or "6.1", got "${requested}"`);
        }
        major = Number(parsed[1]);
        minor = parsed[2] === undefined ? 0 : Number(parsed[2]);
      } else {
        const v = m.probeVersion(m.resolveBinary());
        major = v.major;
        minor = v.minor;
      }
      const onlyMissing = bool(f, 'missing') === true;
      const expected = new Set(m.availableFeatures(major, minor));
      const missing = new Set(m.unavailableFeatures(major, minor));
      let shown = 0;
      for (const [key, gate] of Object.entries(m.FEATURE_GATES)) {
        const ok = m.isFeatureExpected(key, major, minor) || expected.has(key);
        if (onlyMissing && ok) continue;
        shown++;
        console.log(`  ${ok ? 'yes' : 'no '} ${key.padEnd(16)} needs ffmpeg ${gate.minMajor}.${gate.minMinor ?? 0} — ${gate.description}`);
      }
      console.log(`\nffmpeg ${major}.${minor} — ${expected.size} expected, ${missing.size} unavailable`);
    },
  },

  hwaccel: {
    name: 'hwaccel',
    summary: 'Hardware-accelerated transcode via upload/scale/download filter chains',
    usage: 'mediaforge hwaccel <name> <input> <output> [--list] [--check] [--print] [--format nv12] [--width 1280] [--height 720] [--device /dev/dri/renderD128] [--codec h264_cuda]',
    flags: {
      list: 'print every known accelerator',
      check: 'only report whether the accelerator is available',
      format: '=download pixel format (default nv12)',
      width: '=hardware scale width',
      height: '=hardware scale height',
      device: '=device path (e.g. /dev/dri/renderD128)',
      codec: '=video codec (default h264_<name>)',
      print: 'print the filter chain instead of encoding',
    },
    positionals: ['name', 'input', 'output'],
    async run(pos, f) {
      if (bool(f, 'list') === true) {
        for (const h of m.HWACCELS) console.log(`  ${h}`);
        return;
      }
      const [name] = need(pos, 'hwaccel', 1);
      if (!(m.HWACCELS as readonly string[]).includes(name!)) {
        throw new Error(`unknown accelerator "${name}". Available: ${m.HWACCELS.join(', ')}`);
      }
      if (bool(f, 'check') === true) {
        const r = m.guardHwaccel(new m.CapabilityRegistry(m.resolveBinary()), name!);
        console.log(`${name}: ${r.available ? 'available' : 'unavailable'}${r.reason !== undefined ? ` (${r.reason})` : ''}`);
        if (!r.available) process.exitCode = 1;
        return;
      }
      // `--print` describes the chain rather than running it, so it must not
      // demand an input and an output the way the encode path does.
      const printing = bool(f, 'print') === true;
      const [input, output] = printing ? [undefined, undefined] : need(pos, 'hwaccel', 3);
      const w = num(f, 'width');
      const h = num(f, 'height');
      if ((w === undefined) !== (h === undefined)) {
        throw new Error('hwaccel needs both --width and --height, or neither');
      }
      const chain = m.buildHwFilterChain({
        accel: name as never,
        gpuFilters: [m.buildHwScaleFilter({ accel: name as never, width: w ?? -1, height: h ?? -1 })],
        ...(str(f, 'format') !== undefined ? { downloadFormat: str(f, 'format') as never } : {}),
      });
      if (printing) { console.log(chain); return; }
      await m.transcodeWithHwFilters({
        input: input!,
        output: output!,
        accel: name as never,
        gpuFilters: [m.buildHwScaleFilter({ accel: name as never, width: w ?? -1, height: h ?? -1 })],
        videoCodec: str(f, 'codec') ?? `h264_${name}`,
        ...(str(f, 'device') !== undefined ? { device: str(f, 'device')! } : {}),
      });
      console.log(`Wrote ${output}`);
    },
  },

  args: {
    name: 'args',
    summary: 'Print the exact ffmpeg argv a builder produces (--list for all ops)',
    usage: 'mediaforge args <op> key=value ... [--list]',
    flags: { list: 'print every supported op' },
    positionals: ['op', 'key=value…'],
    async run(pos, f) {
      if (bool(f, 'list') === true) {
        for (const name of argOpNames()) {
          const o = ARG_OPS.get(name)!;
          console.log(`  ${name.padEnd(20)} ${o.description}`);
          console.log(`  ${' '.repeat(20)} keys: ${o.keys.join(', ') || '(none)'}`);
        }
        console.log(`\n${ARG_OPS.size} arg builders`);
        return;
      }
      const op = pos[0];
      if (op === undefined) {
        throw new Error(`args needs an op name. Usage: ${EXTRA_TASKS['args']!.usage}`);
      }
      const entry = ARG_OPS.get(op);
      if (entry === undefined) {
        throw new Error(`unknown arg builder "${op}". Run \`mediaforge args --list\`.`);
      }
      const rec = parseOptions(pos.slice(1));
      for (const k of Object.keys(rec)) {
        if (!entry.keys.includes(k)) {
          throw new Error(`args ${op} has no option "${k}". Accepted: ${entry.keys.join(', ') || '(none)'}`);
        }
      }
      const missing = entry.required.filter(k => rec[k] === undefined);
      if (missing.length > 0) {
        throw new Error(
          `args ${op} requires ${missing.map(k => `${k}=<value>`).join(', ')}. Accepted: ${entry.keys.join(', ')}`,
        );
      }
      for (const value of await entry.run(makeOpts(rec))) {
        printArgs(op, Array.isArray(value) ? value : [value]);
      }
    },
  },

  // ─── Media operations ────────────────────────────────────────────────────
  stack: {
    name: 'stack',
    summary: 'Stack several videos side by side (hstack) or on top of each other (vstack)',
    usage: 'mediaforge stack <output> <input...> [--direction hstack] [--shortest]',
    flags: { direction: '=hstack (side by side) or vstack (stacked)', shortest: 'end when the shortest input ends' },
    positionals: ['output', 'input…'],
    async run(pos, f) {
      const [output, ...inputs] = need(pos, 'stack', 2);
      const direction = str(f, 'direction') ?? 'hstack';
      if (direction !== 'hstack' && direction !== 'vstack') {
        throw new Error(`--direction must be hstack or vstack, got "${direction}"`);
      }
      await m.stackVideos({
        inputs: inputs as string[],
        output: output!,
        direction,
        ...(bool(f, 'shortest') === true ? { shortest: true } : {}),
      });
      console.log(`Wrote ${output}`);
    },
  },

  mix: {
    name: 'mix',
    summary: 'Mix several audio tracks into one',
    usage: 'mediaforge mix <output> <input...> [--weights 1,0.5] [--duration longest] [--bitrate 192k] [--codec aac]',
    flags: {
      weights: '=comma-separated per-input weights',
      duration: '=longest|shortest|first',
      bitrate: '=audio bitrate',
      codec: '=audio codec (default aac)',
    },
    positionals: ['output', 'input…'],
    async run(pos, f) {
      const [output, ...inputs] = need(pos, 'mix', 2);
      const weights = list(f, 'weights').map(Number);
      if (weights.some(w => !Number.isFinite(w))) throw new Error('--weights must be numbers');
      if (weights.length > 0 && weights.length !== inputs.length) {
        throw new Error(`--weights has ${weights.length} entries but ${inputs.length} inputs were given`);
      }
      await m.mixAudio({
        inputs: inputs as string[],
        output: output!,
        ...(weights.length > 0 ? { weights } : {}),
        ...(str(f, 'duration') !== undefined ? { duration: str(f, 'duration') as never } : {}),
        ...(str(f, 'codec') !== undefined ? { audioCodec: str(f, 'codec')! } : {}),
        ...(str(f, 'bitrate') !== undefined ? { bitrate: str(f, 'bitrate')! } : {}),
      });
      console.log(`Wrote ${output}`);
    },
  },

  loop: {
    name: 'loop',
    summary: 'Loop a video N times',
    usage: 'mediaforge loop <input> <output> [--times 2] [--duration 30] [--codec libx264]',
    flags: {
      times: '=number of extra loops (default 1)',
      duration: '=cap the output duration in seconds',
      codec: '=video codec',
    },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = need(pos, 'loop', 2);
      await m.loopVideo({
        input: input!, output: output!,
        ...(num(f, 'times') !== undefined ? { loops: num(f, 'times')! } : {}),
        ...(str(f, 'duration') !== undefined ? { duration: str(f, 'duration')! } : {}),
        ...(str(f, 'codec') !== undefined ? { videoCodec: str(f, 'codec')! } : {}),
      });
      console.log(`Wrote ${output}`);
    },
  },

  deinterlace: {
    name: 'deinterlace',
    summary: 'Deinterlace with yadif',
    usage: 'mediaforge deinterlace <input> <output> [--mode 0] [--parity -1] [--deint 0]',
    flags: {
      mode: '=0=frame 1=field 2=frame (send-frame) 3=field (send-frame)',
      parity: '=-1=auto 0=TFF 1=BFF',
      deint: '=0=all frames 1=interlaced only',
    },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = need(pos, 'deinterlace', 2);
      await m.deinterlace({
        input: input!, output: output!,
        ...(num(f, 'mode') !== undefined ? { mode: num(f, 'mode') as 0 | 1 | 2 | 3 } : {}),
        ...(num(f, 'parity') !== undefined ? { parity: num(f, 'parity') as -1 | 0 | 1 } : {}),
        ...(num(f, 'deint') !== undefined ? { deint: num(f, 'deint') as 0 | 1 } : {}),
      });
      console.log(`Wrote ${output}`);
    },
  },

  stabilize: {
    name: 'stabilize',
    summary: 'Stabilise shaky footage with vidstab',
    usage: 'mediaforge stabilize <input> <output> [--smoothing 10] [--max-shift -1] [--max-angle -1] [--crop 0]',
    flags: {
      smoothing: '=smoothing strength 1-100',
      'max-shift': 'max correction in pixels (-1 = no limit)',
      'max-angle': 'max rotation in degrees (-1 = no limit)',
      crop: '=0=keep black borders 1=crop',
    },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = need(pos, 'stabilize', 2);
      await m.stabilizeVideo({
        input: input!, output: output!,
        ...(num(f, 'smoothing') !== undefined ? { smoothing: num(f, 'smoothing')! } : {}),
        ...(num(f, 'max-shift') !== undefined ? { maxShift: num(f, 'max-shift')! } : {}),
        ...(num(f, 'max-angle') !== undefined ? { maxAngle: num(f, 'max-angle')! } : {}),
        ...(num(f, 'crop') !== undefined ? { crop: num(f, 'crop') as 0 | 1 } : {}),
      });
      console.log(`Wrote ${output}`);
    },
  },

  aspect: {
    name: 'aspect',
    summary: 'Crop to a target aspect ratio',
    usage: 'mediaforge aspect <input> <output> --ratio 1:1 [--codec libx264]',
    flags: { ratio: 'target W:H (e.g. 16:9, 1:1, 9:16)', codec: 'video codec' },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = need(pos, 'aspect', 2);
      await m.cropToRatio({
        input: input!, output: output!,
        ratio: requireFlag(f, 'ratio', 'aspect'),
        ...(str(f, 'codec') !== undefined ? { videoCodec: str(f, 'codec')! } : {}),
      });
      console.log(`Wrote ${output}`);
    },
  },

  lut: {
    name: 'lut',
    summary: 'Apply a .cube / .3dl lookup table',
    usage: 'mediaforge lut <input> <output> --lut grade.cube [--interp tetrahedral] [--codec libx264]',
    flags: { lut: 'path to the .cube or .3dl file', interp: 'trilinear|tetrahedral|nearest', codec: 'video codec' },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = need(pos, 'lut', 2);
      await m.applyLUT({
        input: input!, output: output!,
        lut: requireFlag(f, 'lut', 'lut'),
        ...(str(f, 'interp') !== undefined ? { interp: str(f, 'interp') as never } : {}),
        ...(str(f, 'codec') !== undefined ? { videoCodec: str(f, 'codec')! } : {}),
      });
      console.log(`Wrote ${output}`);
    },
  },

  timecode: {
    name: 'timecode',
    summary: 'Burn a timecode counter into the picture',
    usage: 'mediaforge timecode <input> <output> [--position bl] [--fontcolor white] [--fontsize 48] [--font /path/to.ttf] [--format %{pts_hms}]',
    flags: {
      position: '=tl|tr|bl|br|center',
      fontcolor: '=text colour',
      fontsize: '=font size',
      font: '=font file path',
      format: '=timecode format',
    },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = need(pos, 'timecode', 2);
      await m.burnTimecode({
        input: input!, output: output!,
        ...(str(f, 'position') !== undefined ? { position: str(f, 'position') as never } : {}),
        ...(str(f, 'fontcolor') !== undefined ? { fontcolor: str(f, 'fontcolor')! } : {}),
        ...(num(f, 'fontsize') !== undefined ? { fontsize: num(f, 'fontsize')! } : {}),
        ...(str(f, 'font') !== undefined ? { font: str(f, 'font')! } : {}),
        ...(str(f, 'format') !== undefined ? { format: str(f, 'format')! } : {}),
      });
      console.log(`Wrote ${output}`);
    },
  },

  cropdetect: {
    name: 'cropdetect',
    summary: 'Detect the real content region of a video',
    usage: 'mediaforge cropdetect <input> [--limit 100] [--skip 5]',
    flags: { limit: 'max frames to scan (default 100)', skip: 'skip the first N seconds (default 5)' },
    positionals: ['input'],
    async run(pos, f) {
      const [input] = need(pos, 'cropdetect', 1);
      const region = await m.cropDetect({
        input: input!,
        ...(num(f, 'limit') !== undefined ? { limit: num(f, 'limit')! } : {}),
        ...(num(f, 'skip') !== undefined ? { skip: num(f, 'skip')! } : {}),
      });
      if (region === null) {
        console.log('No crop region detected (no black borders found, or the input could not be scanned).');
        return;
      }
      console.log(`w=${region.width} h=${region.height} x=${region.x} y=${region.y}`);
    },
  },

  'gif2mp4': {
    name: 'gif2mp4',
    summary: 'Convert a GIF to an MP4',
    usage: 'mediaforge gif2mp4 <input.gif> <output.mp4> [--width 480]',
    flags: { width: 'output width (default: source width)' },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = need(pos, 'gif2mp4', 2);
      await m.gifToMp4({
        input: input!, output: output!,
        ...(num(f, 'width') !== undefined ? { width: num(f, 'width')! } : {}),
      });
      console.log(`Wrote ${output}`);
    },
  },

  'extract-subs': {
    name: 'extract-subs',
    summary: 'Extract a subtitle stream to a file',
    usage: 'mediaforge extract-subs <input> <output.srt> [--stream 0]',
    flags: { stream: 'subtitle stream index (default 0)' },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = need(pos, 'extract-subs', 2);
      await m.extractSubtitles({
        input: input!, output: output!,
        ...(num(f, 'stream') !== undefined ? { streamIndex: num(f, 'stream')! } : {}),
      });
      console.log(`Wrote ${output}`);
    },
  },

  // Retiming needs a real ffmpeg run against a real subtitle file, so it is a
  // command of its own rather than one of the `args` builders, which only print.
  'retime-subs': {
    name: 'retime-subs',
    summary: 'Retime a subtitle file to the video it belongs to',
    usage: 'mediaforge retime-subs <input> <output.srt> [--format srt] [--stream 0]',
    flags: {
      format: 'subtitle format written and read back (default srt)',
      stream: 'subtitle stream index in the video (default 0)',
    },
    positionals: ['input', 'output'],
    async run(pos, f) {
      const [input, output] = need(pos, 'retime-subs', 2);
      await m.fixSubtitleDuration({
        input: input!,
        output: output!,
        ...(str(f, 'format') !== undefined ? { format: str(f, 'format') as never } : {}),
        ...(num(f, 'stream') !== undefined ? { streamIndex: num(f, 'stream')! } : {}),
      });
      console.log(`Retimed ${output} to match ${input}`);
    },
  },
};

// ─── Public surface for tests and docs ───────────────────────────────────────

/**
 * Library exports deliberately left without a dedicated CLI command.
 *
 * These are process-lifecycle or internal plumbing helpers: they either have no
 * user-facing operation to trigger, or a task command already consumes them
 * rather than being the operation itself. Keeping the list here means a missing
 * CLI command is always a decision, never an oversight.
 */
export const LIBRARY_ONLY: Record<string, string> = {
  autoKillOnExit: 'registers on an already-spawned child; a CLI job owns its own lifetime',
  killAllFFmpeg: "kills this process's children; a single CLI invocation has none to clean up",
  renice: "adjusts the priority of this process's own children",
  captureStderr: 'wraps spawnFFmpeg, which every task command already uses',
  isDeno: 'runtime detection, not a user operation',
  spawnFFmpeg: 'every task command already runs through it',
  runFFmpeg: 'same, plus the raw flag passthrough path',
  ffmpeg: 'the builder; reachable via the task commands and the raw passthrough',
  FFmpegEmitter: 'event plumbing for spawnFFmpeg',
  ProgressParser: 'consumed by spawnFFmpeg/parseProgress',
  parseAllProgress: 'consumed by spawnFFmpeg/parseProgress',
  formatDuration: 'cosmetic formatting used by the progress logging',
  formatVersion: 'cosmetic formatting used by `mediaforge version`',
  flattenArgs: 'internal to the builder',
  escapeFilterValue: 'internal to the filter serializers',
  serializeNode: 'internal to the filter serializers',
  serializeLink: 'internal to the filter graph',
  pad: 'internal label helper',
  resetLabelCounter: 'internal to the filter graph',
  FilterChain: 'reached through `mediaforge filter` and `--chain`',
  FilterGraph: 'reached through `mediaforge graph`',
  GraphNode: 'reached through `mediaforge graph`',
  GraphStream: 'reached through `mediaforge graph`',
  VideoFilterChain: 'reached through `mediaforge filter`',
  AudioFilterChain: 'reached through `mediaforge filter --audio`',
  videoFilterChain: 'reached through `mediaforge filter`',
  audioFilterChain: 'reached through `mediaforge filter --audio`',
  filterGraph: 'reached through `mediaforge graph`',
  streamOutput: 'raw stream piping; `mediaforge args stream-output` prints the args',
  streamToFile: 'raw stream piping; `mediaforge args stream-output` prints the args',
  streamToUrl: 'raw stream piping to a network endpoint, which needs a live server',
  pipeThrough: 'raw stream piping; `mediaforge args pipe` prints the args',
  guardVersion: 'reached through `mediaforge version` and the raw passthrough',
  guardCodec: 'reached through `mediaforge caps` and `mediaforge codec`',
  guardCodecFull: 'reached through `mediaforge codec` + `mediaforge features`',
  guardFilter: 'reached through `mediaforge caps --filters`',
  guardHwaccel: 'reached through `mediaforge hwaccel --check`',
  assertCodec: 'reached through `mediaforge codec`',
  assertHwaccel: 'reached through `mediaforge hwaccel --check`',
  assertFeatureVersion: 'reached through `mediaforge features`',
  guardFeatureVersion: 'reached through `mediaforge features`',
  selectBestCodec: 'reached through `mediaforge codec --list` and the passthrough',
  selectBestHwaccel: 'reached through `mediaforge hwaccel --list`',
  isBinaryAvailable: 'reached through `mediaforge hwaccel --check`',
  isBinaryAvailableAsync: 'reached through `mediaforge hwaccel --check`',
  validateBinary: 'reached through `mediaforge version`',
  mergeToFile: 'reached through `mediaforge concat`',
  copyAudioAndSubs: 'reached through `mediaforge map --audio/--subs`',
  buildConcatList: 'reached through `mediaforge concat`',
  probeAsync: 'reached through `mediaforge analyze`, which uses the sync probe',
  screenshots: 'reached through `mediaforge frames` and `mediaforge thumbnail`',
  videoPad: 'the `pad` filter under its lib/index.ts alias; the registry key is `pad`',
  CapabilityRegistry: 'used by `mediaforge caps`, `mediaforge hwaccel --check` and the builder',
  getDefaultRegistry: 'used by the builder and `mediaforge caps`',
  findStreamByLanguage: 'reached through `mediaforge map --stream-meta`',
  BinaryNotFoundError: 'error class, raised by the commands that can fail to find a binary',
  BinaryNotExecutableError: 'error class, raised by the commands that can find a non-executable binary',
  VersionError: 'error class, raised by `mediaforge version` and the feature gates',
  ProbeError: 'error class, raised by `mediaforge analyze` and `mediaforge probe`',
  FFmpegSpawnError: 'error class, raised by every command that spawns ffmpeg',
  GuardError: 'error class, raised by the capability guards behind `caps` and `hwaccel --check`',
  adaptiveHls: 'reached through `mediaforge abr`, which produces the same multi-variant HLS output',
  serializeSpecifier: 'reached through `mediaforge map --spec/--exclude`, which use it internally',
  buildGifPalettegenFilter: 'reached through `mediaforge args gif-palette`',
  buildGifPaletteuseFilter: 'reached through `mediaforge args gif-palette`',
};

/**
 * Helpers that exist in `lib/` but are deliberately not part of the public
 * surface, so no CLI command could reach them even in principle.
 */
export const INTERNAL_NOTES: Record<string, string> = {
  trackChild: 'internal child bookkeeping',
  getSpawnedCount: 'internal child bookkeeping, asserted by the leak regression test',
  writeConcatListFile: 'internal to concatFiles',
  awaitProcess: 'internal to the concat helpers',
  buildHlsFilters: 'internal to hlsPackage',
  buildDashFilters: 'internal to dashPackage',
};

/** Names of the arg-builder ops, for the tests and the README table. */
export function argOpNames(): string[] {
  return [...ARG_OPS.keys()].sort();
}

/** Names of the codec builders, for the tests and the README table. */
export function codecBuilderNames(): string[] {
  return [...CODEC_BUILDERS.keys()].sort();
}

export { EXTRA_TASKS };
