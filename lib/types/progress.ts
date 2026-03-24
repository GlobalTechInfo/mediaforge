/**
 * Parsed progress information emitted by FFmpeg on stderr.
 * FFmpeg writes key=value lines terminated by progress=continue|end.
 */
export interface ProgressInfo {
  /** Current frame number being processed */
  frame: number;
  /** Frames per second (encoding speed) */
  fps: number;
  /** Output bitrate, e.g. "2048.0kbits/s" */
  bitrate: string;
  /** Total bytes written so far */
  totalSize: number;
  /** Output time in microseconds */
  outTimeUs: number;
  /** Output time as human string, e.g. "00:01:23.456789" */
  outTime: string;
  /** Duplicate frames count */
  dupFrames: number;
  /** Dropped frames count */
  dropFrames: number;
  /** Encoding speed relative to realtime, e.g. 2.5 means 2.5× */
  speed: number;
  /** Whether this is an intermediate update or the final one */
  progress: 'continue' | 'end';
  /** Percentage 0–100 if duration is known, otherwise undefined */
  percent?: number | undefined;
}
