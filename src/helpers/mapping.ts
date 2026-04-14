/**
 * Stream mapping DSL.
 * Provides typed helpers for the -map flag and complex multi-stream scenarios.
 * All helpers return string arrays suitable for addOutputOption(...args).
 */

// ─── Stream specifier types ────────────────────────────────────────────────────

/** Media type character used in specifiers */
export type MediaTypeChar = 'v' | 'a' | 's' | 'd' | 't';

/**
 * A typed stream specifier that serializes to the ffmpeg -map string format.
 *
 * @example
 * streamSpec(0, 'v', 0) → '0:v:0'
 * streamSpec(1, 'a')    → '1:a'
 * streamSpec(0)         → '0'
 */
export interface StreamSpecifier {
  /** Input file index (0-based) */
  fileIndex: number;
  /** Stream type */
  type?: MediaTypeChar;
  /** Stream index within the type */
  streamIndex?: number;
  /** Negate the selection */
  negate?: boolean;
}

/**
 * Serialize a StreamSpecifier to its ffmpeg string form.
 */
export function serializeSpecifier(spec: StreamSpecifier): string {
  let str = String(spec.fileIndex);
  if (spec.type !== undefined) {
    str += `:${spec.type}`;
    if (spec.streamIndex !== undefined) {
      str += `:${spec.streamIndex}`;
    }
  }
  if (spec.negate === true) str = `-${str}`;
  return str;
}

/**
 * Shorthand factory for stream specifiers.
 *
 * @example
 * ss(0, 'v', 0) → { fileIndex:0, type:'v', streamIndex:0 }
 */
export function ss(
  fileIndex: number,
  type?: MediaTypeChar,
  streamIndex?: number,
  negate = false,
): StreamSpecifier {
  return {
    fileIndex,
    ...(type !== undefined ? { type } : {}),
    ...(streamIndex !== undefined ? { streamIndex } : {}),
    ...(negate ? { negate } : {}),
  };
}

// ─── Map builders ─────────────────────────────────────────────────────────────

/**
 * Build a -map flag from a StreamSpecifier or raw string.
 * Returns `['-map', specStr]` tuple when called with a StreamSpecifier/string.
 * Returns the specifier string directly when called with (fileIndex, type, streamIndex).
 *
 * @example
 * mapStream(ss(0, 'v', 0))   → ['-map', '0:v:0']
 * mapStream('0:a:1')         → ['-map', '0:a:1']
 * mapStream(0, 'v', 0)       → '0:v:0'   (convenience — string only)
 */
export function mapStream(spec: StreamSpecifier | string): ['-map', string];
export function mapStream(fileIndex: number, type: MediaTypeChar, streamIndex?: number): string;
export function mapStream(
  spec: StreamSpecifier | string | number,
  type?: MediaTypeChar,
  streamIndex?: number,
): ['-map', string] | string {
  if (typeof spec === 'number') {
    // Convenience: called as mapStream(0, 'v', 0) → returns spec string
    const s: StreamSpecifier = { fileIndex: spec, ...(type !== undefined ? { type } : {}), ...(streamIndex !== undefined ? { streamIndex } : {}) };
    return serializeSpecifier(s);
  }
  const str = typeof spec === 'string' ? spec : serializeSpecifier(spec);
  return ['-map', str];
}

/**
 * Map all streams from an input file.
 * @example mapAll(0) → ['-map', '0']
 */
export function mapAll(fileIndex: number): ['-map', string] {
  return ['-map', String(fileIndex)];
}

/**
 * Map all video streams from an input.
 */
export function mapAllVideo(fileIndex: number): ['-map', string] {
  return ['-map', `${fileIndex}:v`];
}

/**
 * Map all audio streams from an input.
 */
export function mapAllAudio(fileIndex: number): ['-map', string] {
  return ['-map', `${fileIndex}:a`];
}

/**
 * Map all subtitle streams from an input.
 */
export function mapAllSubtitles(fileIndex: number): ['-map', string] {
  return ['-map', `${fileIndex}:s`];
}

/**
 * Map a specific video stream by index.
 * @example mapVideo(0, 0) → ['-map', '0:v:0']
 */
export function mapVideo(fileIndex: number, streamIndex = 0): ['-map', string] {
  return ['-map', `${fileIndex}:v:${streamIndex}`];
}

/**
 * Map a specific audio stream by index.
 * @example mapAudio(0, 1) → ['-map', '0:a:1']
 */
export function mapAudio(fileIndex: number, streamIndex = 0): ['-map', string] {
  return ['-map', `${fileIndex}:a:${streamIndex}`];
}

/**
 * Map a specific subtitle stream by index.
 */
export function mapSubtitle(fileIndex: number, streamIndex = 0): ['-map', string] {
  return ['-map', `${fileIndex}:s:${streamIndex}`];
}

/**
 * Map a labeled output stream from filter_complex.
 * @example mapLabel('vout') → ['-map', '[vout]']
 */
export function mapLabel(label: string): ['-map', string] {
  const normalized = label.startsWith('[') ? label : `[${label}]`;
  return ['-map', normalized];
}

/**
 * Negate a stream specifier: exclude this stream from all outputs.
 * @example negateMap(ss(0, 'a', 2)) → ['-map', '-0:a:2']
 */
export function negateMap(spec: StreamSpecifier | string): ['-map', string] {
  if (typeof spec === 'string') {
    const raw = spec.startsWith('-') ? spec : `-${spec}`;
    return ['-map', raw];
  }
  return ['-map', serializeSpecifier({ ...spec, negate: true })];
}

// ─── Metadata / disposition mapping ──────────────────────────────────────────

/**
 * Set stream metadata.
 * @example setStreamMetadata(0, 'a', 0, 'language', 'eng') → ['-metadata:s:a:0', 'language=eng']
 */
export function setStreamMetadata(
  fileIndex: number,
  type: MediaTypeChar,
  streamIndex: number,
  key: string,
  value: string,
): [string, string] {
  return [`-metadata:s:${type}:${streamIndex}`, `${key}=${value}`];
}

/**
 * Set output-level metadata.
 * @example setMetadata('title', 'My Video') → ['-metadata', 'title=My Video']
 */
export function setMetadata(key: string, value: string): ['-metadata', string] {
  return ['-metadata', `${key}=${value}`];
}

/**
 * Set stream disposition flags.
 * @example setDisposition(0, 'a', 0, ['default', 'hearing_impaired']) → ['-disposition:a:0', 'default+hearing_impaired']
 */
export function setDisposition(
  _fileIndex: number,
  type: MediaTypeChar,
  streamIndex: number,
  flags: string[],
): [string, string] {
  return [`-disposition:${type}:${streamIndex}`, flags.join('+')];
}

// ─── Codec-per-stream helpers ─────────────────────────────────────────────────

/**
 * Set codec for a specific stream.
 * @example streamCodec('v', 0, 'libx264') → ['-c:v:0', 'libx264']
 */
export function streamCodec(
  type: MediaTypeChar,
  streamIndex: number,
  codec: string,
): [string, string] {
  return [`-c:${type}:${streamIndex}`, codec];
}

/**
 * Copy a specific stream.
 * @example copyStream('a', 1) → ['-c:a:1', 'copy']
 */
export function copyStream(type: MediaTypeChar, streamIndex: number): [string, string] {
  return streamCodec(type, streamIndex, 'copy');
}

// ─── Common mapping presets ───────────────────────────────────────────────────

/**
 * Map all streams from input 0 and copy everything.
 * Useful for container remux.
 */
export function remuxAll(): string[] {
  return ['-map', '0', '-c', 'copy'];
}

/**
 * Produce a mapping that includes only the first video + audio stream.
 */
export function mapDefaultStreams(fileIndex = 0): string[] {
  return [
    '-map', `${fileIndex}:v:0`,
    '-map', `${fileIndex}:a:0`,
  ];
}

/**
 * Produce a mapping for all streams except data/attachment streams.
 * Common use: re-encode keeping all A/V/subtitle but dropping data streams.
 */
export function mapAVS(fileIndex = 0): string[] {
  return [
    '-map', `${fileIndex}:v`,
    '-map', `${fileIndex}:a`,
    '-map', `${fileIndex}:s?`,
  ];
}

/**
 * Build args to force copy all streams and only re-encode video.
 */
export function copyAudioAndSubs(audioStreamCount = 1, subStreamCount = 0): string[] {
  const args: string[] = [];
  for (let i = 0; i < audioStreamCount; i++) {
    args.push(`-c:a:${i}`, 'copy');
  }
  for (let i = 0; i < subStreamCount; i++) {
    args.push(`-c:s:${i}`, 'copy');
  }
  return args;
}
