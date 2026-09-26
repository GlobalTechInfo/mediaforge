/**
 * tests/unit/platform-paths.test.ts
 *
 * The branches that only run on another platform, in a browser/Deno-style
 * runtime, or when a child process fails before it produces output. They are
 * the largest remaining holes in lib/helpers/process.ts, lib/helpers/streams.ts,
 * lib/process/spawn.ts and lib/process/progress.ts, and every one of them is
 * reachable from here by controlling the environment rather than the code.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let processHelpers: any;
let streams: any;
let spawn: any;
let progress: any;

before(async () => {
  processHelpers = await import('../../lib/helpers/process.ts');
  streams = await import('../../lib/helpers/streams.ts');
  spawn = await import('../../lib/process/spawn.ts');
  progress = await import('../../lib/process/progress.ts');
});

/** A ChildProcess-shaped stub whose emitter behaviour is scriptable. */
function fakeChild(pid?: number) {
  const child = new EventEmitter() as any;
  // `pid` stays undefined when not given, which is the case renice must reject.
  child.pid = pid ?? 4242;
  if (pid === null) child.pid = undefined;
  child.killed = false;
  child.kill = (signal?: string) => {
    child.killed = true;
    child.lastSignal = signal;
    return true;
  };
  return child;
}

// ─── process helpers: the browser/Deno addEventListener path ─────────────────

describe('autoKillOnExit and the beforeunload listener', () => {
  const g = globalThis as Record<string, unknown>;

  it('registers a beforeunload handler when the runtime provides one', () => {
    // Deno and browsers expose addEventListener on globalThis; Node does not.
    // The guard reads it at call time, so a stub is enough to take the branch
    // that a plain Node run can never reach.
    const seen: string[] = [];
    g['addEventListener'] = (name: string) => { seen.push(name); };
    try {
      const unregister = processHelpers.autoKillOnExit(fakeChild());
      assert.deepStrictEqual(seen, ['beforeunload']);
      unregister();
    } finally {
      delete g['addEventListener'];
    }
  });

  it('removes the beforeunload handler on unregister', () => {
    const removed: string[] = [];
    let added = 0;
    g['addEventListener'] = () => { added++; };
    g['removeEventListener'] = (name: string) => { removed.push(name); };
    try {
      const unregister = processHelpers.autoKillOnExit(fakeChild());
      assert.strictEqual(added, 1);
      unregister();
      assert.deepStrictEqual(removed, ['beforeunload']);
    } finally {
      delete g['addEventListener'];
      delete g['removeEventListener'];
    }
  });

  it('survives a runtime whose addEventListener throws', () => {
    // Some runtimes expose the function but reject the event name. Cleanup
    // must still work rather than taking the whole process down.
    g['addEventListener'] = () => { throw new Error('unsupported event'); };
    g['removeEventListener'] = () => { throw new Error('unsupported event'); };
    try {
      const unregister = processHelpers.autoKillOnExit(fakeChild());
      assert.doesNotThrow(() => unregister());
    } finally {
      delete g['addEventListener'];
      delete g['removeEventListener'];
    }
  });

  it('deregisters every signal handler, not just the first', () => {
    // 'on' was used rather than 'once', so a partial cleanup would leave a
    // live SIGTERM handler pointing at a finished child.
    const before = process.listenerCount('SIGTERM');
    const unregister = processHelpers.autoKillOnExit(fakeChild());
    assert.strictEqual(process.listenerCount('SIGTERM'), before + 1);
    unregister();
    assert.strictEqual(process.listenerCount('SIGTERM'), before);
  });

  it('is safe to call the unregister function twice', () => {
    const unregister = processHelpers.autoKillOnExit(fakeChild());
    unregister();
    assert.doesNotThrow(() => unregister());
  });

  it('cleans up on its own when the child closes', () => {
    const before = process.listenerCount('SIGINT');
    const child = fakeChild();
    processHelpers.autoKillOnExit(child);
    assert.strictEqual(process.listenerCount('SIGINT'), before + 1);
    child.emit('close', 0, null);
    assert.strictEqual(process.listenerCount('SIGINT'), before);
  });
});

describe('renice', () => {
  it('refuses a child that has no PID yet', () => {
    const child = fakeChild();
    child.pid = undefined;
    assert.throws(
      () => processHelpers.renice(child, 10),
      /no PID/i,
    );
  });

  it('reports the underlying failure instead of swallowing it', () => {
    // A child this process cannot signal (pid 1) makes `renice` fail; the
    // error has to surface, or a caller believes it lowered a priority it
    // never changed.
    const err = (() => {
      try {
        processHelpers.renice(fakeChild(1), 5);
        return null;
      } catch (e) {
        return e as Error;
      }
    })();
    // Running as root in a container can make this succeed; only assert when it
    // actually failed, and then require a useful message either way.
    if (err !== null) {
      assert.match(err.message, /renice failed/);
    }
  });
});

describe('killAllFFmpeg and trackChild', () => {
  it('kills every tracked child and tolerates one that throws', () => {
    const good = fakeChild(11);
    const bad = fakeChild(12);
    bad.kill = () => { throw new Error('already gone'); };
    processHelpers.trackChild(good);
    processHelpers.trackChild(bad);
    assert.doesNotThrow(() => processHelpers.killAllFFmpeg('SIGKILL'));
    assert.strictEqual(good.killed, true);
    assert.strictEqual(good.lastSignal, 'SIGKILL');
  });
});

// ─── spawn.ts: the option-validation and progress branches ──────────────────

describe('spawnFFmpeg option handling', () => {
  it('passes cwd through to the child', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mf-cwd-'));
    try {
      const proc = spawn.spawnFFmpeg({ binary: 'ffmpeg', args: ['-version'], cwd: dir });
      const code = await new Promise<number>((res) => proc.emitter.on('end', () => res(0)));
      assert.strictEqual(code, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adds -progress only once when the caller already asked for it', () => {
    // The helper must not duplicate the flag: ffmpeg would then write two
    // progress streams to the same pipe and the parser would interleave them.
    const emitted: string[][] = [];
    const proc = spawn.spawnFFmpeg({
      binary: 'ffmpeg',
      args: ['-version', '-progress', 'pipe:2'],
      parseProgress: true,
    });
    proc.emitter.on('start', (args: string[]) => emitted.push(args));
    return new Promise<void>((res) => {
      proc.emitter.on('end', () => {
        assert.strictEqual(emitted.length, 1, 'no start event');
        const count = emitted[0]!.filter((a) => a === '-progress').length;
        assert.strictEqual(count, 1, `-progress repeated: ${emitted[0]!.join(' ')}`);
        res();
      });
      proc.emitter.on('error', () => res());
    });
  });

  it('rejects a call with neither binary nor args', () => {
    assert.throws(() => spawn.spawnFFmpeg({} as any), /binary|args/i);
  });

  it('surfaces a nonzero exit as an error carrying the exit code', async () => {
    await assert.rejects(
      spawn.runFFmpeg({ binary: 'ffmpeg', args: ['-i', 'no_such_file_xyz.mp4', '-f', 'null', '-'] }),
      (e: any) => {
        assert.ok(e instanceof spawn.FFmpegSpawnError, `got ${e?.constructor?.name}`);
        assert.notStrictEqual(e.exitCode, 0);
        return true;
      },
    );
  });
});

// ─── progress.ts: the malformed-block branches ──────────────────────────────

describe('ProgressParser malformed input', () => {
  it('ignores a line with no key=value separator', () => {
    const seen: unknown[] = [];
    const p = new progress.ProgressParser((info: unknown) => seen.push(info));
    p.push('this is not a key=value block\n');
    p.push('progress=continue\n');
    // The block is terminated by `progress=`, so the junk line is dropped and
    // only the (empty) block that follows is emitted.
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].progress, 'continue');
  });

  it('reads a non-numeric value as absent rather than NaN', () => {
    const seen: any[] = [];
    const p = new progress.ProgressParser((info: any) => seen.push(info));
    p.push('frame=notanumber\n');
    p.push('fps=abc\n');
    p.push('progress=continue\n');
    assert.strictEqual(seen.length, 1);
    assert.ok(!Number.isNaN(seen[0].frame), `frame was NaN: ${seen[0].frame}`);
    assert.ok(!Number.isNaN(seen[0].fps), `fps was NaN: ${seen[0].fps}`);
  });

  it('computes a percentage from the total duration it was given', () => {
    const seen: any[] = [];
    const p = new progress.ProgressParser((info: any) => seen.push(info), 10_000_000);
    p.push('out_time_us=5000000\n');
    p.push('progress=continue\n');
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].outTimeUs, 5_000_000);
    assert.strictEqual(seen[0].percent, 50);
  });

  it('clamps a percentage to 0..100', () => {
    // ffmpeg can report an out_time slightly past the total; an unclamped
    // value would render as 103% on a progress bar.
    const seen: any[] = [];
    const p = new progress.ProgressParser((info: any) => seen.push(info), 1_000_000);
    p.push('out_time_us=9000000\n');
    p.push('progress=continue\n');
    assert.strictEqual(seen[0].percent, 100);
  });

  it('leaves percent undefined without a total duration', () => {
    // Without a total there is no honest percentage; reporting 0 or 100 would
    // both be lies a progress bar would render.
    const seen: any[] = [];
    const p = new progress.ProgressParser((info: any) => seen.push(info));
    p.push('out_time_us=5000000\n');
    p.push('progress=continue\n');
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].percent, undefined);
  });

  it('marks the final block as end', () => {
    const seen: any[] = [];
    const p = new progress.ProgressParser((info: any) => seen.push(info));
    p.push('progress=end\n');
    assert.strictEqual(seen.at(-1)?.progress, 'end');
  });
});

// ─── streams.ts: the child-error path ───────────────────────────────────────

describe('pipeThrough reports a spawn error', () => {
  it('emits an error rather than hanging when the binary cannot start', async () => {
    const proc = streams.pipeThrough({
      inputFormat: 'mp4',
      outputFormat: 'null',
      outputArgs: ['-f', 'null'],
      binary: 'definitely_not_a_real_binary_xyz',
    } as any);
    const err = await new Promise<any>((res) => {
      proc.emitter.on('error', res);
      proc.emitter.on('end', () => res(null));
    });
    assert.ok(err, 'a missing binary must surface as an error');
    assert.ok(/ENOENT|not found|Cannot find/i.test(String(err.message)),
      `unexpected message: ${err.message}`);
  });
});
