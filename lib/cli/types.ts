/**
 * Shared type declarations for the CLI task table.
 */
import type { CliFlags } from './flags.ts';

export interface CliTask {
  /** Subcommand name. */
  name: string;
  /** One-line description for `mediaforge help`. */
  summary: string;
  /** Usage line. */
  usage: string;
  /**
   * `flag -> description` shown in help.
   *
   * A description beginning with `=` marks a flag that requires a value; every
   * other flag is boolean and never consumes the following argument. That
   * declaration is authoritative — `buildFlagSpec` reads it and the parser acts
   * on it, so `analyze --json input.mp3` parses `input.mp3` as a positional.
   */
  flags: Record<string, string>;
  /** Positional argument names, in order, for help text. */
  positionals: string[];
  /**
   * Run the command. Commands that only print or validate synchronously return
   * `void`; everything that shells out to ffmpeg returns a promise.
   */
  run(pos: string[], flags: CliFlags): void | Promise<void>;
}

export type { CliFlags };
