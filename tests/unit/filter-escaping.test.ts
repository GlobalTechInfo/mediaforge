import { describe, it } from 'node:test';
import { expect } from '../lib/expect.js';
import { escapeDrawtextValue, escapeFilterValue } from '../../lib/utils/filter.ts';

describe('escapeDrawtextValue — %{...} expansions survive', () => {
  /**
   * The escaping must skip the *inside* of a drawtext expansion. Escaping a colon
   * there produces `%{eif\:t%b}`, which ffmpeg no longer evaluates as an
   * expression - so `%{eif:t%b}` came back broken while the doc comment claimed
   * it was preserved.
   */
  it('passes an expansion through untouched', () => {
    expect(escapeDrawtextValue('%{pts}')).toBe('%{pts}');
    expect(escapeDrawtextValue('%{pts_hms}')).toBe('%{pts_hms}');
    expect(escapeDrawtextValue('%{eif:t%b}')).toBe('%{eif:t%b}');
    expect(escapeDrawtextValue('%{metadata:title}')).toBe('%{metadata:title}');
  });

  it('still escapes the literal text around an expansion', () => {
    expect(escapeDrawtextValue('a:%{eif:t%b}:c')).toBe('a\\:%{eif:t%b}\\:c');
    expect(escapeDrawtextValue('x,y;z=w[v](u)')).toBe('x\\,y\\;z\\=w\\[v\\]\\(u\\)');
    expect(escapeDrawtextValue("it's")).toBe("it'\\''s");
    expect(escapeDrawtextValue('back\\slash')).toBe('back\\\\slash');
  });

  it('treats an unterminated %{ as ordinary text, as ffmpeg would', () => {
    expect(escapeDrawtextValue('%{unclosed')).toBe('%{unclosed');
    expect(escapeDrawtextValue('a:%{unclosed')).toBe('a\\:%{unclosed');
  });

  it('handles an empty expansion and adjacent expansions', () => {
    expect(escapeDrawtextValue('%{}')).toBe('%{}');
    expect(escapeDrawtextValue('%{a}%{b}')).toBe('%{a}%{b}');
    expect(escapeDrawtextValue(':%{a}:')).toBe('\\:%{a}\\:');
  });

  it('leaves a bare % alone', () => {
    expect(escapeDrawtextValue('100% sure')).toBe('100% sure');
    expect(escapeDrawtextValue('50%%')).toBe('50%%');
  });

  it('is total over random input', () => {
    // Fuzz against a reference built only from the literal-escaping step, which
    // is what the implementation must reduce to once the expansions are removed.
    const literal = (s: string): string =>
      s
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "'\\''")
        .replace(/:/g, '\\:')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;')
        .replace(/=/g, '\\=')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');

    const alphabet = ['%', '{', '}', '\\', "'", ':', ';', ',', '=', '[', ']', '(', ')', 'a', ' '];
    for (let i = 0; i < 3000; i++) {
      const n = Math.floor(Math.random() * 16);
      let s = '';
      for (let j = 0; j < n; j++) s += alphabet[Math.floor(Math.random() * alphabet.length)];

      // Build the expectation the same way the code does: expansions copied
      // verbatim, everything else escaped.
      let expected = '';
      let segmentStart = 0;
      let k = 0;
      let close = s.indexOf('}');
      while (k < s.length) {
        if (s.charCodeAt(k) === 0x25 && s.charCodeAt(k + 1) === 0x7b && close > k + 1) {
          expected += literal(s.slice(segmentStart, k)) + s.slice(k, close + 1);
          k = close + 1;
          segmentStart = k;
          close = s.indexOf('}', k);
          continue;
        }
        k++;
      }
      expected += literal(s.slice(segmentStart));

      if (escapeDrawtextValue(s) !== expected) {
        throw new Error(`mismatch for ${JSON.stringify(s)}: got ${JSON.stringify(escapeDrawtextValue(s))}, want ${JSON.stringify(expected)}`);
      }
    }
  });
});

describe('escapeDrawtextValue — no polynomial backtracking', () => {
  /**
   * CodeQL js/polynomial-redos (high), alert 53, open on `main`.
   *
   * The old implementation contained `.replace(/%{[^}]*}/g, (match) => match)`.
   * That line was the identity function — a no-op whose only observable effect
   * was the cost of scanning — and it was quadratic: with no closing brace in
   * the input, every `%{` restarts a scan for `}`, so a 192 KB value took
   * **36.8 seconds** of blocked event loop. Anyone who can influence drawtext
   * content could stall the process.
   *
   * The bound below is deliberately loose in both directions: the linear
   * implementation takes ~3 ms for this input, so 1500 ms leaves roughly 500x
   * headroom for a slow or loaded machine, while the quadratic one needs ~37 s
   * and misses by ~25x. A timing assertion can only be as good as its margins,
   * which is why the correctness assertions above carry the real weight.
   */
  it('stays fast on input with many %{ and no closing brace', () => {
    const adversarial = '%{'.repeat(96_000) + 'a'.repeat(96_000);
    expect(adversarial.length).toBe(288_000);

    const started = process.hrtime.bigint();
    const out = escapeDrawtextValue(adversarial);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    // No `}` anywhere, so nothing is treated as an expansion and nothing is escaped.
    expect(out).toBe(adversarial);
    expect(elapsedMs).toBeLessThan(1500);
  });

  it('stays fast on input with many complete expansions', () => {
    const adversarial = '%{eif:t%b}'.repeat(32_000);
    const started = process.hrtime.bigint();
    const out = escapeDrawtextValue(adversarial);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    expect(out).toBe(adversarial);
    expect(elapsedMs).toBeLessThan(1500);
  });
});

describe('escapeFilterValue is unchanged', () => {
  it('escapes everything including colons and brackets', () => {
    expect(escapeFilterValue('a:b')).toBe('a\\:b');
    expect(escapeFilterValue('x[y]')).toBe('x\\[y\\]');
    expect(escapeFilterValue('50%')).toBe('50%');
  });
});