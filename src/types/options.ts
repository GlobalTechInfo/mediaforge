/** Log level values accepted by ffmpeg -loglevel */
export type LogLevel =
  | 'quiet'
  | 'panic'
  | 'fatal'
  | 'error'
  | 'warning'
  | 'info'
  | 'verbose'
  | 'debug'
  | 'trace';

/** Seeking mode used with -ss / -to / -t */
export type SeekMode = 'input' | 'output';

/** Global ffmpeg options applied before any -i */
export interface GlobalOptions {
  /** Overwrite output without asking (-y) */
  overwrite?: boolean;
  /** Never overwrite (-n) */
  noOverwrite?: boolean;
  /** Log level */
  logLevel?: LogLevel;
  /** Enable progress output to stderr (-progress pipe:2) */
  progress?: boolean;
  /** Stats print interval in seconds */
  statsInterval?: number;
  /** Extra arbitrary global args (escape hatch) */
  extraArgs?: string[];
}

/** Options applied to a specific input */
export interface InputOptions {
  /** Input seek position (before -i, fast seek) */
  seekInput?: string | number;
  /** Read only this many seconds from input */
  duration?: string | number;
  /** Stop reading at this position */
  to?: string | number;
  /** Force input format */
  format?: string;
  /** Frame rate for raw/image inputs */
  frameRate?: string | number;
  /** Loop input N times (-loop), 0 = infinite */
  loop?: number;
  /** Extra arbitrary input args */
  extraArgs?: string[];
}

/** Options applied to a specific output */
export interface OutputOptions {
  /** Output seek position (after codec processing) */
  seekOutput?: string | number;
  /** Limit output duration */
  duration?: string | number;
  /** Stop writing at this position */
  to?: string | number;
  /** Force output format */
  format?: string;
  /** Stream mapping, e.g. "0:v:0", "0:a:1" */
  map?: string[];
  /** Extra arbitrary output args */
  extraArgs?: string[];
}
