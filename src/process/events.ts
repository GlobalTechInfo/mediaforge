import { EventEmitter } from 'events';
import type { ProgressInfo } from '../types/progress.js';

/**
 * All events emitted by an FFmpegProcess.
 */
export interface FFmpegEvents {
  /** Raw stderr line */
  stderr: [line: string];
  /** Parsed progress update (emitted on each progress=continue|end block) */
  progress: [info: ProgressInfo];
  /** Process started — emits the full args array */
  start: [args: string[]];
  /** Process finished successfully */
  end: [];
  /** Process failed */
  error: [err: Error];
}

/**
 * Typed EventEmitter for FFmpeg process events.
 */
export class FFmpegEmitter extends EventEmitter {
  override on<K extends keyof FFmpegEvents>(
    event: K,
    listener: (...args: FFmpegEvents[K]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override once<K extends keyof FFmpegEvents>(
    event: K,
    listener: (...args: FFmpegEvents[K]) => void,
  ): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  override off<K extends keyof FFmpegEvents>(
    event: K,
    listener: (...args: FFmpegEvents[K]) => void,
  ): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  override emit<K extends keyof FFmpegEvents>(
    event: K,
    ...args: FFmpegEvents[K]
  ): boolean {
    return super.emit(event, ...args);
  }
}
