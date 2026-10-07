/**
 * Queue, retry and validation behaviour.
 *
 * The failure modes covered here are the ones that turn a slow service into an
 * unusable one: unbounded fan-out of encodes, retries that hammer a machine
 * that is already overloaded, and validation that rejects ffmpeg input syntax
 * this library is supposed to accept.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FFmpegQueue, queued, setDefaultQueue } from '../../lib/queue.ts';
import { withRetry, retryDelay, setLogger, setDiagnosticHook, silentLogger, stderrLogger, type DiagnosticEvent } from '../../lib/observability.ts';
import { assertValidIo, isNonPathInput, validateInputs, validateOutputs } from '../../lib/utils/validate.ts';
import { FFmpegError, FFmpegValidationError } from '../../lib/errors.ts';

// ─── Concurrency ─────────────────────────────────────────────────────────────

describe('FFmpegQueue', () => {
  it('never exceeds its concurrency limit', async () => {
    const queue = new FFmpegQueue({ concurrency: 3 });
    let active = 0;
    let peak = 0;

    const job = () =>
      queue.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active--;
      });

    await Promise.all(Array.from({ length: 12 }, job));

    assert.equal(peak, 3, `peak concurrency was ${peak}, expected exactly 3`);
    assert.equal(active, 0);
  });

  it('runs everything serially at the default concurrency of 1', async () => {
    const queue = new FFmpegQueue();
    assert.equal(queue.concurrency, 1);
    let peak = 0;
    let active = 0;
    await Promise.all(
      Array.from({ length: 5 }, () =>
        queue.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active--;
        }),
      ),
    );
    assert.equal(peak, 1);
  });

  it('resolves with each job’s own value', async () => {
    const queue = new FFmpegQueue({ concurrency: 2 });
    const values = await Promise.all([
      queue.run(async () => 'a'),
      queue.run(async () => 'b'),
      queue.run(async () => 'c'),
    ]);
    assert.deepEqual(values, ['a', 'b', 'c']);
  });

  it('propagates a rejection without stalling the queue', async () => {
    const queue = new FFmpegQueue({ concurrency: 1 });
    await assert.rejects(
      queue.run(async () => {
        throw new Error('job failed');
      }),
      /job failed/,
    );
    // The queue must still be usable afterwards.
    assert.equal(await queue.run(async () => 'still works'), 'still works');
  });

  it('counts outcomes in stats()', async () => {
    const queue = new FFmpegQueue({ concurrency: 2 });
    await Promise.allSettled([
      queue.run(async () => 1),
      queue.run(async () => {
        throw new Error('nope');
      }),
    ]);
    const stats = queue.stats();
    assert.equal(stats.completed, 1);
    assert.equal(stats.failed, 1);
    assert.equal(stats.running, 0);
  });

  it('rejects work past maxPending instead of queueing without limit', async () => {
    const queue = new FFmpegQueue({ concurrency: 1, maxPending: 1 });
    const blocker = queue.run(() => new Promise((resolve) => setTimeout(resolve, 60)));
    const queued1 = queue.run(async () => 'a');

    await assert.rejects(
      queue.run(async () => 'b'),
      (error: unknown) => error instanceof FFmpegError && error.code === 'VALIDATION_FAILED',
    );

    await blocker;
    assert.equal(await queued1, 'a');
  });

  it('does not start a job whose signal aborted while it waited', async () => {
    const queue = new FFmpegQueue({ concurrency: 1 });
    const blocker = queue.run(() => new Promise((resolve) => setTimeout(resolve, 80)));

    const controller = new AbortController();
    const pending = queue.run(async () => 'should not run', { signal: controller.signal });
    controller.abort(new Error('cancelled in the queue'));

    await assert.rejects(pending, (error: unknown) => error instanceof FFmpegError && error.code === 'ABORTED');
    await blocker;
  });

  it('rejects a nonsense concurrency limit', () => {
    assert.throws(() => new FFmpegQueue({ concurrency: 0 }), RangeError);
    assert.throws(() => new FFmpegQueue({ concurrency: -1 }), RangeError);
    assert.throws(() => new FFmpegQueue({ concurrency: 1.5 }), RangeError);
  });

  it('onIdle resolves once everything has finished', async () => {
    const queue = new FFmpegQueue({ concurrency: 2 });
    void queue.run(() => new Promise((resolve) => setTimeout(resolve, 20)));
    void queue.run(() => new Promise((resolve) => setTimeout(resolve, 30)));
    await queue.onIdle();
    assert.equal(queue.stats().pending, 0);
    assert.equal(queue.stats().running, 0);
  });
});

describe('queued()', () => {
  it('uses the process-wide queue', async () => {
    setDefaultQueue(new FFmpegQueue({ concurrency: 1 }));
    assert.equal(await queued(async () => 'ok'), 'ok');
    setDefaultQueue(undefined);
  });
});

// ─── Retry ───────────────────────────────────────────────────────────────────

describe('withRetry', () => {
  it('returns the first success without waiting', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return 'ok';
    }, { retries: 3, initialDelayMs: 1 });
    assert.equal(result, 'ok');
    assert.equal(calls, 1);
  });

  it('retries a transient failure and eventually succeeds', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) {
        throw new FFmpegError('temporary', 'TIMEOUT');
      }
      return 'recovered';
    }, { retries: 3, initialDelayMs: 1, jitter: 0 });

    assert.equal(result, 'recovered');
    assert.equal(calls, 3);
  });

  it('does not retry by default', async () => {
    let calls = 0;
    await assert.rejects(withRetry(async () => {
      calls++;
      throw new FFmpegError('nope', 'TIMEOUT');
    }));
    assert.equal(calls, 1, 'retry must be opt-in');
  });

  it('never retries an abort', async () => {
    let calls = 0;
    await assert.rejects(
      withRetry(async () => {
        calls++;
        throw new FFmpegError('cancelled', 'ABORTED');
      }, { retries: 5, initialDelayMs: 1 }),
      (error: unknown) => (error as FFmpegError).code === 'ABORTED',
    );
    assert.equal(calls, 1, 'a cancelled caller wants the work stopped, not resumed');
  });

  it('never retries a bad argument, which would fail identically', async () => {
    let calls = 0;
    await assert.rejects(
      withRetry(async () => {
        calls++;
        throw new FFmpegError('bad input', 'EXIT_NONZERO');
      }, { retries: 5, initialDelayMs: 1 }),
    );
    assert.equal(calls, 1, 'EXIT_NONZERO is deterministic and must not be retried');
  });

  it('honours a custom shouldRetry', async () => {
    let calls = 0;
    await withRetry(async () => {
      calls++;
      if (calls < 2) throw new FFmpegError('custom', 'EXIT_NONZERO');
      return 'ok';
    }, {
      retries: 3,
      initialDelayMs: 1,
      jitter: 0,
      shouldRetry: () => true,
    });
    assert.equal(calls, 2);
  });

  it('grows the delay exponentially and caps it', () => {
    const opts = { initialDelayMs: 100, factor: 2, maxDelayMs: 500, jitter: 0 };
    assert.equal(retryDelay(0, opts), 100);
    assert.equal(retryDelay(1, opts), 200);
    assert.equal(retryDelay(2, opts), 400);
    assert.equal(retryDelay(3, opts), 500);
    assert.equal(retryDelay(9, opts), 500);
  });

  it('keeps jittered delays within the jitter band', () => {
    for (let i = 0; i < 50; i++) {
      const delay = retryDelay(2, { initialDelayMs: 100, factor: 2, jitter: 0.2 });
      assert.ok(delay >= 320 && delay <= 480, `jittered delay ${delay} outside ±20% of 400`);
    }
  });
});

// ─── Observability ───────────────────────────────────────────────────────────

describe('observability', () => {
  it('is silent until a logger is installed', () => {
    assert.equal(typeof silentLogger.debug, 'function');
    // Must not throw when no logger is configured.
    silentLogger.debug('nothing happens');
  });

  it('accepts a custom logger', () => {
    const seen: string[] = [];
    setLogger({
      debug: (m) => seen.push(`debug:${m}`),
      info: (m) => seen.push(`info:${m}`),
      warn: (m) => seen.push(`warn:${m}`),
      error: (m) => seen.push(`error:${m}`),
    });
    // Replaced again in the next test; here we only assert install/uninstall work.
    setLogger(null);
    assert.deepEqual(seen, []);
  });

  it('reports retries through the diagnostic hook', async () => {
    const events: DiagnosticEvent[] = [];
    setDiagnosticHook((event) => events.push(event));

    let calls = 0;
    await withRetry(async () => {
      calls++;
      if (calls < 2) throw new FFmpegError('flaky', 'TIMEOUT');
      return 'ok';
    }, { retries: 2, initialDelayMs: 1, jitter: 0 });

    setDiagnosticHook(null);
    const retries = events.filter((e) => e.type === 'retry');
    assert.equal(retries.length, 1, 'exactly one retry should be reported');
    assert.equal(retries[0]?.type === 'retry' && retries[0].attempt, 1);
  });

  it('survives a diagnostic hook that throws', async () => {
    setDiagnosticHook(() => {
      throw new Error('observer exploded');
    });
    // Must not reject: an observer cannot be allowed to fail the job.
    await withRetry(async () => 'ok', { retries: 1, initialDelayMs: 1 });
    setDiagnosticHook(null);
  });

  it('builds a stderr logger', () => {
    assert.equal(typeof stderrLogger('warn').warn, 'function');
    assert.equal(typeof stderrLogger().error, 'function');
  });
});

// ─── Validation ──────────────────────────────────────────────────────────────

describe('input validation', () => {
  it('leaves ffmpeg input syntax alone', () => {
    for (const input of [
      'https://example.com/a.mp4',
      'rtmp://live/stream',
      'pipe:0',
      '-',
      'lavfi:testsrc=duration=1',
      'concat:list.txt',
      'anullsrc',
    ]) {
      assert.equal(isNonPathInput(input), true, `${input} should not be treated as a path`);
    }
    assert.equal(isNonPathInput('/tmp/a.mp4'), false);
    assert.equal(isNonPathInput('./a.mp4'), false);
  });

  it('reports a missing input rather than letting ffmpeg fail later', () => {
    const issues = validateInputs(['/definitely/not/here.mp4']);
    assert.equal(issues.length, 1);
    assert.match(issues[0]!.problem, /does not exist/);
  });

  it('reports a directory given as an input', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mediaforge-val-'));
    try {
      const issues = validateInputs([dir]);
      assert.equal(issues.length, 1);
      assert.match(issues[0]!.problem, /directory/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts a real file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mediaforge-val-'));
    try {
      const file = join(dir, 'a.mp3');
      writeFileSync(file, 'x');
      assert.deepEqual(validateInputs([file]), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a missing output directory with an actionable hint', () => {
    const issues = validateOutputs(['/definitely/not/here/out.mp4']);
    assert.equal(issues.length, 1);
    assert.match(issues[0]!.problem, /does not exist/);
    assert.match(issues[0]!.hint, /withAtomicOutput/);
  });

  it('accepts an existing output directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mediaforge-val-'));
    try {
      assert.deepEqual(validateOutputs([join(dir, 'out.mp4')]), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws one error listing every problem', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mediaforge-val-'));
    try {
      mkdirSync(join(dir, 'subdir'));
      assert.throws(
        () =>
          assertValidIo(
            ['/missing-a.mp4', '/missing-b.mp4'],
            [join(dir, 'no-such-dir', 'out.mp4')],
          ),
        (error: unknown) => {
          assert.ok(error instanceof FFmpegValidationError);
          assert.equal(error.code, 'VALIDATION_FAILED');
          assert.match(error.message, /3 problem\(s\)/);
          return true;
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});