/**
 * Atomic output.
 *
 * A cancelled, timed-out or failed encode still creates the file ffmpeg was
 * writing to, because ffmpeg opens its output before it discovers the input is
 * unusable. The result is a truncated `.mp4` that no player will open, or an
 * HLS directory with orphaned segments — and because the file exists and is
 * non-empty, nothing downstream can tell it apart from a good one.
 *
 * The fix is to write to a temporary name and rename into place only after
 * ffmpeg exits 0.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, unlinkSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { FFmpegAtomicOutputError } from '../errors.ts';

/**
 * Targets ffmpeg writes as more than one file, or writes into a directory.
 *
 * Renaming cannot make these atomic: a playlist and its segments are several
 * files, and a `frame_%03d.png` sequence has no single path to rename. Such a
 * target is refused rather than silently written non-atomically, because a
 * caller that asked for atomicity and did not get it is worse off than one that
 * was told up front.
 */
const MULTI_FILE_EXTENSIONS = new Set(['.m3u8', '.mpd', '.ism', '.ismv', '.f4m']);

/**
 * ffmpeg's own image/segment sequence patterns, e.g. `frame_%03d.png`.
 *
 * The digit run must be a *single* quantifier. An earlier version used
 * `/%\d*[0-9]*[ds]/`, where two adjacent unbounded quantifiers cover the same
 * character class and so admit exponentially many ways to split the run — the
 * classic polynomial-backtracking shape. On `%` followed by 32k zeros it took
 * 2.4s versus 0.1ms here, which is a denial of service for anyone who can
 * influence an output path. `%` + one greedy `[0-9]*` + a literal is linear.
 */
const SEQUENCE_PATTERN = /%\d*[ds]/;

export interface AtomicOutputOptions {
  /**
   * Create the output's parent directory if it is missing.
   *
   * A rename cannot cross a filesystem boundary, so the temp file is always
   * created in the same directory as the target — which means that directory
   * has to exist before the encode starts. That is the usual cause of a
   * successful ffmpeg run failing at the rename step, so this is on by default.
   */
  mkdir?: boolean;
  /** Keep the temp file when the callback throws. Intended for debugging. */
  keepTempOnError?: boolean;
}

/**
 * Split a path into its stem and final extension.
 *
 * The extension is preserved on the temp path on purpose: ffmpeg infers the
 * container from it, so writing to `out.mp4.tmp` would select the wrong muxer
 * (or none) and fail, and it would fail *after* the encode rather than before.
 *
 * Uses `path.basename`/`path.extname` rather than splitting on `/` by hand.
 * A hand-rolled split finds no separator in `C:\out\video.mp4`, so `stem` came
 * back as the whole path and the temp file was built from it — which is not a
 * valid filename, making every atomic write fail on Windows.
 */
export function splitExtension(path: string): { stem: string; ext: string } {
  const base = basename(path);
  const ext = extname(base); // '' for `.hidden`, which is a name, not an extension
  return { stem: ext === '' ? base : base.slice(0, -ext.length), ext };
}

/** Does this target produce more than one file? */
export function isMultiFileTarget(path: string): boolean {
  if (SEQUENCE_PATTERN.test(path)) return true;
  const { ext } = splitExtension(path);
  return MULTI_FILE_EXTENSIONS.has(ext.toLowerCase());
}

/** True when an error is the atomic-output refusal. */
export function isAtomicOutputRefused(error: unknown): boolean {
  return error instanceof FFmpegAtomicOutputError;
}

/**
 * Move `from` onto `to`, working around Windows rename semantics.
 *
 * POSIX `rename(2)` replaces an existing destination atomically. Windows does
 * not: `renameSync` fails with `EPERM` (or `EEXIST`) when the target is already
 * there, which it usually is on a re-encode. Unlink the target and retry, so an
 * atomic write is still possible on a supported platform.
 *
 * The window between the unlink and the rename is why this is only ever used to
 * publish a completed file over a previous one — never to move something the
 * caller still needs.
 */
function publish(from: string, to: string): void {
  try {
    renameSync(from, to);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EEXIST' && code !== 'ENOTEMPTY') throw error;
    try {
      unlinkSync(to);
    } catch {
      // Already gone, or not removable — let the retry surface the real problem.
    }
    renameSync(from, to);
  }
}

/**
 * Run `fn` against a temporary path and publish the result only on success.
 *
 * @param target Final path the caller wants.
 * @param fn     Receives the temp path to write to. Its return value is passed
 *               through unchanged.
 * @throws {FFmpegAtomicOutputError} when `target` cannot be written atomically.
 */
export async function withAtomicOutput<T>(
  target: string,
  fn: (tempPath: string) => Promise<T> | T,
  options: AtomicOutputOptions = {},
): Promise<T> {
  if (isMultiFileTarget(target)) {
    throw new FFmpegAtomicOutputError(
      `Atomic output is not possible for "${target}": ffmpeg writes this target as ` +
        'multiple files (a playlist and its segments, or a numbered sequence), so ' +
        'there is no single path to rename into place. Write to a directory or a ' +
        'single file, or omit atomicity for this job.',
    );
  }

  const { mkdir = true, keepTempOnError = false } = options;
  const dir = dirname(target);
  if (mkdir) {
    mkdirSync(dir, { recursive: true });
  } else if (!existsSync(dir)) {
    throw new FFmpegAtomicOutputError(
      `Cannot write atomically to "${target}": the directory ${dir} does not exist.`,
    );
  }

  // Same directory as the target, so the rename stays within one filesystem
  // and is therefore atomic. The extension is preserved for muxer inference.
  const { stem, ext } = splitExtension(target);
  const tempPath = join(dir, `.${stem}.mediaforge-${randomBytes(6).toString('hex')}${ext}`);

  try {
    const result = await fn(tempPath);
    publish(tempPath, target);
    return result;
  } catch (error) {
    // Best effort: a failure to remove the temp file must not mask the real
    // error the caller needs to see.
    if (!keepTempOnError) {
      try {
        rmSync(tempPath, { force: true });
      } catch {
        // Already gone, or the directory vanished with it.
      }
    }
    throw error;
  }
}
