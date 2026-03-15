import { spawn } from 'child_process';
import type { Readable, Writable } from 'stream';
import { PassThrough } from 'stream';
import { FFmpegEmitter } from '../process/events.js';
import { ProgressParser } from '../process/progress.js';
import { FFmpegSpawnError } from '../process/spawn.js';
import { resolveBinary } from '../utils/binary.js';
import { createInterface } from 'readline';

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
    outputArgs = [],
    outputFormat,
    parseProgress = false,
    binary = resolveBinary(),
  } = opts;

  const args: string[] = ['-y'];

  if (inputFormat) args.push('-f', inputFormat);
  args.push('-i', 'pipe:0');

  args.push(...outputArgs);

  if (outputFormat) args.push('-f', outputFormat);
  args.push('pipe:1');

  const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const emitter = new FFmpegEmitter();
  const stderrLines: string[] = [];

  const progressParser = parseProgress
    ? new ProgressParser(info => emitter.emit('progress', info))
    : null;

  emitter.emit('start', args);

  if (child.stderr) {
    const rl = createInterface({ input: child.stderr, crlfDelay: Infinity });
    rl.on('line', line => {
      stderrLines.push(line);
      emitter.emit('stderr', line);
      progressParser?.push(line);
    });
  }

  child.on('close', (code, signal) => {
    if (code === 0 || (code === null && signal === null)) {
      emitter.emit('end');
    } else {
      emitter.emit('error', new FFmpegSpawnError(code, signal, stderrLines.join('\n')));
    }
  });

  child.on('error', err => emitter.emit('error', err));

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
  const pass = new PassThrough();

  child.stdout?.pipe(pass);
  child.on('error', err => pass.destroy(err));
  child.on('close', (code) => {
    if (code !== 0 && code !== null) {
      pass.destroy(new Error(`ffmpeg exited with code ${code}`));
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

  return new Promise((resolve, reject) => {
    const pipeOpts: PipeOptions = {
      inputStream: stream,
      outputArgs: [...outputArgs, output],
      binary,
    };
    if (inputFormat !== undefined) pipeOpts.inputFormat = inputFormat;
    const proc = pipeThrough(pipeOpts);
    proc.emitter.on('end', resolve);
    proc.emitter.on('error', reject);
    // stdout not used — output goes to file
    proc.stdout.resume();
  });
}

// ─── Arg builders ─────────────────────────────────────────────────────────────

export function buildPipeThroughArgs(
  inputFormat: string | undefined,
  outputArgs: string[],
  outputFormat: string | undefined,
): string[] {
  const args: string[] = ['-y'];
  if (inputFormat) args.push('-f', inputFormat);
  args.push('-i', 'pipe:0');
  args.push(...outputArgs);
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
