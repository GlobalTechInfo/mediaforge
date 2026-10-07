import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertValidIo, validateInputs, validateOutputs } from '../../lib/utils/validate.ts';
import { CliUsageError, parseArgs, type FlagSpec } from '../../lib/cli/parser.ts';
import { exitWith } from '../../lib/cli/exit.ts';
import { FFmpegQueue, getDefaultQueue, setDefaultQueue } from '../../lib/queue.ts';

/**
 * Error and edge branches that the battle suite only reaches incidentally, so
 * they showed up as uncovered despite being ordinary reachable code.
 */
describe('validateInputs — unreadable paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mediaforge-validate-'));

  it('surfaces ENOTDIR as "does not exist", not as a read failure', () => {
    const parentFile = join(dir, 'parent-file');
    writeFileSync(parentFile, 'not a directory');
    // `existsSync` cannot resolve `parent-file/child.mp4`, so this is reported
    // as a missing file even though the real cause is that the parent is not a
    // directory. Locked in because the wording is what a user acts on.
    const issues = validateInputs([join(parentFile, 'child.mp4')]);
    assert.equal(issues.length, 1);
    assert.match(issues[0]!.problem, /does not exist/);
  });

  it('reports an input that is a directory', () => {
    const asDir = join(dir, 'a-directory');
    mkdirSync(asDir, { recursive: true });
    const issues = validateInputs([asDir]);
    assert.equal(issues.length, 1);
    assert.match(issues[0]!.problem, /directory/);
    assert.match(issues[0]!.hint, /concat/);
  });

  it('reports a missing input', () => {
    const issues = validateInputs([join(dir, 'nope.mp4')]);
    assert.equal(issues.length, 1);
    assert.match(issues[0]!.problem, /does not exist|not a file/);
  });

  it('accepts an existing readable file', () => {
    const input = join(dir, 'real.mp4');
    writeFileSync(input, 'x');
    assert.deepEqual(validateInputs([input]), []);
  });

  after(() => rmSync(dir, { recursive: true, force: true }));
});

describe('validateOutputs — bad parents and unreadable directories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mediaforge-validate-out-'));

  it('reports an output whose parent is a regular file', () => {
    const file = join(dir, 'plain-file');
    writeFileSync(file, 'x');
    const issues = validateOutputs([join(file, 'out.mp4')]);
    assert.equal(issues.length, 1);
    assert.match(issues[0]!.problem, /parent is not a directory/);
    assert.match(issues[0]!.hint, /path above this one is a file/);
  });

  it('accepts an output inside a directory the owner cannot read', () => {
    // Documented rather than wished away: validateOutputs checks that the parent
    // exists and is a directory, and does not attempt to read it, so a
    // mode-000 directory is accepted here. Whether ffmpeg can then write into it
    // is reported by the encode, not by this check.
    const locked = join(dir, 'locked');
    mkdirSync(locked);
    chmodSync(locked, 0o000);
    try {
      assert.deepEqual(validateOutputs([join(locked, 'out.mp4')]), []);
    } finally {
      chmodSync(locked, 0o700);
    }
  });

  it('accepts a writable output path', () => {
    assert.deepEqual(validateOutputs([join(dir, 'out.mp4')]), []);
  });

  it('assertValidIo throws with every problem listed', () => {
    const asDir = join(dir, 'dir-input');
    mkdirSync(asDir, { recursive: true });
    assert.throws(
      () => assertValidIo([asDir], [join(asDir, 'nested', 'out.mp4')]),
      /Refusing to run: 2 problem/,
    );
  });

  it('assertValidIo returns quietly when everything is fine', () => {
    const input = join(dir, 'ok.mp4');
    writeFileSync(input, 'x');
    assert.doesNotThrow(() => assertValidIo([input], [join(dir, 'out.mp4')]));
  });

  after(() => rmSync(dir, { recursive: true, force: true }));
});

describe('parseArgs — --name=value and the bare -- separator', () => {
  const spec: Record<string, FlagSpec> = {
    json: { takesValue: false, repeatable: false },
    start: { takesValue: true, repeatable: false },
    set: { takesValue: true, repeatable: true },
  };

  it('accepts --name=value for a value flag', () => {
    // The parser records the raw text; coercing to a number is the caller's job,
    // so `--start=5` and `--start 5` are indistinguishable here by design.
    assert.deepEqual(parseArgs(['--start=5'], spec).flags, { start: '5' });
    assert.deepEqual(parseArgs(['--start', '5'], spec).flags, { start: '5' });
  });

  it('accepts --name=value for a boolean flag', () => {
    assert.deepEqual(parseArgs(['--json=true'], spec).flags, { json: 'true' });
    assert.deepEqual(parseArgs(['--json'], spec).flags, { json: true });
  });

  it('collects a repeated --set=a --set=b', () => {
    assert.deepEqual(parseArgs(['--set=a=1', '--set=b=2'], spec).flags, { set: ['a=1', 'b=2'] });
  });

  it('accepts a bare -- with nothing after it', () => {
    // A trailing `--` is simply a no-op terminator. The
    // '"--" must be followed by at least one argument' error exists in the parser
    // but cannot be reached: the `arg === '--'` case is consumed earlier and
    // `continue`s, so `body` is never empty at that point. Kept as a test so the
    // reachable behaviour is the documented one.
    assert.deepEqual(parseArgs(['--'], spec), { positional: [], flags: {} });
  });

  it('treats everything after -- as positional', () => {
    const parsed = parseArgs(['--json', '--', '--not-a-flag', '-x'], spec);
    assert.deepEqual(parsed.positional, ['--not-a-flag', '-x']);
    assert.deepEqual(parsed.flags, { json: true });
  });

  it('rejects an unknown flag in --name=value form and lists the known ones', () => {
    assert.throws(() => parseArgs(['--nope=1'], spec), /unknown flag --nope/);
    assert.throws(() => parseArgs(['--nope=1'], spec), /--json/);
  });

  it('reports a missing value for a value flag', () => {
    assert.throws(() => parseArgs(['--start'], spec), CliUsageError);
  });
});

describe('exitWith', () => {
  it('sets process.exitCode rather than calling process.exit', () => {
    const before = process.exitCode;
    try {
      exitWith(2);
      // The whole point of the helper: the code is recorded and the event loop is
      // left to drain, so piped stdout is not truncated on the way out.
      assert.equal(process.exitCode, 2);
    } finally {
      process.exitCode = before;
    }
  });
});

describe('getDefaultQueue — environment, reuse and resize', () => {
  it('reads MEDIAFORGE_CONCURRENCY when no concurrency is requested', () => {
    setDefaultQueue(undefined);
    const before = process.env['MEDIAFORGE_CONCURRENCY'];
    try {
      process.env['MEDIAFORGE_CONCURRENCY'] = '3';
      const queue = getDefaultQueue();
      assert.ok(queue instanceof FFmpegQueue);
      assert.equal(queue.concurrency, 3);
    } finally {
      if (before === undefined) delete process.env['MEDIAFORGE_CONCURRENCY'];
      else process.env['MEDIAFORGE_CONCURRENCY'] = before;
      setDefaultQueue(undefined);
    }
  });

  it('ignores a non-positive or non-integer concurrency from the environment', () => {
    for (const raw of ['0', '-4', 'abc', '2.5', '']) {
      setDefaultQueue(undefined);
      const before = process.env['MEDIAFORGE_CONCURRENCY'];
      try {
        process.env['MEDIAFORGE_CONCURRENCY'] = raw;
        assert.equal(getDefaultQueue().concurrency, 1, `raw=${JSON.stringify(raw)}`);
      } finally {
        if (before === undefined) delete process.env['MEDIAFORGE_CONCURRENCY'];
        else process.env['MEDIAFORGE_CONCURRENCY'] = before;
        setDefaultQueue(undefined);
      }
    }
  });

  it('still accepts a bare number for backwards compatibility', () => {
    setDefaultQueue(undefined);
    assert.equal(getDefaultQueue(4).concurrency, 4);
    setDefaultQueue(undefined);
  });

  it('resizes when maxPending changes on its own', () => {
    setDefaultQueue(undefined);
    const first = getDefaultQueue({ concurrency: 2 });
    assert.equal(getDefaultQueue({ concurrency: 2 }), first);

    // Same concurrency, different maxPending: this must produce a new queue,
    // or maxPending is silently ignored — the bug CodeRabbit reported.
    const withPending = getDefaultQueue({ concurrency: 2, maxPending: 10 });
    assert.notEqual(first, withPending);
    setDefaultQueue(undefined);
  });
});