import { execBounded, execAsync, type ExecOptions } from './exec.ts';
import type { VersionInfo } from '../types/version.ts';

/** Matches "ffmpeg version 7.1.1 ...", "ffmpeg version 8.1 ..." and "ffmpeg version N-116912-gabcdef ..." */
const RELEASE_RE = /^ffmpeg version (\d+)\.(\d+)(?:\.(\d+))?/;
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
    raw = `${releaseMatch[1]}.${releaseMatch[2]}${releaseMatch[3] !== undefined ? `.${releaseMatch[3]}` : ''}`;
    major = parseInt(releaseMatch[1] ?? '0', 10);
    minor = parseInt(releaseMatch[2] ?? '0', 10);
    patch = parseInt(releaseMatch[3] ?? '0', 10);
  } else {
    const gitMatch = GIT_RE.exec(firstLine);
    if (gitMatch !== null) {
      raw = gitMatch[1] ?? 'unknown';
      isGit = true;
      // Nightly builds carry unreleased features, so report a high sentinel.
      // It is consumed by isFeatureExpected() (via guardFeatureVersion), which
      // compares version.major directly, so every feature gate passes.
      // satisfiesVersion() deliberately ignores these numbers for isGit.
      major = 999;
      minor = 999;
      patch = 999;
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
 *
 * Bounded by a timeout — the previous unbounded `execFileSync` blocked the
 * event loop forever on a wedged binary, taking every other in-flight request
 * down with it. Blocking; prefer {@link probeVersionAsync} in a server.
 *
 * @throws {FFmpegTimeoutError} when the timeout elapses
 * @throws {FFmpegError} when the binary is missing or not executable
 */
export function probeVersion(binaryPath: string, options: ExecOptions = {}): VersionInfo {
  return parseVersionOutput(execBounded(binaryPath, ['-version'], options));
}

/**
 * Non-blocking counterpart to {@link probeVersion}.
 *
 * Results are cached per binary path because the compatibility guards consult
 * the version on nearly every builder call, and re-spawning `ffmpeg -version`
 * each time is pure waste.
 */
const _asyncVersionCache = new Map<string, Promise<VersionInfo>>();

/**
 * Non-blocking version probe, cached per binary path.
 *
 * @throws {FFmpegTimeoutError} when the binary does not answer within the timeout
 * @throws {FFmpegError} when the binary is missing or not executable
 */
export function probeVersionAsync(
  binaryPath: string,
  options: ExecOptions = {},
): Promise<VersionInfo> {
  const key = `${binaryPath}|${options.timeoutMs ?? ''}`;
  const cached = _asyncVersionCache.get(key);
  if (cached !== undefined) return cached;

  const pending = execAsync(binaryPath, ['-version'], options).then(parseVersionOutput);
  _asyncVersionCache.set(key, pending);
  // A failed probe must not poison the cache: the next caller should retry
  // rather than receive the same rejection forever.
  pending.catch(() => {
    _asyncVersionCache.delete(key);
  });
  return pending;
}

/** Drop the async version cache. Intended for tests. */
export function clearVersionCache(): void {
  _asyncVersionCache.clear();
}

/**
 * Return true if actual satisfies the requirement using full semver comparison.
 * Git/nightly builds report an unknown version, so they satisfy only a
 * zero minimum (callers that need a real gate should use guardFeatureVersion
 * against the capability registry instead).
 */
export function satisfiesVersion(
  actual: Pick<VersionInfo, 'major' | 'minor' | 'patch' | 'isGit'>,
  minMajor: number,
  minMinor = 0,
  minPatch = 0,
): boolean {
  const isGit = actual.isGit ?? false;
  if (isGit) {
    // Git/nightly builds: treat as unknown rather than infinitely new
    return minMajor === 0 && minMinor === 0 && minPatch === 0;
  }
  if (actual.major > minMajor) return true;
  if (actual.major < minMajor) return false;
  if (actual.minor > minMinor) return true;
  if (actual.minor < minMinor) return false;
  const patch = actual.patch ?? 0;
  return patch >= minPatch;
}

/**
 * Format a VersionInfo back to a human-readable string.
 */
export function formatVersion(v: VersionInfo): string {
  if (v.isGit) return `git/${v.raw}`;
  return `${v.major}.${v.minor}.${v.patch}`;
}
