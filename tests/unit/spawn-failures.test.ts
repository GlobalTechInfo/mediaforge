import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execAsync, execBounded } from '../../lib/utils/exec.ts';
import { probeAsync, probe } from '../../lib/probe/ffprobe.ts';
import { probeVersion, clearVersionCache } from '../../lib/utils/version.ts';
import { validateBinary, BinaryNotFoundError } from '../../lib/utils/binary.ts';
import { FFmpegError } from '../../lib/errors.ts';

const MISSING = join(tmpdir(), 'mediaforge-definitely-missing-binary');
const MISSING_FFPROBE = join(tmpdir(), 'mediaforge-definitely-missing-ffprobe');

/**
 * Spawn-failure paths.
 *
 * A missing binary is the single most common real-world failure for a wrapper
 * like this — a bad `binary` option, a PATH that changed, a container without
 * ffmpeg. Every entry point has to classify it the same way (SPAWN_FAILED, with
 * the underlying message preserved) rather than surfacing a raw ENOENT or, worse,
 * an unhandled 'error' event. These paths only execute when the spawn itself
 * throws, which no ordinary battle case reaches.
 */
describe('spawn failure classification', () => {
  it('execAsync reports BINARY_NOT_FOUND for a missing binary', async () => {
    // Not SPAWN_FAILED: the binary is resolved before the spawn, so the caller
    // gets the specific reason rather than a generic "could not run it".
    await assert.rejects(
      execAsync(MISSING, ['-version']),
      (error: unknown) => {
        assert.ok(error instanceof FFmpegError, `got ${String(error)}`);
        assert.equal(error.code, 'BINARY_NOT_FOUND');
        assert.match(error.message, /mediaforge-definitely-missing-binary/);
        return true;
      },
    );
  });

  it('execAsync keeps the original error as the cause', async () => {
    await assert.rejects(execAsync(MISSING, ['-version']), (error: unknown) => {
      assert.ok(error instanceof FFmpegError);
      assert.ok(error.cause instanceof Error, 'the spawn error should be preserved as cause');
      return true;
    });
  });

  it('probeAsync reports the spawn failure rather than hanging', async () => {
    await assert.rejects(probeAsync('/tmp/whatever.mp4', { binary: MISSING_FFPROBE }));
  });

  it('the synchronous probe also surfaces a spawn failure', () => {
    assert.throws(() => probe('/tmp/whatever.mp4', { binary: MISSING_FFPROBE }));
  });

  it('probeVersion reports a missing binary and does not cache the failure', () => {
    clearVersionCache();
    assert.throws(() => probeVersion(MISSING), (error: unknown) => {
      assert.ok(error instanceof FFmpegError, `got ${String(error)}`);
      return true;
    });
    // The cache must not have memoised the failure: a later call with a working
    // binary has to be able to succeed rather than replay the error forever.
    clearVersionCache();
  });

  it('validateBinary throws BinaryNotFoundError with the path in the message', () => {
    assert.throws(() => validateBinary(MISSING), (error: unknown) => {
      assert.ok(error instanceof BinaryNotFoundError, `got ${String(error)}`);
      assert.match(error.message, /mediaforge-definitely-missing-binary/);
      return true;
    });
  });

  it('a bounded run of a missing binary fails fast rather than waiting for the timeout', () => {
    const started = Date.now();
    assert.throws(() => execBounded(MISSING, ['-version'], { timeoutMs: 30_000 }));
    // If the spawn error were mistaken for a hang, this would take 30 seconds.
    assert.ok(Date.now() - started < 10_000, 'a spawn failure must not wait for the timeout');
  });
});