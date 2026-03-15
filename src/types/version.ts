/**
 * Parsed FFmpeg version information.
 */
export interface VersionInfo {
  /** Full raw version string, e.g. "7.1.1" or "N-116912-g..." */
  raw: string;
  /** Major version number (6, 7, 8, …) */
  major: number;
  /** Minor version number */
  minor: number;
  /** Patch version number */
  patch: number;
  /** True if this is a git/nightly build (non-release) */
  isGit: boolean;
  /** Configuration flags reported by ffmpeg -version */
  configuration: string[];
  /** Library versions map, e.g. { libavcodec: "61.19.100" } */
  libraries: Record<string, string>;
}

/**
 * A version range used for feature gating.
 */
export interface VersionRequirement {
  /** Minimum major version required */
  minMajor: number;
  /** Minimum minor version required (within the major) */
  minMinor?: number;
  /** Human-readable feature name for error messages */
  feature: string;
}
