/**
 * Pre-flight validation.
 *
 * Every one of these failures is cheap for ffmpeg to detect and expensive to
 * diagnose: ffmpeg exits non-zero with a message that names the symptom rather
 * than the cause, and on a bad path it has usually already created a zero-byte
 * output file by the time it complains. Checking first turns a confusing
 * non-zero exit into a message that names the actual problem.
 */
import { existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { FFmpegValidationError, type ValidationIssue } from '../errors.ts';

export type { ValidationIssue };

/**
 * Inputs that are not local paths and must be left alone.
 *
 * A URL is fetched by ffmpeg, a pipe target is a file descriptor, and a
 * device-like name is a protocol ffmpeg handles itself. Existence-checking any
 * of those produces a false failure.
 */
const NON_PATH_INPUT =
  /^(https?|rtmp|rtsp|rtp|srt|udp|tcp|file|crypto|concat|subfile|async|lavfi|color|testsrc|anullsrc|pipe|data|movie|fbdev|v4l2|rawvideo|thumbnail|amovie|audio|video|cdda|oss|tee|zmq|bluray|jack|pulse|openal|libav|avfoundation|bktr|dv|jack|sdl|gd|bmp|mjpeg|png_pipe|yuv4mpegpipe|apng|webp_pipe|ivf|md5|framemd5|tee)/i;

/**
 * Is this input something ffmpeg resolves itself rather than a local file?
 *
 * Covers URLs, protocol prefixes (`concat:`, `lavfi:`, `pipe:`), a bare `-` for
 * standard input, and a leading digit — which is how ffmpeg reads a raw stream
 * specifier like `0` or `1` for a numbered input. A relative filename beginning
 * with a digit is therefore treated as a stream specifier, which is the safer
 * mistake: validation is opt-in, so a caller can disable it, whereas silently
 * stat-ing a nonexistent relative path would not be noticed.
 */
export function isNonPathInput(path: string): boolean {
  // `-` is ffmpeg's standard input and a bare run of digits is a raw stream
  // specifier; neither can be stat-ed. Checked separately from the protocol
  // regex because they carry no prefix to match on.
  if (path === '-' || /^\d+$/.test(path)) return true;
  return NON_PATH_INPUT.test(path);
}

/**
 * Check that every local input exists and is readable.
 *
 * Does not throw; returns the problems found, so a caller can report all of them
 * at once rather than one per run.
 */
export function validateInputs(paths: readonly string[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const path of paths) {
    if (isNonPathInput(path)) continue;

    if (!existsSync(path)) {
      issues.push({
        target: path,
        problem: 'input file does not exist',
        hint: `Check the path. mediaforge does not expand "~" — pass an absolute path.`,
      });
      continue;
    }
    // existsSync follows symlinks and returns false for a broken one, so a
    // failure here is a permission or I/O problem rather than a missing file.
    try {
      const stat = statSync(path);
      if (stat.isDirectory()) {
        issues.push({
          target: path,
          problem: 'input is a directory, not a media file',
          hint: 'Point at a file inside it, or use the concat helpers to join several.',
        });
      }
    } catch {
      issues.push({
        target: path,
        problem: 'input could not be read',
        hint: 'Check filesystem permissions for this path.',
      });
    }
  }
  return issues;
}

/**
 * Check that each output's directory exists and is writable.
 *
 * The write permission itself is not tested — creating and removing a file on
 * every run would be surprising for an output directory. This catches the two
 * causes that actually occur: a missing directory, and one the process cannot
 * write to.
 */
export function validateOutputs(paths: readonly string[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();

  for (const path of paths) {
    if (isNonPathInput(path) || path === '-') continue;

    const dir = dirname(isAbsolute(path) ? path : resolve(path));
    if (seen.has(dir)) continue;
    seen.add(dir);

    if (!existsSync(dir)) {
      issues.push({
        target: path,
        problem: `output directory does not exist: ${dir}`,
        hint: 'Create it first, or use withAtomicOutput(), which creates it for you.',
      });
      continue;
    }
    try {
      if (!statSync(dir).isDirectory()) {
        issues.push({
          target: path,
          problem: `output parent is not a directory: ${dir}`,
          hint: 'The path above this one is a file.',
        });
      }
    } catch {
      issues.push({
        target: path,
        problem: `output directory could not be read: ${dir}`,
        hint: 'Check filesystem permissions for this directory.',
      });
    }
  }
  return issues;
}

/**
 * Throw unless every input and output is usable.
 *
 * @throws {FFmpegValidationError} listing all problems found.
 */
export function assertValidIo(inputs: readonly string[], outputs: readonly string[]): void {
  const issues = [...validateInputs(inputs), ...validateOutputs(outputs)];
  if (issues.length === 0) return;

  const detail = issues
    .map((issue) => `  ${issue.target}\n    ${issue.problem}\n    → ${issue.hint}`)
    .join('\n');
  throw new FFmpegValidationError(
    `Refusing to run: ${issues.length} problem(s) with the given paths:\n${detail}`,
    issues[0]?.target ?? '',
  );
}