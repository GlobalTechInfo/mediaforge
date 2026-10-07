/**
 * Exit codes.
 *
 * A single non-zero code for every failure is not workable in a script or a
 * monitoring system: `if mediaforge …` cannot distinguish "you typed the
 * command wrong" from "the encode failed", and a typo looks exactly like an
 * infrastructure outage on a dashboard.
 *
 * These follow the long-established Unix convention that codes above 128 encode
 * the signal that terminated the process, so `128 + SIGINT` is 130 and matches
 * what a shell reports for an interrupted command.
 */

/** Success. */
export const SUCCESS_EXIT = 0;

/**
 * The command was understood and ran, but failed.
 *
 * A non-zero ffmpeg exit, a failed quality gate, a missing binary at run time.
 */
export const FAILURE_EXIT = 1;

/**
 * The command line was wrong: unknown command, unknown flag, missing or
 * surplus argument, bad flag value.
 *
 * Nothing was executed, so a script can treat this as a caller bug rather than a
 * job failure.
 */
export const USAGE_EXIT = 2;

/** Interrupted with SIGINT (Ctrl-C). Conventional 128 + 2. */
export const INTERRUPTED_EXIT = 130;

/** Terminated with SIGTERM (supervisor stop, container shutdown). 128 + 15. */
export const TERMINATED_EXIT = 143;

/**
 * Set the process exit code and return, rather than calling `process.exit`.
 *
 * `process.exit` truncates output that has been written to a pipe but not yet
 * flushed — which is precisely the case a CLI piping into another tool hits, so
 * using it after any `write` risks losing the very output the caller asked for.
 * Setting `exitCode` lets the event loop drain naturally.
 */
export function exitWith(code: number): void {
  process.exitCode = code;
}