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
  /** `flag -> description` shown in help. Flags taking a value end with `=`. */
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
