import { execFileSync } from 'node:child_process';
import type { VersionInfo } from '../types/version.ts';

/** Matches "ffmpeg version 7.1.1 ..." and "ffmpeg version N-116912-gabcdef ..." */
const RELEASE_RE = /^ffmpeg version (\d+)\.(\d+)\.(\d+)/;
const GIT_RE = /^ffmpeg version (N-\S+)/;

/** Matches "  libavcodec     61.19.100 / 61.19.100" and "  libavformat    61. 7.100 / ..." */
const LIB_RE = /^\s+(lib\w+)\s+(\d+[\s.]+\d+[\s.]+\d+)/;

/** Matches "--enable-..." flags in the configuration line */
const CONFIG_RE = /--\S+/g;

/**
 * Parse the raw text output of `ffmpeg -version`.
 */
export function parseVersionOutput(output: string): VersionInfo {
  const lines = output.split('\n');
  const firstLine = lines[0] ?? '';

  let major = 0;
  let minor = 0;
  let patch = 0;
  let raw = '';
  let isGit = false;

  const releaseMatch = RELEASE_RE.exec(firstLine);
  if (releaseMatch !== null) {
    raw = `${releaseMatch[1]}.${releaseMatch[2]}.${releaseMatch[3]}`;
    major = parseInt(releaseMatch[1] ?? '0', 10);
    minor = parseInt(releaseMatch[2] ?? '0', 10);
    patch = parseInt(releaseMatch[3] ?? '0', 10);
  } else {
    const gitMatch = GIT_RE.exec(firstLine);
    if (gitMatch !== null) {
      raw = gitMatch[1] ?? 'unknown';
      isGit = true;
      // Git builds don't have a clean major/minor — leave at 0
      // Caller should treat git builds as "latest known major"
    } else {
      raw = firstLine;
    }
  }

  // Parse --enable-xxx flags from the "configuration:" line
  const configLine = lines.find((l) => l.startsWith('configuration:')) ?? '';
  const configuration = configLine.match(CONFIG_RE) ?? [];

  // Parse library versions
  const libraries: Record<string, string> = {};
  for (const line of lines) {
    const m = LIB_RE.exec(line);
    if (m !== null) {
      const [, libName, libVer] = m;
      if (libName !== undefined && libVer !== undefined) {
        // Normalize spaces: "61. 19.100" → "61.19.100"
        libraries[libName] = libVer.replace(/\s+/g, '');
      }
    }
  }

  return { raw, major, minor, patch, isGit, configuration, libraries };
}

/**
 * Probe the given binary and return parsed VersionInfo.
 * Throws if the binary cannot be executed.
 */
export function probeVersion(binaryPath: string): VersionInfo {
  const output = execFileSync(binaryPath, ['-version'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  return parseVersionOutput(output);
}

/**
 * Return true if actual satisfies the requirement (major >= min, minor >= minMinor within same major).
 */
export function satisfiesVersion(
  actual: Pick<VersionInfo, 'major' | 'minor'>,
  minMajor: number,
  minMinor = 0,
): boolean {
  if (actual.major > minMajor) return true;
  if (actual.major < minMajor) return false;
  return actual.minor >= minMinor;
}

/**
 * Format a VersionInfo back to a human-readable string.
 */
export function formatVersion(v: VersionInfo): string {
  if (v.isGit) return `git/${v.raw}`;
  return `${v.major}.${v.minor}.${v.patch}`;
}
