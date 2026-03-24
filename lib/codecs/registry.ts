import { spawnSync } from 'node:child_process';
import type { CodecInfo, FilterInfo, FormatInfo } from '../types/codecs.ts';

/**
 * Runtime capability registry.
 * Probes the installed ffmpeg binary once and caches the results.
 * Zero hardcoding — the binary self-describes what it supports.
 */
export class CapabilityRegistry {
  private readonly binary: string;
  private _codecs: Map<string, CodecInfo> | null = null;
  private _filters: Map<string, FilterInfo> | null = null;
  private _formats: Map<string, FormatInfo> | null = null;
  private _hwaccels: Set<string> | null = null;

  constructor(binary: string) {
    this.binary = binary;
  }

  // ─── Codecs ───────────────────────────────────────────────────────────────

  get codecs(): Map<string, CodecInfo> {
    if (this._codecs === null) {
      this._codecs = this._probeCodecs();
    }
    return this._codecs;
  }

  hasCodec(name: string): boolean {
    return this.codecs.has(name);
  }

  canEncode(codec: string): boolean {
    return this.codecs.get(codec)?.flags.encode ?? false;
  }

  canDecode(codec: string): boolean {
    return this.codecs.get(codec)?.flags.decode ?? false;
  }

  // ─── Filters ──────────────────────────────────────────────────────────────

  get filters(): Map<string, FilterInfo> {
    if (this._filters === null) {
      this._filters = this._probeFilters();
    }
    return this._filters;
  }

  hasFilter(name: string): boolean {
    return this.filters.has(name);
  }

  // ─── Formats ──────────────────────────────────────────────────────────────

  get formats(): Map<string, FormatInfo> {
    if (this._formats === null) {
      this._formats = this._probeFormats();
    }
    return this._formats;
  }

  hasFormat(name: string): boolean {
    return this.formats.has(name);
  }

  // ─── Hardware Accels ──────────────────────────────────────────────────────

  get hwaccels(): Set<string> {
    if (this._hwaccels === null) {
      this._hwaccels = this._probeHwaccels();
    }
    return this._hwaccels;
  }

  hasHwaccel(name: string): boolean {
    return this.hwaccels.has(name);
  }

  // ─── Private probe methods ────────────────────────────────────────────────

  private _exec(args: string[]): string {
    const result = spawnSync(this.binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    if (result.error) throw result.error;
    // ffmpeg exits non-zero for informational flags like -codecs; use stdout regardless
    return result.stdout ?? '';
  }

  /**
   * Parse `ffmpeg -codecs` output.
   * Each codec line format: " DEV.LS name   description"
   * Flags: D=decode, E=encode, V/A/S/D/T=type, I=intraOnly, L=lossy, S=lossless
   */
  private _probeCodecs(): Map<string, CodecInfo> {
    const map = new Map<string, CodecInfo>();
    let output: string;
    try {
      output = this._exec(['-codecs', '-hide_banner']);
    } catch {
      return map;
    }

    const lines = output.split('\n');
    // Skip header lines until we hit the "-------" separator
    let pastHeader = false;
    for (const line of lines) {
      if (!pastHeader) {
        if (line.trimStart().startsWith('-----')) pastHeader = true;
        continue;
      }

      // Format: " DEV.LS codec_name   description"
      // Flags column is 6 chars wide: positions 1-6
      const match = /^ ([D.])([E.])([VASDT])([I.])([L.])([S.])\s+(\S+)\s+(.*)$/.exec(line);
      if (match === null) continue;

      const [, d, e, t, i, l, s, name, description] = match;
      if (name === undefined || description === undefined) continue;

      const typeChar = t ?? '.';
      const typeMap: Record<string, CodecInfo['flags']['type']> = {
        V: 'video', A: 'audio', S: 'subtitle', D: 'data', T: 'attachment',
      };

      map.set(name, {
        name,
        description: description.trim(),
        flags: {
          decode: d === 'D',
          encode: e === 'E',
          type: typeMap[typeChar] ?? 'data',
          intraOnly: i === 'I',
          lossy: l === 'L',
          lossless: s === 'S',
        },
      });
    }
    return map;
  }

  /**
   * Parse `ffmpeg -filters` output.
   * Filter line format: " T.S name   description"
   */
  private _probeFilters(): Map<string, FilterInfo> {
    const map = new Map<string, FilterInfo>();
    let output: string;
    try {
      output = this._exec(['-filters', '-hide_banner']);
    } catch {
      return map;
    }

    for (const line of output.split('\n')) {
      // v7: "T.S name  desc", v8: "TS name  desc" (2-char flags)
      const match = /^ [T.][S.][C.]?\s+(\S+)\s+(.+)$/.exec(line);
      if (match === null) continue;
      const [, name, description] = match;
      if (name === undefined || description === undefined) continue;
      map.set(name, {
        name,
        description: description.trim(),
        timeline: false,
        sliceBased: false,
      });
    }
    return map;
  }

  /**
   * Parse `ffmpeg -formats` output.
   * Format line format: " DE name   description"
   */
  private _probeFormats(): Map<string, FormatInfo> {
    const map = new Map<string, FormatInfo>();
    let output: string;
    try {
      output = this._exec(['-formats', '-hide_banner']);
    } catch {
      return map;
    }

    let pastHeader = false;
    for (const line of output.split('\n')) {
      if (!pastHeader) {
        if (line.includes('--')) pastHeader = true;
        continue;
      }
      const match = /^ ([D.])([E.])\s+(\S+)\s+(.+)$/.exec(line);
      if (match === null) continue;
      const [, d, e, name, description] = match;
      if (name === undefined || description === undefined) continue;
      // Format name can be comma-separated aliases: "matroska,webm"
      for (const alias of name.split(',')) {
        map.set(alias.trim(), {
          name: alias.trim(),
          description: description.trim(),
          demux: d === 'D',
          mux: e === 'E',
        });
      }
    }
    return map;
  }

  /**
   * Parse `ffmpeg -hwaccels` output.
   */
  private _probeHwaccels(): Set<string> {
    const set = new Set<string>();
    let output: string;
    try {
      output = this._exec(['-hwaccels', '-hide_banner']);
    } catch {
      return set;
    }

    let started = false;
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === 'Hardware acceleration methods:') { started = true; continue; }
      if (started && trimmed.length > 0) set.add(trimmed);
    }
    return set;
  }

  /** Invalidate all cached capability data (e.g. after setBinary) */
  invalidate(): void {
    this._codecs = null;
    this._filters = null;
    this._formats = null;
    this._hwaccels = null;
  }
}

/** Global default registry (lazy, uses FFMPEG_PATH / system ffmpeg) */
let _defaultRegistry: CapabilityRegistry | null = null;

export function getDefaultRegistry(binary = 'ffmpeg'): CapabilityRegistry {
  if (_defaultRegistry === null) {
    _defaultRegistry = new CapabilityRegistry(binary);
  }
  return _defaultRegistry;
}
