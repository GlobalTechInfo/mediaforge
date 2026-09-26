/**
 * Version parsing and bumping for `scripts/release.ts`.
 *
 * Split out from the release script itself so it can be unit-tested: importing
 * release.ts runs `main()`, which checks the working tree, rewrites manifests,
 * commits, tags and pushes.
 *
 * The formats this has to survive are the ones this project has actually used
 * or is likely to use:
 *
 *   2.1.0            plain
 *   2.1.0-alpha      hyphen prerelease, no counter
 *   2.1.0-rc.1       hyphen prerelease with a dot-separated counter
 *   2.0.0.beta       dot prerelease (no hyphen at all)
 *   2.0.1-dev        hyphen prerelease
 *   2.1.1-dev-2      hyphen prerelease whose own label contains a hyphen
 *
 * The first three components must be numeric. Anything after the third
 * separator is the prerelease, verbatim, including any further dots and
 * hyphens — that is what makes `2.1.1-dev-2` and `2.1.0-rc.1` round-trip
 * instead of being mangled into `NaN`.
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Prerelease without its separator, e.g. `rc.1`, `dev-2`, `beta`. */
  prerelease: string | null;
  /** Exactly the string that was parsed. */
  raw: string;
}

// The core is three numeric components. After it comes an optional
// prerelease, in one of exactly two shapes:
//
//   -<ids>   hyphen-separated, where the ids are a dot-separated list, so
//            `rc.1` and `dev-2` both work and a label may itself contain a
//            hyphen.
//   .<id>    dot-separated and a *single* label, which is the `2.0.0.beta`
//            style. Restricting this to one label is what keeps
//            `1.2.3.4.5.6` — a malformed six-part version — from being read
//            as a prerelease.
//
// Every identifier must start and end alphanumeric, so a trailing or doubled
// separator is rejected rather than silently trimmed.
//
// Named groups rather than positional ones: the two alternation branches make
// the group numbering easy to get wrong, and a misplaced capture would
// silently drop the prerelease.
const ID = '[0-9A-Za-z](?:[0-9A-Za-z-]*[0-9A-Za-z])?';
const VERSION_RE = new RegExp(
  '^(?<major>\\d+)\\.(?<minor>\\d+)\\.(?<patch>\\d+)' +
    `(?:(?:-(?<preDash>${ID}(?:\\.${ID})*))|(?:\\.(?<preDot>${ID})))?$`,
);

/** Bump kinds accepted by `bumpVersion`. */
export type BumpType = 'major' | 'minor' | 'patch';

/** Parse a version string, throwing on anything malformed. */
export function parseVersion(version: string): ParsedVersion {
  const match = VERSION_RE.exec(version.trim());
  if (match?.groups === undefined) {
    throw new Error(
      `Cannot parse version "${version}". Expected MAJOR.MINOR.PATCH with an ` +
        `optional prerelease, e.g. 2.1.0, 2.1.0-rc.1 or 2.0.0.beta.`,
    );
  }
  const { major, minor, patch, preDash, preDot } = match.groups;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    // Exactly one of the two branches can have matched, and both require a
    // leading alphanumeric, so neither can ever be an empty string.
    prerelease: preDash ?? preDot ?? null,
    raw: version,
  };
}

/** True when `value` is a version this module can parse. */
export function isVersion(value: string): boolean {
  return VERSION_RE.test(value.trim());
}

/**
 * Resolve the next version.
 *
 * `type` is either an explicit version (used verbatim after validation) or one
 * of `major` / `minor` / `patch`.
 *
 * Bumping from a prerelease drops the prerelease and lands on that release's
 * own final version, following semver: `2.1.0-rc.1` with `patch` or `minor`
 * gives `2.1.0`, because `2.1.0-rc.1 < 2.1.0` and the next version after a
 * release candidate *is* the release. Only `major` moves the core version.
 */
export function bumpVersion(current: string, type: string): string {
  if (isVersion(type)) {
    // Parse for validation, then return the caller's exact string so an
    // explicit `2.0.0.beta` stays a dot prerelease rather than being
    // normalised to `2.0.0-beta`.
    parseVersion(type);
    return type;
  }
  if (type !== 'major' && type !== 'minor' && type !== 'patch') {
    throw new Error(
      `Unknown bump type: "${type}". Expected major, minor, patch, or an ` +
        `explicit version such as 2.1.0-rc.1.`,
    );
  }

  const { major, minor, patch, prerelease } = parseVersion(current);

  // A prerelease is a pre-release *of* its own version, so any bump short of a
  // major lands on that version without the prerelease tag.
  if (prerelease !== null) {
    if (type === 'major') return `${major + 1}.0.0`;
    return `${major}.${minor}.${patch}`;
  }

  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}
