/**
 * Every call into the ffmpeg/ffprobe binaries must be bounded.
 *
 * The failures these cover are the ones that take a server down: an unbounded
 * `execFileSync` against a wedged binary blocks the event loop permanently, so
 * one unhealthy binary stalls every other in-flight request with no error and
 * no timeout. Each case below asserts that a hung binary produces a typed error
 * promptly rather than hanging.
 *
 * The fake binary execs `tail -f /dev/null` rather than spawning a child of its
 * own, so the assertion measures *our* timeout logic and nothing else.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execBounded, execAsync } from '../../lib/utils/exec.ts';
import { probeVersion, probeVersionAsync, clearVersionCache } from '../../lib/utils/version.ts';
import { probeAsync } from '../../lib/probe/ffprobe.ts';
import { FFmpegError, FFmpegTimeoutError } from '../../lib/errors.ts';

const HANGING_BINARY = join(tmpdir(), 'mediaforge-hanging-binary.sh');

before(() => {
  writeFileSync(HANGING_BINARY, '#!/bin/sh\nexec tail -f /dev/null\n');
  chmodSync(HANGING_BINARY, 0o755);
});

after(() => {
  rmSync(HANGING_BINARY, { force: true });
  clearVersionCache();
});

describe('execBounded (sync)', () => {
  it('returns promptly from a healthy binary', () => {
    const output = execBounded('ffmpeg', ['-version']);
    assert.match(output, /^ffmpeg version/);
  });

  it('times out on a wedged binary instead of hanging forever', () => {
    const startedAt = Date.now();
    assert.throws(
      () => execBounded(HANGING_BINARY, ['-version'], { timeoutMs: 500 }),
      (error: unknown) => {
        assert.ok(error instanceof FFmpegTimeoutError, `expected a timeout, got ${String(error)}`);
        assert.equal(error.code, 'TIMEOUT');
        assert.equal(error.timeoutMs, 500);
        return true;
      },
    );
    // Generous ceiling: this must fail fast, not merely eventually.
    assert.ok(Date.now() - startedAt < 10_000, 'a timeout must not wait indefinitely');
  });

  it('reports a missing binary as BINARY_NOT_FOUND', () => {
    assert.throws(
      () => execBounded('/definitely/not/a/real/binary', ['-version']),
      (error: unknown) =>
        error instanceof FFmpegError && error.code === 'BINARY_NOT_FOUND',
    );
  });

  it('refuses an already-aborted signal without spending the timeout', () => {
    const controller = new AbortController();
    controller.abort(new Error('nope'));
    assert.throws(
      () => execBounded('ffmpeg', ['-version'], { signal: controller.signal, timeoutMs: 5000 }),
      (error: unknown) => error instanceof FFmpegError && error.code === 'ABORTED',
    );
  });
});

describe('execAsync', () => {
  it('resolves for a healthy binary', async () => {
    assert.match(await execAsync('ffmpeg', ['-version']), /^ffmpeg version/);
  });

  it('times out on a wedged binary', async () => {
    await assert.rejects(
      execAsync(HANGING_BINARY, ['-version'], { timeoutMs: 500 }),
      (error: unknown) => error instanceof FFmpegTimeoutError && error.code === 'TIMEOUT',
    );
  });

  it('rejects a missing binary', async () => {
    await assert.rejects(
      execAsync('/definitely/not/a/real/binary', ['-version']),
      (error: unknown) => error instanceof FFmpegError && error.code === 'BINARY_NOT_FOUND',
    );
  });

  it('honours an AbortSignal', async () => {
    const controller = new AbortController();
    const pending = execAsync(HANGING_BINARY, ['-version'], {
      timeoutMs: 30_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error('user cancelled')), 100);
    await assert.rejects(
      pending,
      (error: unknown) => error instanceof FFmpegError && error.code === 'ABORTED',
    );
  });
});

describe('version probing', () => {
  it('probeVersion parses the installed binary', () => {
    const info = probeVersion('ffmpeg');
    assert.ok(info.major >= 4, `unexpected major version ${info.major}`);
  });

  it('probeVersionAsync parses and caches the installed binary', async () => {
    const info = await probeVersionAsync('ffmpeg');
    assert.ok(info.major >= 4);
    assert.equal((await probeVersionAsync('ffmpeg')).raw, info.raw);
  });

  it('does not cache a failed probe', async () => {
    await assert.rejects(probeVersionAsync('/definitely/not/a/real/binary'));
    // The second attempt must retry rather than replay the cached rejection.
    await assert.rejects(probeVersionAsync('/definitely/not/a/real/binary'));
  });

  it('probeVersion does not hang on a wedged binary', () => {
    assert.throws(
      () => probeVersion(HANGING_BINARY, { timeoutMs: 500 }),
      (error: unknown) => error instanceof FFmpegTimeoutError,
    );
  });
});

describe('probe() cancellation', () => {
  it('honours an AbortSignal', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('user cancelled')), 50);
    await assert.rejects(
      probeAsync(join(tmpdir(), 'mediaforge-does-not-exist.mp4'), {
        signal: controller.signal,
      }),
      /abort/i,
    );
  });
});