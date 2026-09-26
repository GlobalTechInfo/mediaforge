import { spawn } from 'node:child_process';
import { createWriteStream, mkdtempSync, rmSync } from 'node:fs';
import type { Readable, Writable } from 'node:stream';
import { PassThrough } from 'node:stream';
import { FFmpegEmitter } from '../process/events.ts';
import { ProgressParser } from '../process/progress.ts';
import { FFmpegSpawnError } from '../process/spawn.ts';
import { resolveBinary } from '../utils/binary.ts';
import { trackChild } from './process.ts';
import * as os from 'node:os';
import * as path from 'node:path';
import { captureStderr } from '../utils/stderr.ts';

export interface PipeOptions {
  /** Input readable stream (replaces file input) */
  inputStream?: Readable;
  /** Force input format when piping (e.g. 'mp4', 'flv', 'ogg') */
  inputFormat?: string;
  /** Output args (codec, filters, etc.) */
  outputArgs?: string[];
  /** Force output format when piping (e.g. 'mp4', 'ogg', 'flv') */
  outputFormat?: string;
  /** If true, emit progress events */
  parseProgress?: boolean;
  /** ffmpeg binary override */
  binary?: string;
}

export interface PipeProcess {
  /** Typed event emitter */
  readonly emitter: FFmpegEmitter;
  /** Writable stream — pipe your input here if not using inputStream */
  readonly stdin: Writable | null;
  /** Readable stream — pipe this to your destination */
  readonly stdout: Readable;
  /** Kill the process */
  kill(signal?: NodeJS.Signals): void;
}

/**
 * Pipe data through ffmpeg — input from a stream, output to a stream.
 *
 * @example
 * // Transcode a readable stream to a writable stream
 * const proc = pipeThrough({
 *   inputFormat: 'mp4',
 *   outputArgs: ['-c:v', 'libx264', '-c:a', 'aac'],
 *   outputFormat: 'mp4',
 * });
 * fsReadStream.pipe(proc.stdin!);
 * proc.stdout.pipe(fsWriteStream);
 * await new Promise((res, rej) => {
 *   proc.emitter.on('end', res);
 *   proc.emitter.on('error', rej);
 * });
 *
 * @example
 * // Pass a readable stream directly
 * const proc = pipeThrough({ inputStream: myReadable, outputFormat: 'ogg' });
 * proc.stdout.pipe(response); // stream to HTTP response
 */
export function pipeThrough(opts: PipeOptions): PipeProcess {
  const {
    inputStream,
    inputFormat,
    outputFormat,
    parseProgress = false,
    binary = resolveBinary(),
  } = opts;

  let { outputArgs = [] } = opts;

  // MP4/MOV written to a pipe cannot seek back to write the moov atom.
  // Automatically inject fragmented-MP4 flags so the output is streamable.
  // Only injected when the user has not already supplied -movflags themselves.
  const pipedContainerNeedsFragmentation =
    outputFormat === 'mp4' || outputFormat === 'mov';
  const userAlreadySetMovflags = outputArgs.some((a, i) => a === '-movflags' && i + 1 < outputArgs.length);
  if (pipedContainerNeedsFragmentation && !userAlreadySetMovflags) {
    outputArgs = [...outputArgs, '-movflags', 'frag_keyframe+empty_moov+default_base_moof'];
  }

  const args: string[] = ['-y'];

  // MP4/MOV piped as INPUT: the moov atom is normally at the end of the file,
  // so FFmpeg cannot find codec parameters when reading from a non-seekable pipe.
  // Increase analyzeduration and probesize so FFmpeg buffers enough data to
  // detect stream parameters before giving up with "unspecified pixel format".
  const pipedInputNeedsProbe =
    inputFormat === 'mp4' || inputFormat === 'mov' || inputFormat === 'm4v';
  if (pipedInputNeedsProbe) {
    // Large probe window + genpts for recovery when moov atom is at end of file
    args.push('-analyzeduration', '100M', '-probesize', '100M');
    args.push('-fflags', '+genpts');
  }

  if (inputFormat) args.push('-f', inputFormat);
  args.push('-i', 'pipe:0');

  args.push(...outputArgs);

  if (outputFormat) args.push('-f', outputFormat);
  args.push('pipe:1');

  const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  trackChild(child);
  const emitter = new FFmpegEmitter();

  const progressParser = parseProgress
    ? new ProgressParser(info => emitter.emit('progress', info))
    : null;

  // Defer so the caller can attach listeners before 'start' fires.
  queueMicrotask(() => emitter.emit('start', args));

  let closeStderr: (() => void) | undefined;
  let capturedRef: { stderrLines: string[]; close: () => void } | undefined;
  if (child.stderr) {
    capturedRef = captureStderr(child.stderr, emitter, progressParser);
    closeStderr = capturedRef.close;
  }

  // Guard against double-settling: 'error' is followed by 'close', which
  // previously emitted a second 'end'/'error' on the same emitter.
  let settled = false;
  let stderrClosed = false;
  const releaseStderr = (): void => {
    if (stderrClosed) return;
    stderrClosed = true;
    closeStderr?.();
  };

  child.on('close', (code, signal) => {
    releaseStderr();
    if (settled) return;
    settled = true;
    if (code === 0) {
      emitter.emit('end');
    } else {
      const stderrOutput = capturedRef?.stderrLines.join('\n') ?? '';
      emitter.emit('error', new FFmpegSpawnError(code, signal, stderrOutput));
    }
  });

  child.on('error', err => {
    releaseStderr();
    if (settled) return;
    settled = true;
    emitter.emit('error', err);
  });

  // Pipe inputStream into stdin automatically if provided
  if (inputStream && child.stdin) {
    inputStream.pipe(child.stdin);
    inputStream.on('error', err => child.stdin?.destroy(err));
  }

  return {
    emitter,
    stdin: child.stdin,
    stdout: child.stdout as Readable,
    kill(signal: NodeJS.Signals = 'SIGTERM') { child.kill(signal); },
  };
}

/**
 * Stream ffmpeg output directly as a Node.js Readable stream.
 * Useful for HTTP responses, S3 uploads, etc.
 *
 * @example
 * // Stream transcoded video to an HTTP response
 * const stream = streamOutput({
 *   input: 'input.mp4',
 *   outputArgs: ['-c:v', 'libx264', '-c:a', 'aac', '-movflags', 'frag_keyframe+empty_moov'],
 *   outputFormat: 'mp4',
 * });
 * stream.pipe(res);
 */
export interface StreamOutputOptions {
  /** Input file path */
  input: string;
  /** Extra ffmpeg args (codecs, filters, etc.) */
  outputArgs?: string[];
  /** Output format (required for pipe output) */
  outputFormat: string;
  /** Input seek position */
  seekInput?: string | number;
  /** ffmpeg binary override */
  binary?: string;
}

export function streamOutput(opts: StreamOutputOptions): Readable {
  const {
    input,
    outputArgs = [],
    outputFormat,
    seekInput,
    binary = resolveBinary(),
  } = opts;

  const args: string[] = ['-y'];
  if (seekInput !== undefined) args.push('-ss', String(seekInput));
  args.push('-i', input);
  args.push(...outputArgs);
  args.push('-f', outputFormat, 'pipe:1');

  const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  trackChild(child);
  const pass = new PassThrough();

  // stderr is piped but must still be drained. Leaving it unread lets the OS
  // pipe buffer fill, at which point ffmpeg blocks on write and the whole
  // transcode deadlocks. Keep only a bounded tail for diagnostics.
  const STDERR_TAIL_LIMIT = 8192;
  let stderrTail = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderrTail += chunk;
    if (stderrTail.length > STDERR_TAIL_LIMIT) {
      stderrTail = stderrTail.slice(-STDERR_TAIL_LIMIT);
    }
  });
  child.stderr?.on('error', () => { /* drain errors are not actionable */ });

  // `end: false` keeps the PassThrough from ending on its own when the child's
  // stdout drains. Ending is deferred to the child's 'close' handler so a
  // non-zero exit can still be reported as an error — otherwise a failing
  // ffmpeg surfaced to the consumer as a clean, successful 'end'.
  child.stdout?.pipe(pass, { end: false });
  child.on('error', err => pass.destroy(err));
  child.on('close', (code, signal) => {
    if (code !== 0 && code !== null) {
      pass.destroy(new FFmpegSpawnError(code, signal, stderrTail));
      return;
    }
    pass.end();
  });

  // If the consumer aborts (destroy/close), do not leave ffmpeg running.
  pass.on('close', () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
    }
  });

  return pass;
}

/**
 * Pipe a Node.js Readable stream into ffmpeg and write to a file.
 *
 * @example
 * await streamToFile({
 *   stream: req, // incoming HTTP upload
 *   inputFormat: 'webm',
 *   output: './uploads/video.mp4',
 *   outputArgs: ['-c:v', 'libx264', '-c:a', 'aac'],
 * });
 */
export interface StreamToFileOptions {
  /** Input readable stream */
  stream: Readable;
  /** Force input format */
  inputFormat?: string;
  /** Output file path */
  output: string;
  /** Extra output args */
  outputArgs?: string[];
  /** ffmpeg binary override */
  binary?: string;
}

export function streamToFile(opts: StreamToFileOptions): Promise<void> {
  const {
    stream,
    inputFormat,
    output,
    outputArgs = [],
    binary = resolveBinary(),
  } = opts;

  // Non-seekable pipes fail for MP4/MOV because the moov atom is at the file end.
  // Buffer the entire stream to a temp file first, then run FFmpeg on that file.
  // When inputFormat is undefined, we cannot know; always buffer to be safe.
  const needsTempFile = inputFormat === undefined || inputFormat === 'mp4' || inputFormat === 'mov' || inputFormat === 'm4v';

  if (needsTempFile) {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mediaforge-stream-'));
    const tmpPath = path.join(tmpDir, `input.${inputFormat ?? 'tmp'}`);
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err: unknown): void => {
        if (settled) return;
        settled = true;
        // Destroy the write stream so the fd is released before the directory
        // is removed — otherwise pending writes target a deleted path.
        try { ws.destroy(); } catch { /* already destroyed */ }
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup */ }
        reject(err);
      };

      const ws = createWriteStream(tmpPath, { flags: 'wx' });
      stream.on('error', fail);
      ws.on('error', fail);
      ws.on('close', () => {
        if (settled) return;
        const args: string[] = ['-y'];
        if (inputFormat) args.push('-f', inputFormat);
        args.push('-i', tmpPath, ...outputArgs, output);
        const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        trackChild(child);
        const emitter = new FFmpegEmitter();
        let capturedRef: { stderrLines: string[]; close: () => void } | undefined;
        if (child.stderr) {
          capturedRef = captureStderr(child.stderr, emitter);
        }
        const done = (code: number | null, signal: NodeJS.Signals | null): void => {
          if (settled) return;
          settled = true;
          capturedRef?.close();
          try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /**/ }
          if (code === 0) resolve();
          else reject(new FFmpegSpawnError(code, signal, capturedRef?.stderrLines.join('\n') ?? ''));
        };
        child.on('close', done);
        child.on('error', (err: Error) => {
          if (settled) return;
          settled = true;
          capturedRef?.close();
          try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /**/ }
          reject(err);
        });
      });
      stream.pipe(ws);
    });
  }

  // All other formats: pipe directly to stdin
  return new Promise((resolve, reject) => {
    const args: string[] = ['-y'];
    if (inputFormat) args.push('-f', inputFormat);
    args.push('-i', 'pipe:0', ...outputArgs, output);
    const child = spawn(binary, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    trackChild(child);
    const emitter = new FFmpegEmitter();
    let settled = false;
    let capturedRef: { stderrLines: string[]; close: () => void } | undefined;
    if (child.stderr) {
      capturedRef = captureStderr(child.stderr, emitter);
    }
    const stdin = child.stdin;
    if (stdin === null) {
      capturedRef?.close();
      reject(new Error('streamToFile: failed to open ffmpeg stdin'));
      return;
    }
    // An EPIPE on stdin is expected when ffmpeg exits before consuming the
    // whole stream. Without a handler it surfaces as an unhandled 'error'.
    stdin.on('error', () => { /* handled by the close/exit paths below */ });
    stream.pipe(stdin);
    stream.on('error', (err: Error) => stdin.destroy(err));
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      capturedRef?.close();
      if (code === 0) resolve();
      else reject(new FFmpegSpawnError(code, signal, capturedRef?.stderrLines.join('\n') ?? ''));
    });
    child.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      capturedRef?.close();
      reject(err);
    });
  });
}

// ─── Arg builders ─────────────────────────────────────────────────────────────

export function buildPipeThroughArgs(
  inputFormat: string | undefined,
  outputArgs: string[],
  outputFormat: string | undefined,
): string[] {
  const args: string[] = ['-y'];

  // MP4/MOV piped as INPUT: moov atom is at end of file — buffer more data
  const pipedInputNeedsProbe =
    inputFormat === 'mp4' || inputFormat === 'mov' || inputFormat === 'm4v';
  if (pipedInputNeedsProbe) {
    // Large probe window + genpts for recovery when moov atom is at end of file
    args.push('-analyzeduration', '100M', '-probesize', '100M');
    args.push('-fflags', '+genpts');
  }

  if (inputFormat) args.push('-f', inputFormat);
  args.push('-i', 'pipe:0');

  // Auto-inject fragmented-MP4 flags when piping to MP4/MOV (no seek available)
  const pipedContainerNeedsFragmentation =
    outputFormat === 'mp4' || outputFormat === 'mov';
  const userAlreadySetMovflags = outputArgs.some((a, i) => a === '-movflags' && i + 1 < outputArgs.length);
  const effectiveOutputArgs =
    pipedContainerNeedsFragmentation && !userAlreadySetMovflags
      ? [...outputArgs, '-movflags', 'frag_keyframe+empty_moov+default_base_moof']
      : outputArgs;

  args.push(...effectiveOutputArgs);
  if (outputFormat) args.push('-f', outputFormat);
  args.push('pipe:1');
  return args;
}

export function buildStreamOutputArgs(
  input: string, outputArgs: string[], outputFormat: string, seekInput?: string | number,
): string[] {
  const args: string[] = ['-y'];
  if (seekInput !== undefined) args.push('-ss', String(seekInput));
  args.push('-i', input, ...outputArgs, '-f', outputFormat, 'pipe:1');
  return args;
}
