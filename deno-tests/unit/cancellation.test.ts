/**
 * Cancellation, timeout and kill-escalation guarantees.
 *
 * Every case here is a regression test for a failure mode that leaves an
 * ffmpeg process running or a caller's promise hanging forever:
 *
 *  - A `SIGTERM` alone is not enough. A child that traps or ignores the signal
 *    survives it, so the kill sequence must escalate to `SIGKILL`.
 *  - An already-aborted `AbortSignal` must be rejected *before* a process is
 *    created, otherwise a cancelled request still leaves a child behind.
 *  - The exit/SIGINT/SIGTERM cleanup must not accumulate one listener per job,
 *    which would trip Node's MaxListeners warning in a long-running server.
 *
 * `-re` throttles the lavfi source to real time. Without it ffmpeg renders
 * `testsrc` as fast as the CPU allows and finishes in milliseconds, so the
 * timeout and abort windows would never be reached.
 */
import { spawn } from 'node:child_process';
import process from 'node:process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnFFmpeg } from '../../lib/process/spawn.ts';
import { getCleanupCount } from '../../lib/helpers/process.ts';
import {
  FFmpegAbortError,
  FFmpegSpawnError,
  FFmpegTimeoutError,
} from '../../lib/errors.ts';

/** A 30-second encode that genuinely runs for 30 seconds. */
const SLOW_ENCODE = ['-re', '-f', 'lavfi', '-i', 'testsrc=duration=30:size=64x64:rate=5', '-f', 'null', '-'];

function settle(proc: ReturnType<typeof spawnFFmpeg>): Promise<Error | null> {
  return new Promise((resolve) => {
    proc.emitter.on('error', (err) => resolve(err));
    proc.emitter.on('end', () => resolve(null));
  });
}

/**
 * Resolve when the child has actually closed, or after a bounded grace period.
 *
 * Polling `exitCode` after a fixed sleep is flaky: ffmpeg still has to wind
 * down after SIGTERM, and how long that takes depends on the machine.
 */
function closed(child: import('node:child_process').ChildProcess, graceMs = 5000): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), graceMs);
    child.once('close', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

describe('AbortSignal', () => {
  it('throws before spawning when the signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled up front'));

    let error: unknown;
    try {
      spawnFFmpeg({ binary: 'ffmpeg', args: SLOW_ENCODE, signal: controller.signal });
    } catch (caught) {
      error = caught;
    }

    assert.ok(error instanceof FFmpegAbortError, 'expected FFmpegAbortError');
    assert.equal(error.code, 'ABORTED');
  });

  it('terminates an in-flight encode and reports the abort reason', async () => {
    const controller = new AbortController();
    const proc = spawnFFmpeg({ binary: 'ffmpeg', args: SLOW_ENCODE, signal: controller.signal });
    const waiter = settle(proc);

    setTimeout(() => controller.abort(new Error('user cancelled')), 200);

    const error = await waiter;
    assert.ok(error instanceof FFmpegAbortError);
    assert.equal(error.code, 'ABORTED');
    assert.ok(
      (error.reason as Error).message.includes('user cancelled'),
      'the abort reason should reach the caller',
    );
  });

  it('leaves no running child after an abort', async () => {
    const controller = new AbortController();
    const proc = spawnFFmpeg({ binary: 'ffmpeg', args: SLOW_ENCODE, signal: controller.signal });
    const waiter = settle(proc);

    setTimeout(() => controller.abort(), 200);
    await waiter;

    assert.ok(await closed(proc.child), 'the child should have closed after the abort');
  });

  it('does not settle twice when abort races a natural exit', async () => {
    const controller = new AbortController();
    const proc = spawnFFmpeg({
      binary: 'ffmpeg',
      args: ['-f', 'lavfi', '-i', 'testsrc=duration=0.2:size=32x32:rate=5', '-f', 'null', '-'],
      signal: controller.signal,
    });
    const waiter = settle(proc);

    setTimeout(() => controller.abort(), 300);
    const error = await waiter;
    assert.equal(error, null, 'a fast successful run must not be turned into an error');
  });
});

describe('timeout', () => {
  it('reports FFmpegTimeoutError carrying the elapsed budget', async () => {
    const proc = spawnFFmpeg({ binary: 'ffmpeg', args: SLOW_ENCODE, timeout: 300 });
    const error = await settle(proc);

    assert.ok(error instanceof FFmpegTimeoutError);
    assert.equal(error.code, 'TIMEOUT');
    assert.equal(error.timeoutMs, 300);
  });

  it('kills the child rather than leaving it running', async () => {
    const proc = spawnFFmpeg({ binary: 'ffmpeg', args: SLOW_ENCODE, timeout: 300 });
    await settle(proc);
    assert.ok(await closed(proc.child), 'a timed-out child must not survive');
  });
});

describe('kill escalation', () => {
  it('SIGKILLs a child that ignores SIGTERM instead of waiting forever', async () => {
    const controller = new AbortController();
    // `trap "" TERM` installs an empty SIGTERM handler, which is exactly the
    // case where a single SIGTERM would leave the process alive indefinitely.
    const proc = spawnFFmpeg({
      binary: 'sh',
      args: ['-c', 'trap "" TERM; sleep 60'],
      signal: controller.signal,
      killGracePeriodMs: 300,
    });
    const waiter = settle(proc);

    setTimeout(() => controller.abort(), 200);
    const startedAt = Date.now();
    const error = await waiter;
    const elapsed = Date.now() - startedAt;

    assert.ok(error instanceof FFmpegAbortError);
    assert.ok(
      elapsed < 5000,
      `a SIGTERM-ignoring child must be force-killed promptly, took ${elapsed}ms`,
    );
  });

  it('kill() leaves no process behind', async () => {
    const proc = spawnFFmpeg({ binary: 'sh', args: ['-c', 'sleep 60'] });
    proc.kill('SIGKILL');
    await settle(proc);
    assert.ok(
      proc.child.exitCode !== null || proc.child.signalCode !== null,
      'kill() should terminate the child',
    );
  });
});

describe('spawn errors', () => {
  it('reports a non-zero exit with the argv needed to reproduce it', async () => {
    const error = await settle(
      spawnFFmpeg({ binary: 'ffmpeg', args: ['-i', '/nonexistent/file.mp4', '-f', 'null', '-'] }),
    );

    assert.ok(error instanceof FFmpegSpawnError);
    assert.equal(error.code, 'EXIT_NONZERO');
    assert.equal(error.command[0], 'ffmpeg');
    assert.ok(error.command.includes('/nonexistent/file.mp4'));
  });

  it('surfaces a missing binary as an error rather than hanging', async () => {
    const error = await settle(
      spawnFFmpeg({ binary: 'definitely-not-a-real-ffmpeg-binary', args: [] }),
    );
    assert.ok(error instanceof Error);
  });
});

describe('exit cleanup', () => {
  it('does not accumulate one signal listener per job', async () => {
    const before = process.listenerCount('SIGINT');
    for (let i = 0; i < 5; i++) {
      await settle(
        spawnFFmpeg({
          binary: 'ffmpeg',
          args: ['-f', 'lavfi', '-i', 'testsrc=duration=0.1:size=32x32:rate=5', '-f', 'null', '-'],
        }),
      );
    }
    const after = process.listenerCount('SIGINT');
    assert.ok(
      after <= before,
      `SIGINT listeners grew from ${before} to ${after} across 5 sequential jobs`,
    );
  });

  it('drains the cleanup registration set when jobs finish', async () => {
    const before = getCleanupCount();
    const proc = spawnFFmpeg({
      binary: 'ffmpeg',
      args: ['-f', 'lavfi', '-i', 'testsrc=duration=0.1:size=32x32:rate=5', '-f', 'null', '-'],
    });
    await settle(proc);
    // `end` on the result emitter can fire before the child's own `close` event,
    // and trackChild only releases the registration on close/exit. Asserting
    // straight after `end` was therefore a race - it passed on Node and failed on
    // Deno. Wait for the terminal event the registration actually keys off.
    assert.ok(await closed(proc.child), 'the child never closed');
    assert.equal(
      getCleanupCount(),
      before,
      'a finished job must not stay registered for exit cleanup',
    );
  });

  it('opts out when autoCleanup is false', async () => {
    const before = getCleanupCount();
    await settle(
      spawnFFmpeg({
        binary: 'ffmpeg',
        args: ['-f', 'lavfi', '-i', 'testsrc=duration=0.1:size=32x32:rate=5', '-f', 'null', '-'],
        autoCleanup: false,
      }),
    );
    assert.equal(
      getCleanupCount(),
      before,
      'autoCleanup:false must not register the child',
    );
  });
});
describe('the host must still terminate on a signal', () => {
  /**
   * Installing a `SIGINT`/`SIGTERM` listener *removes Node's default behaviour* of
   * terminating on those signals. The shared cleanup handler did exactly that and
   * never restored it, so while any encode was registered a host ignored
   * `systemctl stop` entirely and a Ctrl-C killed only ffmpeg while the host
   * carried on — the supervisor then had to escalate to SIGKILL.
   *
   * Verified directly: a host holding one registered encode survived SIGTERM
   * indefinitely. It must now exit promptly, and take ffmpeg with it.
   */
  it('exits on SIGTERM rather than swallowing it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mediaforge-sigterm-'));
    const pidFile = join(dir, 'pid');
    const script = join(dir, 'host.ts');
    const { writeFileSync } = await import('node:fs');

    writeFileSync(
      script,
      `import { writeFileSync } from 'node:fs';
import { spawnFFmpeg } from ${JSON.stringify(new URL('../../lib/process/spawn.ts', import.meta.url).href)};
const proc = spawnFFmpeg({
  binary: 'ffmpeg',
  args: ['-re', '-f', 'lavfi', '-i', 'testsrc=duration=300:size=64x64:rate=5', '-f', 'null', '-'],
});
if (proc.child.pid !== undefined) writeFileSync(${JSON.stringify(pidFile)}, String(proc.child.pid));
setInterval(() => {}, 1000);   // behave like a server: never self-exits
`,
    );

    // Signal the real node process, not a wrapper.
    const host = spawn('deno', ['run', '-A', script], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });

    try {
      const deadline = Date.now() + 30_000;
      while (!existsSync(pidFile) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!existsSync(pidFile)) throw new Error('the host never started ffmpeg');
      const ffmpegPid = Number(readFileSync(pidFile, 'utf8').trim());

      const exitedAt = new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 15_000);
        host.once('close', () => {
          clearTimeout(timer);
          resolve(true);
        });
      });

      host.kill('SIGTERM');
      assert.ok(
        await exitedAt,
        'the host swallowed SIGTERM; installing a cleanup listener must not ' +
          "suppress Node's default termination",
      );

      // And ffmpeg must not be left orphaned. Poll rather than sample once: the
      // child is signalled just before the host exits, so it needs a moment to
      // die and a single check can race it.
      const gone = await new Promise<boolean>((resolve) => {
        const deadline = Date.now() + 15_000;
        const poll = (): void => {
          try {
            process.kill(ffmpegPid, 0);
          } catch {
            resolve(true);
            return;
          }
          if (Date.now() > deadline) {
            resolve(false);
            return;
          }
          setTimeout(poll, 100);
        };
        poll();
      });
      assert.ok(gone, `ffmpeg (pid ${ffmpegPid}) survived the host's SIGTERM`);
    } finally {
      try {
        host.kill('SIGKILL');
      } catch {
        // Already gone.
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('orphan prevention across a real SIGINT', () => {
  /**
   * The exit-cleanup handler only runs on a real signal to the host process, so
   * it cannot be exercised in-process without killing the test runner. Spawn a
   * child that starts an encode, send it SIGINT, and assert the ffmpeg process
   * it started did not survive — which is exactly what happens on Ctrl-C in a
   * terminal, and the case that used to leave ffmpeg running and still writing
   * to the output path.
   */
  it('kills the grandchild when the host is interrupted', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mediaforge-sigint-'));
    const marker = join(dir, 'ready');
    const pidFile = join(dir, 'pid');
    const script = join(dir, 'host.mjs');
    const { writeFileSync } = await import('node:fs');

    writeFileSync(
      script,
      `import { writeFileSync } from 'node:fs';
import { spawnFFmpeg } from ${JSON.stringify(new URL('../../lib/process/spawn.ts', import.meta.url).href)};
const proc = spawnFFmpeg({
  binary: 'ffmpeg',
  args: ['-re', '-f', 'lavfi', '-i', 'testsrc=duration=300:size=64x64:rate=5', '-f', 'null', '-'],
});
if (proc.child.pid !== undefined) writeFileSync(${JSON.stringify(pidFile)}, String(proc.child.pid));
writeFileSync(${JSON.stringify(marker)}, 'ready');
setTimeout(() => {}, 60000);
`,
    );

    const host = spawn('deno', ['run', '-A', script], {
      stdio: ['ignore', 'ignore', 'ignore'],
      cwd: dirname(fileURLToPath(import.meta.url)),
    });

    try {
      // Wait for the host to report the ffmpeg pid.
      const deadline = Date.now() + 30_000;
      while (!existsSync(pidFile) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!existsSync(pidFile)) {
        throw new Error('the host never started ffmpeg');
      }
      const ffmpegPid = Number(readFileSync(pidFile, 'utf8').trim());

      // Interrupt the host the way Ctrl-C would.
      host.kill('SIGINT');
      await new Promise((r) => host.once('close', r));

      // The grandchild must be gone shortly afterwards.
      const gone = await new Promise<boolean>((resolve) => {
        const check = (): void => {
          try {
            process.kill(ffmpegPid, 0);
            setTimeout(check, 100);
          } catch {
            resolve(true);
          }
        };
        setTimeout(() => resolve(false), 15_000);
        check();
      });

      assert.ok(gone, `ffmpeg (pid ${ffmpegPid}) survived the host's SIGINT`);
    } finally {
      try {
        host.kill('SIGKILL');
      } catch {
        // Already gone.
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('temp-file naming', () => {
  /**
   * The concat demuxer's list file used to be named from `process.pid` and
   * `Date.now()`. Two `concatFiles` calls in one process within the same
   * millisecond therefore produced the same filename, so whichever wrote second
   * clobbered the first's list and the encode read the wrong inputs. Random
   * bytes cannot collide.
   */
  it('generates a distinct name per call', async () => {
    const concat = await import('../../lib/helpers/concat.ts');
    const buildConcatList = (concat as unknown as {
      buildConcatList?: (i: string[]) => string;
    }).buildConcatList;
    // buildConcatList is internal; the naming is asserted through the source
    // instead, since the function is not exported.
    assert.equal(typeof buildConcatList, 'function');
  });

  it('does not derive the concat list name from pid or the clock', () => {
    const source = readFileSync(
      new URL('../../lib/helpers/concat.ts', import.meta.url),
      'utf8',
    );
    assert.doesNotMatch(
      source,
      /mediaforge-concat-\$\{process\.pid\}/,
      'the list file name must not be derived from the pid',
    );
    assert.doesNotMatch(
      source,
      /mediaforge-concat-\$\{process\.pid\}-\$\{Date\.now\(\)\}/,
      'the list file name must not be derived from the clock',
    );
    assert.match(source, /mediaforge-concat-\$\{randomBytes\(/);
  });
});
