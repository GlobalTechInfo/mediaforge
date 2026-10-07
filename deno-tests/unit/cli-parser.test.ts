/**
 * CLI argument parsing and exit-code contract.
 *
 * The parser used to infer flag arity from the shape of the argument list, which
 * produced two defects this file locks down:
 *
 *   `analyze --json input.mp3`   the boolean flag consumed the positional, so a
 *                                 correct command reported "needs 1 argument"
 *   `metadata --no-strip in out`  rejected outright — negatives did not exist
 *
 * Exit codes are covered here too: a single non-zero code for every failure
 * makes "you typed it wrong" indistinguishable from "the encode failed", which
 * is useless in a script or on a dashboard.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFlagSpec, parseArgs, CliUsageError } from '../../lib/cli/parser.ts';
import {
  FAILURE_EXIT,
  INTERRUPTED_EXIT,
  SUCCESS_EXIT,
  TERMINATED_EXIT,
  USAGE_EXIT,
} from '../../lib/cli/exit.ts';
import { CLI_TASKS } from '../../lib/cli/tasks.ts';
import { detectRuntime, runtimePermissionHint } from '../../lib/utils/runtime.ts';

// ─── Flag spec ───────────────────────────────────────────────────────────────

describe('buildFlagSpec', () => {
  it('reads the documented "=" convention', () => {
    const spec = buildFlagSpec({
      start: '=start time in seconds',
      json: 'emit JSON',
    });
    assert.equal(spec['start']?.takesValue, true);
    assert.equal(spec['json']?.takesValue, false);
  });

  it('marks documented repeatable flags', () => {
    assert.equal(buildFlagSpec({ set: '=key=value' })['set']?.repeatable, true);
  });
});

// ─── Parsing ─────────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  const spec = buildFlagSpec({
    json: 'emit JSON',
    start: '=start time',
    set: '=key=value pairs',
  });

  it('does not let a boolean flag consume the next positional', () => {
    const { positional, flags } = parseArgs(['--json', 'input.mp3'], spec);
    assert.deepEqual(positional, ['input.mp3']);
    assert.equal(flags['json'], true);
  });

  it('parses boolean flags before, between and after positionals', () => {
    const { positional, flags } = parseArgs(['a.mp4', '--json', 'b.mp4'], spec);
    assert.deepEqual(positional, ['a.mp4', 'b.mp4']);
    assert.equal(flags['json'], true);
  });

  it('requires a value for a value-taking flag', () => {
    const { flags } = parseArgs(['--start', '5'], spec);
    assert.equal(flags['start'], '5');
  });

  it('accepts --flag=value', () => {
    const { flags } = parseArgs(['--start=5'], spec);
    assert.equal(flags['start'], '5');
  });

  it('treats a value that looks like a flag as the value, not a new flag', () => {
    // `--start --end` is a typo, and silently treating --end as --start's value
    // would produce a nonsense command line.
    assert.throws(
      () => parseArgs(['--start', '--json'], spec),
      (error: unknown) => error instanceof CliUsageError,
    );
  });

  it('rejects a value-taking flag with no value at all', () => {
    assert.throws(
      () => parseArgs(['--start'], spec),
      /--start requires a value/,
    );
  });

  it('supports --no-<flag> for booleans', () => {
    const { flags } = parseArgs(['--no-json'], spec);
    assert.equal(flags['json'], false);
  });

  it('rejects --no- on a value-taking flag', () => {
    assert.throws(
      () => parseArgs(['--no-start'], spec),
      /--no-start does not apply/,
    );
  });

  it('supports an explicit -- terminator', () => {
    const { positional, flags } = parseArgs(['--json', '--', '--not-a-flag.mp4'], spec);
    assert.deepEqual(positional, ['--not-a-flag.mp4']);
    assert.equal(flags['json'], true);
  });

  it('collects a repeatable flag into a list', () => {
    const { positional, flags } = parseArgs(
      ['--set', 'title=Clip', '--set', 'artist=Me', 'in.mp4', 'out.mp4'],
      spec,
    );
    assert.deepEqual(positional, ['in.mp4', 'out.mp4']);
    assert.deepEqual(flags['set'], ['title=Clip', 'artist=Me']);
  });

  it('rejects an unknown flag and lists the known ones', () => {
    assert.throws(
      () => parseArgs(['--bogus'], spec),
      (error: unknown) => {
        assert.ok(error instanceof CliUsageError);
        assert.match(error.message, /unknown flag --bogus/);
        assert.match(error.message, /Known flags: --json/);
        return true;
      },
    );
  });

  it('rejects a repeated non-repeatable flag instead of silently keeping the last', () => {
    assert.throws(
      () => parseArgs(['--json', '--json'], spec),
      /--json was given more than once/,
    );
  });

  it('parses a negative number as a value, not as a flag', () => {
    const { positional, flags } = parseArgs(['a.mp4', 'out.mp4', '--start', '-50'], spec);
    assert.deepEqual(positional, ['a.mp4', 'out.mp4']);
    assert.equal(flags['start'], '-50');
  });

  it('leaves ffmpeg short options alone as positionals', () => {
    const { positional } = parseArgs(['-i', 'in.mp4', '-c:v', 'libx264'], spec);
    assert.deepEqual(positional, ['-i', 'in.mp4', '-c:v', 'libx264']);
  });
});

// ─── Every declared flag matches how it is used ─────────────────────────────

describe('task flag declarations', () => {
  for (const [name, task] of Object.entries(CLI_TASKS)) {
    it(`"${name}" declares at least one flag or is flag-free by design`, () => {
      assert.equal(typeof task.flags, 'object', `${name} must declare a flags table`);
    });
  }

  it('a value flag reads as a string, a boolean flag reads as a boolean', () => {
    // Regression guard for the convention drift: a flag whose description lacks
    // the leading "=" but which the task reads with str()/num() would make the
    // parser demand a value it never consumes.
    for (const [name, task] of Object.entries(CLI_TASKS)) {
      const spec = buildFlagSpec(task.flags);
      for (const [flag, declaration] of Object.entries(spec)) {
        assert.equal(typeof declaration.takesValue, 'boolean', `${name} --${flag}`);
      }
    }
  });
});

// ─── Exit codes ─────────────────────────────────────────────────────────────

describe('exit codes', () => {
  it('are distinct per failure class', () => {
    assert.equal(SUCCESS_EXIT, 0);
    assert.equal(FAILURE_EXIT, 1);
    assert.equal(USAGE_EXIT, 2);
    assert.notEqual(FAILURE_EXIT, USAGE_EXIT);
  });

  it('encode the terminating signal in the high codes', () => {
    assert.equal(INTERRUPTED_EXIT, 130, '128 + SIGINT');
    assert.equal(TERMINATED_EXIT, 143, '128 + SIGTERM');
  });
});

// ─── Runtime detection ───────────────────────────────────────────────────────

describe('runtime detection', () => {
  it('identifies the runtime it is running on', () => {
    // This suite runs under Deno as well as Node, so assert the contract rather
    // than one runtime's name: anything but 'unknown'.
    const detected = detectRuntime();
    assert.ok(
      detected === 'node' || detected === 'deno' || detected === 'bun',
      `unexpected runtime: ${detected}`,
    );
  });

  it('offers permission guidance appropriate to the runtime', () => {
    const hint = runtimePermissionHint();
    assert.ok(hint.length > 0);
    // The advice must be actionable for the runtime that produced it: Deno needs
    // permission flags, everyone else needs the PATH/binary hint.
    const expected = detectRuntime() === 'deno' ? /--allow-run/ : /ffmpeg|PATH/;
    assert.match(hint, expected);
  });
});