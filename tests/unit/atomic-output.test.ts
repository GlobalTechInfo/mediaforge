/**
 * Atomic output writes.
 *
 * An encode that fails, times out or is cancelled part-way through leaves a
 * truncated file at the output path. For a `.mp4` that means a file no player
 * will open; for an HLS directory it means orphaned segments and a playlist
 * referencing them. Downstream jobs and cleanup scripts cannot tell that file
 * apart from a good one, because it exists and is non-empty.
 *
 * `withAtomicOutput` writes to a temporary name in the *same directory* and
 * renames it into place only after ffmpeg exits 0, so the output path either
 * holds the finished file or does not exist at all.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { ffmpeg } from '../../lib/FFmpeg.ts';
import { probeAsync } from '../../lib/probe/ffprobe.ts';
import { FFmpegAtomicOutputError } from '../../lib/errors.ts';
import {
  isAtomicOutputRefused,
  isMultiFileTarget,
  splitExtension,
  withAtomicOutput,
} from '../../lib/utils/atomic.ts';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'mediaforge-atomic-'));
}

describe('extension handling', () => {
  it('splits the final extension so the muxer stays inferable', () => {
    assert.deepEqual(splitExtension('out.mp4'), { stem: 'out', ext: '.mp4' });
    assert.deepEqual(splitExtension('archive.tar.gz'), { stem: 'archive.tar', ext: '.gz' });
    assert.deepEqual(splitExtension('noext'), { stem: 'noext', ext: '' });
    assert.deepEqual(splitExtension('.hidden'), { stem: '.hidden', ext: '' });
  });

  it('delegates to node:path, so it follows the host separator', () => {
    // Regression guard. The previous implementation split on '/' by hand, which
    // found no separator at all in `C:\out\video.mp4` and returned the whole
    // path as `stem` — so the temp name it built was not a valid filename and
    // every atomic write failed on Windows. node:path uses the *host's*
    // separator, which is the correct behaviour: on Linux a backslash is a
    // legal filename character, so it must not be treated as a separator.
    assert.deepEqual(splitExtension('/home/u/out.mp4'), { stem: 'out', ext: '.mp4' });
    assert.deepEqual(splitExtension('./rel/out.mp4'), { stem: 'out', ext: '.mp4' });
    assert.deepEqual(splitExtension('/home/u/a.b/out'), { stem: 'out', ext: '' });

    // Matches node:path exactly, whatever the host separator is.
    for (const p of ['out.mp4', 'a.b.c.ts', 'noext', '.hidden', '/x/y/out.mp4']) {
      assert.deepEqual(
        splitExtension(p),
        { stem: basename(p, extname(p)) || p, ext: extname(p) },
        p,
      );
    }
  });

  it('recognises multi-file targets that cannot be renamed into place', () => {
    assert.equal(isMultiFileTarget('out.mp4'), false);
    assert.equal(isMultiFileTarget('stream.m3u8'), true);
    assert.equal(isMultiFileTarget('stream.mpd'), true);
    assert.equal(isMultiFileTarget('frames%03d.png'), true);
    assert.equal(isMultiFileTarget('seg_%05d.ts'), true);
    assert.equal(isMultiFileTarget('out%d.wav'), true);
    assert.equal(isMultiFileTarget('noext'), false);
  });

  it('matches the ffmpeg sequence syntax anywhere in a path', () => {
    // Conservative by design: ffmpeg's image2 muxer expands `%d` wherever it
    // appears, so `100%done.mp4` really would be treated as a sequence by ffmpeg
    // too. Refusing it is the safe direction, and the caller gets an error that
    // says why rather than a non-atomic write they did not ask for.
    assert.equal(isMultiFileTarget('100%done.mp4'), true);
    assert.equal(isMultiFileTarget('v%v/playlist.m3u8'), true, 'also caught by the .m3u8 extension');
  });

  it('has no polynomial backtracking on adversarial input', () => {
    // Regression guard for a ReDoS: the pattern used to be /%\d*[0-9]*[ds]/,
    // where two adjacent unbounded quantifiers cover the same character class.
    // That is the classic polynomial shape and cost 2.4s on 32k zeros, which is
    // a denial of service for anyone who can influence an output path.
    const adversarial = `%${'0'.repeat(60_000)}`;
    const startedAt = Date.now();
    isMultiFileTarget(adversarial);
    const elapsed = Date.now() - startedAt;
    assert.ok(
      elapsed < 1000,
      `isMultiFileTarget took ${elapsed}ms on a ${adversarial.length}-char adversarial ` +
        'path; the sequence pattern must be linear',
    );
  });
});

describe('withAtomicOutput', () => {
  it('renames the temp file into place on success', async () => {
    const dir = scratch();
    try {
      const target = join(dir, 'out.txt');
      const result = await withAtomicOutput(target, async (temp) => {
        writeFileSync(temp, 'final contents');
        return 'done';
      });

      assert.equal(result, 'done');
      assert.equal(readFileSync(target, 'utf8'), 'final contents');
      // Nothing but the target should remain.
      assert.deepEqual(readdirSync(dir), ['out.txt']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves no partial file when the callback throws', async () => {
    const dir = scratch();
    try {
      const target = join(dir, 'out.txt');
      await assert.rejects(
        withAtomicOutput(target, async (temp) => {
          writeFileSync(temp, 'half written');
          throw new Error('encode failed');
        }),
        /encode failed/,
      );

      assert.equal(existsSync(target), false, 'a failed run must not leave an output file');
      assert.deepEqual(readdirSync(dir), [], 'the temp file must be cleaned up');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves the extension so ffmpeg picks the right muxer', async () => {
    const dir = scratch();
    try {
      const target = join(dir, 'out.mkv');
      await withAtomicOutput(target, async (temp) => {
        assert.ok(temp.endsWith('.mkv'), `temp path lost the extension: ${temp}`);
        writeFileSync(temp, 'x');
      });
      assert.equal(existsSync(target), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates the parent directory when asked', async () => {
    const dir = scratch();
    try {
      const target = join(dir, 'nested', 'deep', 'out.txt');
      await withAtomicOutput(target, async (temp) => {
        writeFileSync(temp, 'x');
      }, { mkdir: true });
      assert.equal(readFileSync(target, 'utf8'), 'x');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves the original untouched when the run fails', async () => {
    const dir = scratch();
    try {
      const target = join(dir, 'out.txt');
      writeFileSync(target, 'original');
      await assert.rejects(
        withAtomicOutput(target, async () => {
          throw new Error('boom');
        }),
      );
      assert.equal(readFileSync(target, 'utf8'), 'original');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a multi-file target rather than silently doing the wrong thing', async () => {
    const dir = scratch();
    try {
      await assert.rejects(
        withAtomicOutput(join(dir, 'playlist.m3u8'), async () => undefined),
        (error: unknown) =>
          error instanceof FFmpegAtomicOutputError && isAtomicOutputRefused(error),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * A lavfi input needs `-f lavfi` *before* the `-i`, which the builder's
 * `input()` cannot express positionally. Driving the argv directly keeps these
 * tests focused on atomicity rather than on builder plumbing.
 */
async function encodeTo(path: string, durationSeconds = 0.4): Promise<void> {
  await ffmpeg()
    .output(path)
    .addGlobalOption('-f', 'lavfi', '-i', `testsrc=duration=${durationSeconds}:size=64x64:rate=10`)
    .videoCodec('libx264')
    .preset('ultrafast')
    .run();
}

/** ffmpeg exits non-zero, so the callback rejects and nothing is published. */
async function failingEncodeTo(path: string): Promise<void> {
  await ffmpeg()
    .input(join(path, 'no-such-input.mp4'))
    .output(path)
    .run();
}

describe('with a real encode', () => {
  it('publishes a complete file on success', async () => {
    const dir = scratch();
    try {
      const target = join(dir, 'out.mkv');
      await withAtomicOutput(target, async (temp) => {
        await encodeTo(temp);
      });

      assert.equal(existsSync(target), true);
      // A truncated container has no index; ffprobe reading it back is the real
      // proof that the published file is usable rather than merely present.
      const probed = await probeAsync(target);
      assert.equal(probed.streams.length, 1);
      assert.equal(probed.streams[0]?.codec_name, 'h264');
      assert.deepEqual(readdirSync(dir), ['out.mkv'], 'no temp file may remain');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('publishes nothing when ffmpeg fails, even though ffmpeg created the file', async () => {
    const dir = scratch();
    try {
      const target = join(dir, 'broken.mkv');
      await assert.rejects(
        withAtomicOutput(target, async (temp) => {
          await failingEncodeTo(temp);
        }),
      );

      assert.equal(existsSync(target), false, 'a failed run must not publish an output');
      assert.deepEqual(
        readdirSync(dir),
        [],
        'ffmpeg leaves a truncated file behind; withAtomicOutput must remove it',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('cleans up when the run is cancelled', async () => {
    const dir = scratch();
    try {
      const target = join(dir, 'cancelled.mkv');
      const controller = new AbortController();

      await assert.rejects(
        withAtomicOutput(target, async (temp) => {
          setTimeout(() => controller.abort(new Error('user cancelled')), 150);
          await ffmpeg()
            .output(temp)
            .addGlobalOption('-f', 'lavfi', '-i', 'testsrc=duration=30:size=64x64:rate=10')
            .addGlobalOption('-re')
            .videoCodec('libx264')
            .preset('ultrafast')
            .run({ signal: controller.signal });
        }),
      );

      assert.equal(existsSync(target), false);
      assert.deepEqual(readdirSync(dir), [], 'a cancelled run must not leave a partial file');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});