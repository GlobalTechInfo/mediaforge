/**
 * Shared flag-parsing helpers for the CLI task table.
 *
 * Extracted from `tasks.ts` so the second task module does not have to import
 * (and therefore not create a cycle with) the first one.
 */

export type CliFlags = Record<string, string | boolean>;

/** Read a flag that is expected to carry a string value. */
export function str(f: CliFlags, k: string): string | undefined {
  const v = f[k];
  return typeof v === 'string' ? v : undefined;
}

/** Read a flag that is expected to carry a number, rejecting NaN early. */
export function num(f: CliFlags, k: string): number | undefined {
  const v = str(f, k);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${k} must be a number, got "${v}"`);
  return n;
}

/** Read a comma-separated flag as a trimmed, non-empty list. */
export function list(f: CliFlags, k: string): string[] {
  const v = str(f, k);
  return v === undefined || v === '' ? [] : v.split(',').map(s => s.trim()).filter(Boolean);
}

/** Read a boolean flag. `--flag`, `--flag=true` and `--flag=1` are true. */
export function bool(f: CliFlags, k: string): boolean | undefined {
  const v = f[k];
  return v === undefined ? undefined : v !== 'false' && v !== '0';
}

/** Assert a flag is present and return it, with the flag name in the error. */
export function requireFlag(f: CliFlags, k: string, task: string): string {
  const v = str(f, k);
  if (v === undefined || v === '') throw new Error(`${task} requires --${k}`);
  return v;
}

/**
 * Coerce a CLI string into the primitive the filter option interfaces use:
 * `'true'`/`'false'` become booleans, finite numeric strings become numbers,
 * everything else stays a string.
 */
export function coerceValue(v: string): string | number | boolean {
  if (v === 'true') return true;
  if (v === 'false') return false;
  // Only plain decimal numbers are coerced. `Number()` would also accept
  // '0x10', '0b101' and '  7  ', none of which are numbers a user meant when
  // they typed them into a filter option.
  if (/^-?\d+(?:\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/** Parse repeated `key=value` option tokens into a record of coerced values. */
export function parseOptions(tokens: string[]): Record<string, string | number | boolean> {
  const rec: Record<string, string | number | boolean> = {};
  for (const tok of tokens) {
    const eq = tok.indexOf('=');
    if (eq === -1) throw new Error(`option "${tok}" must be in key=value form`);
    const key = tok.slice(0, eq);
    if (key === '') throw new Error(`option "${tok}" has an empty key`);
    rec[key] = coerceValue(tok.slice(eq + 1));
  }
  return rec;
}
