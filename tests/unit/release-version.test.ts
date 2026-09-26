/**
 * tests/unit/release-version.test.ts
 *
 * The version parser behind `npm run release`. Every case is a real format
 * this project has used or could ship, and each is checked for both the parsed
 * shape and the exact string that comes back out — a parser that quietly
 * rewrites `2.0.0.beta` to `2.0.0-beta` would publish a different version
 * than the tag.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bumpVersion, isVersion, parseVersion } from '../../scripts/release-version.ts';

// The formats the release script must survive, verbatim from the request.
const FORMATS = [
  '2.1.0-rc.1',
  '2.1.0-alpha',
  '2.0.0.beta',
  '2.0.1-dev',
  '2.1.1-dev-2',
  '2.1.0',
] as const;

describe('parseVersion', () => {
  it('parses every supported format', () => {
    for (const raw of FORMATS) {
      const v = parseVersion(raw);
      assert.strictEqual(v.raw, raw);
      assert.ok(Number.isInteger(v.major), `${raw}: major must be an integer`);
      assert.ok(Number.isInteger(v.minor), `${raw}: minor must be an integer`);
      assert.ok(Number.isInteger(v.patch), `${raw}: patch must be an integer`);
    }
  });

  it('splits the core components of each format', () => {
    const expected: Record<string, [number, number, number, string | null]> = {
      '2.1.0-rc.1': [2, 1, 0, 'rc.1'],
      '2.1.0-alpha': [2, 1, 0, 'alpha'],
      // A dot prerelease has no hyphen; it is still a prerelease, not a
      // four-part version, and must not be read as patch=0.
      '2.0.0.beta': [2, 0, 0, 'beta'],
      '2.0.1-dev': [2, 0, 1, 'dev'],
      // The prerelease label itself contains a hyphen and must survive whole.
      '2.1.1-dev-2': [2, 1, 1, 'dev-2'],
      '2.1.0': [2, 1, 0, null],
    };
    for (const [raw, [major, minor, patch, prerelease]] of Object.entries(expected)) {
      const v = parseVersion(raw);
      assert.deepStrictEqual(
        [v.major, v.minor, v.patch, v.prerelease],
        [major, minor, patch, prerelease],
        raw,
      );
    }
  });

  it('keeps a multi-part prerelease intact rather than dropping the counter', () => {
    assert.strictEqual(parseVersion('2.1.0-rc.1').prerelease, 'rc.1');
    assert.strictEqual(parseVersion('2.1.1-dev-2').prerelease, 'dev-2');
    assert.strictEqual(parseVersion('2.0.0.beta').prerelease, 'beta');
  });

  it('tolerates surrounding whitespace', () => {
    assert.strictEqual(parseVersion('  2.1.0-rc.1  ').raw, '  2.1.0-rc.1  ');
    assert.strictEqual(parseVersion(' 2.1.0-rc.1 ').prerelease, 'rc.1');
  });

  it('rejects anything that is not a version', () => {
    const bad = [
      '', ' ', 'x', '1', '1.2', '1.2.3.4.5.6', 'v1.2.3', '1.2.3-', '1.2.-3',
      'latest', 'next', '1.2.x', '1.2.3-rc..1', '  ', '1.2.3.', '.1.2.3',
      '2.1.0-', '2.1.0.', '2..0', '2.1.0 rc.1',
    ];
    for (const value of bad) {
      assert.throws(
        () => parseVersion(value),
        /Cannot parse version/,
        `expected ${JSON.stringify(value)} to be rejected`,
      );
    }
  });

  it('trims rather than rejecting surrounding whitespace', () => {
    // A version pasted from a file or a CI log often carries a newline; that
    // is a formatting accident, not a malformed version.
    assert.strictEqual(parseVersion('2.1.0-rc.1\n').prerelease, 'rc.1');
    assert.strictEqual(parseVersion('\t2.0.0.beta ').prerelease, 'beta');
    assert.ok(isVersion(' 2.1.0 '));
  });

  it('isVersion agrees with parseVersion', () => {
    for (const raw of FORMATS) {
      assert.ok(isVersion(raw), raw);
      assert.doesNotThrow(() => parseVersion(raw), raw);
    }
    for (const bad of ['', 'x', '1.2', 'v1.2.3', 'latest', '1.2.3-']) {
      assert.ok(!isVersion(bad), bad);
    }
  });
});

describe('bumpVersion — explicit versions', () => {
  it('returns every requested format verbatim, preserving its separator', () => {
    // The tag and the manifest must agree character for character; rewriting
    // the dot in `2.0.0.beta` to a hyphen would publish a different version.
    for (const raw of FORMATS) {
      assert.strictEqual(bumpVersion('1.0.0', raw), raw, raw);
    }
  });

  it('accepts an explicit version from any starting point', () => {
    assert.strictEqual(bumpVersion('2.1.0-rc.1', '2.0.0'), '2.0.0');
    assert.strictEqual(bumpVersion('2.0.0', '2.1.1-dev-2'), '2.1.1-dev-2');
  });

  it('rejects anything that is neither a version nor a bump word', () => {
    // The previous implementation used /^\d+\.\d+\.\d+/ as an unanchored
    // prefix test, so "2.1.0junk" and "1.2.3-" both counted as versions and
    // would have been written straight into package.json and pushed as a tag.
    // Anchoring the test means both are now refused.
    assert.throws(() => bumpVersion('1.0.0', '2.1.0junk'), /Unknown bump type/);
    assert.throws(() => bumpVersion('1.0.0', '1.2.3-'), /Unknown bump type/);
    assert.throws(() => bumpVersion('1.0.0', 'v2.1.0'), /Unknown bump type/);
    assert.throws(() => bumpVersion('1.0.0', '2.1.0 rc.1'), /Unknown bump type/);
  });
});

describe('bumpVersion — major / minor / patch', () => {
  it('bumps a plain version', () => {
    assert.strictEqual(bumpVersion('2.1.0', 'patch'), '2.1.1');
    assert.strictEqual(bumpVersion('2.1.0', 'minor'), '2.2.0');
    assert.strictEqual(bumpVersion('2.1.0', 'major'), '3.0.0');
  });

  it('promotes a prerelease to its own final version', () => {
    // 2.1.0-rc.1 < 2.1.0, so the next version after a release candidate is the
    // release — not 2.1.1. This is the case the old code got wrong: it read
    // '2.1.0-rc.1'.split('.') as [2, 1, NaN, 1] and produced '2.1.NaN'.
    assert.strictEqual(bumpVersion('2.1.0-rc.1', 'patch'), '2.1.0');
    assert.strictEqual(bumpVersion('2.1.0-rc.1', 'minor'), '2.1.0');
  });

  it('promotes every prerelease format, not just hyphen ones', () => {
    assert.strictEqual(bumpVersion('2.1.0-alpha', 'patch'), '2.1.0');
    assert.strictEqual(bumpVersion('2.0.0.beta', 'patch'), '2.0.0');
    assert.strictEqual(bumpVersion('2.0.1-dev', 'patch'), '2.0.1');
    assert.strictEqual(bumpVersion('2.1.1-dev-2', 'patch'), '2.1.1');
  });

  it('a major bump from a prerelease still advances the core', () => {
    assert.strictEqual(bumpVersion('2.1.0-rc.1', 'major'), '3.0.0');
    assert.strictEqual(bumpVersion('2.0.0.beta', 'major'), '3.0.0');
    assert.strictEqual(bumpVersion('2.1.1-dev-2', 'major'), '3.0.0');
  });

  it('never emits NaN for any requested format', () => {
    for (const from of FORMATS) {
      for (const type of ['major', 'minor', 'patch'] as const) {
        const next = bumpVersion(from, type);
        assert.ok(!next.includes('NaN'), `${from} ${type} -> ${next}`);
        assert.ok(isVersion(next), `${from} ${type} -> ${next} is not a version`);
      }
    }
  });

  it('rejects an unknown bump type', () => {
    for (const bad of ['', 'prerelease', 'rc', 'MAJOR', 'Minor', '1']) {
      assert.throws(
        () => bumpVersion('2.1.0', bad),
        /Unknown bump type/,
        `expected ${JSON.stringify(bad)} to be rejected`,
      );
    }
  });

  it('propagates a malformed current version rather than producing NaN', () => {
    assert.throws(() => bumpVersion('not-a-version', 'patch'), /Cannot parse version/);
    assert.throws(() => bumpVersion('2.1', 'minor'), /Cannot parse version/);
  });
});

describe('bumpVersion — monotonicity', () => {
  it('every bump lands on a version strictly greater than its source', () => {
    // Guards the property that matters: a release must never go backwards.
    // The prerelease is part of the ordering — 2.1.0-rc.1 < 2.1.0 — so
    // promoting a release candidate compares as an advance even though the
    // numeric core is unchanged.
    const order = (v: string): [number, number, number, number] => {
      const p = parseVersion(v);
      return [p.major, p.minor, p.patch, p.prerelease === null ? 1 : 0];
    };
    const gt = (
      a: [number, number, number, number],
      b: [number, number, number, number],
    ): boolean => {
      for (let i = 0; i < 4; i++) {
        if (a[i]! !== b[i]!) return a[i]! > b[i]!;
      }
      return false;
    };
    for (const from of FORMATS) {
      for (const type of ['major', 'minor', 'patch'] as const) {
        const to = bumpVersion(from, type);
        assert.ok(
          gt(order(to), order(from)),
          `${from} ${type} -> ${to} did not advance`,
        );
      }
    }
  });
});
