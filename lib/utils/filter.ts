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

/**
 * Escape a value for use inside a drawtext `text=` option.
 * Unlike escapeFilterValue, this preserves `%{...}` expansions
 * (e.g. `%{pts_hms}`, `%{pts}`) used by ffmpeg's drawtext filter.
 */
export function escapeDrawtextValue(s: string): string {
  // Must escape backslash first, then single quotes
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\''")
    // Preserve %{...} expressions — do NOT escape the % inside them
    .replace(/%{[^}]*}/g, (match) => match)
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/=/g, '\\=')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}
