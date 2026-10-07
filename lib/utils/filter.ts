/**
 * Escape a value for use inside an ffmpeg filter option string.
 * Preserves `%{...}` expressions (used by drawtext for pts/pos expansions).
 */
export function escapeFilterValue(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\''")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/=/g, '\\=')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/!/g, '\\!')
    .replace(/\^/g, '\\^')
    .replace(/\*/g, '\\*')
    .replace(/\?/g, '\\?')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/&/g, '\\&')
    .replace(/</g, '\\<')
    .replace(/>/g, '\\>');
}

/** Escape one run of literal text, leaving `%{...}` expansions out of scope. */
function escapeDrawtextLiteral(s: string): string {
  // Must escape backslash first, then single quotes
  return s
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
}

/**
 * Escape a value for use inside a drawtext `text=` option.
 *
 * Unlike {@link escapeFilterValue}, `%{...}` expansions (e.g. `%{pts_hms}`,
 * `%{eif:t\:b}`) are passed through untouched. Escaping a colon inside one
 * turns `%{eif:t%b}` into `%{eif\\:t%b}`, which ffmpeg no longer evaluates as an
 * expression - so the surrounding text is escaped and the expressions are not.
 *
 * Scanned with `indexOf` rather than `/%\{[^}]*\}/g`. That regex is quadratic:
 * with no closing brace in the input, each of the many `%{` positions rescans the
 * rest of the string looking for `}`, so a 192 KB value took 36.8 seconds
 * (CodeQL js/polynomial-redos). A single forward pass with `indexOf` is linear.
 *
 * An unterminated `%{` is treated as ordinary text, since ffmpeg would not expand
 * it either.
 */
export function escapeDrawtextValue(s: string): string {
  let out = '';
  let segmentStart = 0;
  let i = 0;
  // Position of the next `}` at or after `i`, carried forward. Calling
  // `indexOf('}', i + 2)` at every `%{` instead is quadratic on its own: with no
  // closing brace anywhere in the input, each of the many `%{` rescans the whole
  // remaining string. Here every `indexOf` starts strictly after the last, so
  // the total cost is one pass.
  let close = s.indexOf('}');
  while (i < s.length) {
    if (s.charCodeAt(i) === 0x25 /* % */ && s.charCodeAt(i + 1) === 0x7b /* { */ && close > i + 1) {
      out += escapeDrawtextLiteral(s.slice(segmentStart, i));
      out += s.slice(i, close + 1); // the expansion, verbatim
      i = close + 1;
      segmentStart = i;
      close = s.indexOf('}', i);
      continue;
    }
    i++;
  }
  return out + escapeDrawtextLiteral(s.slice(segmentStart));
}
