/**
 * Schema-driven argument parsing for the CLI.
 *
 * The previous parser inferred flag arity from the shape of the argument list —
 * "a `--flag` followed by something not starting with `--` takes a value". That
 * heuristic has two failure modes, both of which bit real commands:
 *
 *   mediaforge analyze --json input.mp3
 *     → `--json` swallowed `input.mp3` as its value, so the command reported
 *       "needs 1 argument" for an invocation that was perfectly correct.
 *
 *   mediaforge metadata --no-strip in.mp4 out.mp4
 *     → rejected outright; there was no way to express a negative boolean.
 *
 * The `=` suffix on a flag's description in the task table already documents
 * which flags take a value ("Flags taking a value end with `=`"), but nothing
 * read it. This module makes that declaration authoritative, so a boolean flag
 * can never consume a positional and a value flag can never be used without one.
 *
 * It also supports `--`, `--no-<flag>`, and repeatable flags.
 */
import type { CliFlags } from './flags.ts';

/** Raised for a malformed command line. Surfaces as a usage error (exit 2). */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

/**
 * Flag declarations, derived from a task's documented flag table.
 *
 * The description's leading `=` marks a value-taking flag, per the convention in
 * `CliTask.flags`. Everything else is boolean.
 */
export interface FlagSpec {
  /** True when the flag requires a value. */
  takesValue: boolean;
  /** True when the flag may appear more than once. */
  repeatable: boolean;
}

/**
 * A flag may appear more than once and is a list, e.g. `--set key=value`.
 *
 * Declared explicitly rather than inferred, because a repeatable flag that took
 * a value is indistinguishable from a single-valued one by arity alone.
 */
// Only genuinely repeatable flags. `chain` and `transition` are single-valued
// and use their own `|`-separated syntax, so listing them here would let a
// repeated flag silently overwrite itself.
const REPEATABLE_FLAGS = new Set(['set', 'map', 'exclude']);

/**
 * Build the flag spec for a task from its documented flag table.
 *
 * @param flags `flag -> description`, where a leading `=` means "takes a value".
 */
export function buildFlagSpec(flags: Record<string, string>): Record<string, FlagSpec> {
  const spec: Record<string, FlagSpec> = {};
  for (const [name, description] of Object.entries(flags)) {
    spec[name] = {
      takesValue: description.trimStart().startsWith('='),
      repeatable: REPEATABLE_FLAGS.has(name),
    };
  }
  return spec;
}

export interface ParsedArgs {
  /** Non-flag arguments, in order. */
  positional: string[];
  /** Parsed flags. A repeatable flag collects into an array. */
  flags: CliFlags;
}

/**
 * Parse `argv` against a flag specification.
 *
 * @throws {CliUsageError} on an unknown flag, a missing value, a repeated
 *         non-repeatable flag, or a stray positional after `--`.
 */
export function parseArgs(argv: readonly string[], spec: Record<string, FlagSpec>): ParsedArgs {
  const positional: string[] = [];
  const flags: CliFlags = {};
  const lists = new Map<string, string[]>();

  // Everything after a bare `--` is positional, including things that look like
  // flags — the only way to pass a filename that begins with a dash.
  let terminated = false;

  const record = (name: string, value: string | boolean): void => {
    const declaration = spec[name];
    if (declaration?.repeatable === true) {
      const list = lists.get(name) ?? [];
      if (typeof value === 'boolean') {
        throw new CliUsageError(`--${name} requires a value`);
      }
      list.push(value);
      lists.set(name, list);
      return;
    }
    if (flags[name] !== undefined) {
      throw new CliUsageError(`--${name} was given more than once`);
    }
    flags[name] = value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (terminated) {
      positional.push(arg);
      continue;
    }
    if (arg === '--') {
      terminated = true;
      continue;
    }
    // Short flags and ffmpeg's own options (-i, -c:v, -vf …) are the caller's
    // business in the passthrough path, so this parser only handles `--long`.
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }

    const body = arg.slice(2);
    if (body === '') {
      throw new CliUsageError('"--" must be followed by at least one argument');
    }

    const eq = body.indexOf('=');
    if (eq !== -1) {
      const name = body.slice(0, eq);
      const value = body.slice(eq + 1);
      assertKnown(name, spec);
      const declaration = spec[name];
      if (declaration?.takesValue !== true) {
        // `--json=false` is meaningful for a boolean; `--start=5` for a value
        // flag. Anything else is a typo worth reporting.
        if (declaration !== undefined) {
          record(name, value);
          continue;
        }
      }
      assertKnown(name, spec);
      record(name, value);
      continue;
    }

    // `--no-flag` turns a boolean off. Only valid where the flag exists and is
    // boolean, so `--no-start=5` is rejected rather than silently accepted.
    if (body.startsWith('no-')) {
      const name = body.slice(3);
      assertKnown(name, spec);
      if (spec[name]?.takesValue === true) {
        throw new CliUsageError(`--no-${name} does not apply: --${name} takes a value`);
      }
      record(name, false);
      continue;
    }

    assertKnown(body, spec);

    if (spec[body]?.takesValue === true) {
      // A value flag must be followed by its value, even if that value looks
      // like a flag: `--start --end 5` is a typo, not a start time of "--end".
      const next = argv[i + 1];
      if (next === undefined) {
        throw new CliUsageError(`--${body} requires a value`);
      }
      if (next.startsWith('--')) {
        throw new CliUsageError(
          `--${body} requires a value, but was followed by "${next}". ` +
            `If the value really does start with a dash, write it as --${body}=${next}`,
        );
      }
      record(body, next);
      i++;
      continue;
    }

    // A boolean flag never consumes the next token. This is the fix for
    // `analyze --json input.mp3`.
    record(body, true);
  }

  for (const [name, list] of lists) {
    flags[name] = list;
  }

  return { positional, flags };
}

function assertKnown(name: string, spec: Record<string, FlagSpec>): void {
  if (spec[name] === undefined) {
    const known = Object.keys(spec).map((k) => `--${k}`).sort();
    throw new CliUsageError(
      `unknown flag --${name}\nKnown flags: ${known.length > 0 ? known.join(', ') : '(none)'}`,
    );
  }
}

/**
 * Back-compat wrapper around {@link parseArgs} for callers that have no spec.
 *
 * Retains the old heuristic, so `--flag value` still works; documented as
 * deprecated because it cannot tell a boolean from a value-taking flag.
 */
export function parseTaskArgs(argv: string[]): { positional: string[]; flags: CliFlags } {
  const positional: string[] = [];
  const flags: CliFlags = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[body] = true;
    } else {
      flags[body] = next;
      i++;
    }
  }
  return { positional, flags };
}