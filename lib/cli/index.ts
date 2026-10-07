#!/usr/bin/env node

import process from 'node:process';
/**
 * mediaforge CLI
 *
 * Usage:
 *   mediaforge [global options] -i <input> [codec/filter options] <output>
 *   mediaforge probe <file>
 *   mediaforge caps [--codecs] [--filters] [--formats] [--hwaccels]
 *   mediaforge version
 *
 * The CLI is a thin wrapper that builds an FFmpegBuilder from argv
 * and delegates to the same core engine as the programmatic API.
 */

import { parseVersionOutput } from '../utils/version.ts';
import { CapabilityRegistry } from '../codecs/registry.ts';
import { resolveBinary, resolveProbe } from '../utils/binary.ts';
import { CLI_TASKS, taskHelpText, taskDetail } from './tasks.ts';
import { buildFlagSpec, parseArgs, CliUsageError } from './parser.ts';
import { runtimePermissionHint } from '../utils/runtime.ts';
import {
  exitWith,
  FAILURE_EXIT,
  INTERRUPTED_EXIT,
  SUCCESS_EXIT,
  TERMINATED_EXIT,
  USAGE_EXIT,
} from './exit.ts';

import { execFileSync } from 'node:child_process';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
mediaforge — Typed FFmpeg wrapper CLI

USAGE
  mediaforge [options] -i <input> [codec options] <output>
  mediaforge probe <file>
  mediaforge caps [--codecs] [--filters] [--formats] [--hwaccels]
  mediaforge version

GLOBAL OPTIONS
  --ffmpeg <path>      Path to ffmpeg binary (default: FFMPEG_PATH env or 'ffmpeg')
  --ffprobe <path>     Path to ffprobe binary (default: FFPROBE_PATH env or 'ffprobe')
  -y                   Overwrite output without asking
  -n                   Never overwrite output
  --loglevel <level>   quiet|panic|fatal|error|warning|info|verbose|debug|trace
  --progress           Print progress to stderr

INPUT OPTIONS (apply to next -i)
  -i <file>            Input file path or URL
  -ss <time>           Seek to position before input (fast seek)
  -t <duration>        Limit input/output duration
  -to <time>           Stop at position
  -f <format>          Force input format

VIDEO OPTIONS
  -c:v <codec>         Video codec (e.g. libx264, libx265, copy)
  -b:v <rate>          Video bitrate (e.g. 2M, 4000k)
  -r <fps>             Frame rate
  -s <WxH>             Video size (e.g. 1280x720)
  -vf <filter>         Video filter chain
  -pix_fmt <fmt>       Pixel format
  -crf <n>             CRF value
  -vn                  Disable video

AUDIO OPTIONS
  -c:a <codec>         Audio codec (e.g. aac, libopus, copy)
  -b:a <rate>          Audio bitrate (e.g. 128k)
  -ar <rate>           Audio sample rate
  -ac <channels>       Number of audio channels
  -af <filter>         Audio filter chain
  -an                  Disable audio

SUBTITLE OPTIONS
  -c:s <codec>         Subtitle codec
  -sn                  Disable subtitles

HARDWARE ACCELERATION
  --hwaccel <name>     Hardware acceleration (cuda, vaapi, mediacodec, vulkan, qsv)
  --hwaccel-device <d> Device path (e.g. /dev/dri/renderD128 for VAAPI)

OUTPUT OPTIONS
  -map <spec>          Stream mapping (e.g. 0:v:0)
  -filter_complex <f>  Complex filter graph

SUBCOMMANDS
  probe <file>         Run ffprobe on file and print JSON stream info
  caps                 Show capability info (codecs, filters, formats, hwaccels)
  version              Show ffmpeg binary version

EXAMPLES
  # Simple transcode
  mediaforge -i input.mp4 -c:v libx264 -crf 23 -c:a aac output.mp4

  # NVENC hardware encode
  mediaforge --hwaccel cuda -i input.mp4 -c:v h264_nvenc -preset p4 output.mp4

  # VAAPI encode
  mediaforge --hwaccel vaapi --hwaccel-device /dev/dri/renderD128 \\
    -i input.mp4 -c:v h264_vaapi output.mp4

  # MediaCodec (Android/v8)
  mediaforge -i input.mp4 -c:v h264_mediacodec output.mp4

  # Extract audio
  mediaforge -i input.mp4 -vn -c:a libopus -b:a 128k output.opus

  # Show installed codecs
  mediaforge caps --codecs

  # Probe a file
  mediaforge probe input.mp4

  # Task commands — run 'mediaforge help' for the full list
  mediaforge trim input.mp4 out.mp4 --start 5 --end 20
  mediaforge hls input.mp4 --outdir ./hls
  mediaforge quality reference.mp4 encoded.mp4 --metric ssim --min 0.98
`.trim() + '\n\n' + taskHelpText());
}

// ─── Subcommand: version ──────────────────────────────────────────────────────

function cmdVersion(binary: string): void {
  let output: string;
  try {
    output = execFileSync(binary, ['-version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  } catch {
    console.error(`Error: could not run "${binary}"`);
    console.error(runtimePermissionHint());
    exitWith(FAILURE_EXIT);
    return;
  }
  const v = parseVersionOutput(output);
  console.log(`ffmpeg version: ${v.isGit ? `git/${v.raw}` : `${v.major}.${v.minor}.${v.patch}`}`);
  console.log(`Libraries:`);
  for (const [lib, ver] of Object.entries(v.libraries)) {
    console.log(`  ${lib.padEnd(20)} ${ver}`);
  }
  if (v.configuration.length > 0) {
    console.log(`\nConfiguration flags (${v.configuration.length}):`);
    // Print 3 per line
    for (let i = 0; i < v.configuration.length; i += 3) {
      console.log('  ' + v.configuration.slice(i, i + 3).join('  '));
    }
  }
}

// ─── Subcommand: caps ─────────────────────────────────────────────────────────

function cmdCaps(binary: string, flags: {
  codecs?: boolean;
  filters?: boolean;
  formats?: boolean;
  hwaccels?: boolean;
}): void {
  const reg = new CapabilityRegistry(binary);
  const showAll = !flags.codecs && !flags.filters && !flags.formats && !flags.hwaccels;

  if (showAll || flags.hwaccels) {
    const hw = reg.hwaccels;
    console.log(`\nHardware Acceleration Methods (${hw.size}):`);
    if (hw.size === 0) {
      console.log('  (none)');
    } else {
      for (const name of hw) console.log(`  ${name}`);
    }
  }

  if (showAll || flags.codecs) {
    const codecs = reg.codecs;
    const video = [...codecs.values()].filter((c) => c.flags.type === 'video');
    const audio = [...codecs.values()].filter((c) => c.flags.type === 'audio');
    const subs = [...codecs.values()].filter((c) => c.flags.type === 'subtitle');
    console.log(`\nCodecs: ${codecs.size} total (${video.length} video, ${audio.length} audio, ${subs.length} subtitle)`);
    console.log('  D=decode E=encode I=intraOnly L=lossy S=lossless');
    console.log('  ' + '-'.repeat(60));
    for (const c of codecs.values()) {
      const d = c.flags.decode ? 'D' : '.';
      const e = c.flags.encode ? 'E' : '.';
      const typeChar = { video: 'V', audio: 'A', subtitle: 'S', data: 'D', attachment: 'T' }[c.flags.type];
      const i = c.flags.intraOnly ? 'I' : '.';
      const l = c.flags.lossy ? 'L' : '.';
      const s = c.flags.lossless ? 'S' : '.';
      console.log(`  ${d}${e}${typeChar}${i}${l}${s} ${c.name.padEnd(24)} ${c.description}`);
    }
  }

  if (showAll || flags.filters) {
    const filters = reg.filters;
    console.log(`\nFilters: ${filters.size} total`);
    console.log('  T=timeline S=slice-based');
    console.log('  ' + '-'.repeat(60));
    for (const f of filters.values()) {
      const t = f.timeline ? 'T' : '.';
      const s = f.sliceBased ? 'S' : '.';
      console.log(`  ${t}${s} ${f.name.padEnd(30)} ${f.description}`);
    }
  }

  if (showAll || flags.formats) {
    const formats = reg.formats;
    console.log(`\nFormats: ${formats.size} total`);
    console.log('  D=demux E=mux');
    console.log('  ' + '-'.repeat(60));
    for (const f of formats.values()) {
      const d = f.demux ? 'D' : '.';
      const e = f.mux ? 'E' : '.';
      console.log(`  ${d}${e} ${f.name.padEnd(24)} ${f.description}`);
    }
  }
}

// ─── Subcommand: probe ────────────────────────────────────────────────────────

function cmdProbe(_binary: string, file: string, ffprobeOverride?: string): void {
  // resolveProbe() always returns a string (FFPROBE_PATH env or 'ffprobe'), so
  // the previous `if (!probeBin)` fallback was unreachable dead code.
  const probeBin = ffprobeOverride ?? resolveProbe();
  let output: string;
  try {
    output = execFileSync(probeBin, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-show_chapters',
      file,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  } catch (err) {
    console.error(`Error probing "${file}": ${(err as Error).message}`);
    console.error(`Hint: Use --ffprobe <path> to specify the ffprobe binary if the auto-detected path "${probeBin}" is incorrect.`);
    console.error(runtimePermissionHint());
    exitWith(FAILURE_EXIT);
    return;
  }
  console.log(output);
}

// ─── Main arg parser ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    printUsage();
    exitWith(SUCCESS_EXIT);
    return;
  }

  // ── Pull out our own flags before forwarding the rest ──────────────────────
  let binary = resolveBinary();
  let ffprobeOverride: string | undefined;
  const rest: string[] = [];
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--ffmpeg') {
      if (++i >= argv.length) {
        console.error('Error: --ffmpeg requires a value');
        exitWith(USAGE_EXIT);
        return;
      }
      binary = argv[i]!;
    } else if (arg === '--ffprobe') {
      if (++i >= argv.length) {
        console.error('Error: --ffprobe requires a value');
        exitWith(USAGE_EXIT);
        return;
      }
      ffprobeOverride = argv[i]!;
    } else {
      rest.push(arg ?? '');
    }
    i++;
  }

  const subcommand = rest[0];

  // ── Subcommands ────────────────────────────────────────────────────────────
  if (subcommand === 'version') {
    cmdVersion(binary);
    return;
  }

  if (subcommand === 'probe') {
    const file = rest[1];
    if (file === undefined) {
      console.error('Error: probe requires a file argument. Usage: mediaforge probe <file>');
      exitWith(USAGE_EXIT);
      return;
    }
    cmdProbe(binary, file, ffprobeOverride);
    return;
  }

  if (subcommand === 'caps') {
    cmdCaps(binary, {
      codecs: rest.includes('--codecs'),
      filters: rest.includes('--filters'),
      formats: rest.includes('--formats'),
      hwaccels: rest.includes('--hwaccels'),
    });
    return;
  }

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printUsage();
    return;
  }

  // ── Task commands (mediaforge trim/hls/chapters/…) ─────────────────────────
  const task = subcommand !== undefined ? CLI_TASKS[subcommand] : undefined;
  if (task) {
    if (rest.includes('--help')) {
      console.log(taskDetail(subcommand!));
      return;
    }

    // The flag table is the authority on arity, so a boolean flag cannot swallow
    // a positional and a value flag cannot be passed without its value.
    let positional: string[];
    let flags: Record<string, string | boolean | string[]>;
    try {
      ({ positional, flags } = parseArgs(rest.slice(1), buildFlagSpec(task.flags)));
    } catch (err) {
      if (err instanceof CliUsageError) {
        console.error(`Error: ${err.message}`);
        console.error(`\n${taskDetail(subcommand!)}`);
        exitWith(USAGE_EXIT);
        return;
      }
      throw err;
    }

    // A surplus positional is a typo, not something to ignore: running with the
    // first N arguments while the user meant a different one silently discards
    // their intent. A variadic slot — `key=value…`, `input…` — accepts any number,
    // so only fixed-arity tasks can overflow.
    const positionals = task.positionals;
    const isVariadic = positionals.some((p) => p.includes('…') || p.includes('...'));
    if (!isVariadic && positionals.length > 0 && positional.length > positionals.length) {
      const extra = positional.slice(positionals.length);
      console.error(
        `Error: "${subcommand}" takes ${positionals.length} positional argument(s) ` +
          `(${positionals.join(', ')}) but got ${positional.length}: ` +
          `${extra.map((p) => `"${p}"`).join(', ')}`,
      );
      console.error('\nIf a filename starts with a dash, put it after `--`.');
      console.error(`\n${taskDetail(subcommand!)}`);
      exitWith(USAGE_EXIT);
      return;
    }

    try {
      await task.run(positional, flags);
    } catch (err) {
      // Print usage only for a misuse error. Dumping the full option list after
      // an encode failure buries the one line the user actually needs.
      if (err instanceof CliUsageError) {
        console.error(`\nError: ${err.message}`);
        console.error(`\n${taskDetail(subcommand!)}`);
        exitWith(USAGE_EXIT);
        return;
      }
      console.error(`\nError: ${(err as Error).message}`);
      exitWith(FAILURE_EXIT);
    }
    return;
  }

  if (subcommand !== undefined && subcommand.startsWith('-')) {
    // A leading flag with no subcommand is the raw passthrough path.
  } else if (subcommand !== undefined) {
    console.error(`Error: unknown command "${subcommand}"`);
    console.error(`\n${taskHelpText()}`);
    console.error('\nRun `mediaforge help` for usage.');
    exitWith(USAGE_EXIT);
    return;
  }

  const ffmpegArgs: string[] = [];

  // Inject -y by default unless -n is present
  if (!rest.includes('-n')) {
    ffmpegArgs.push('-y');
  }

  // Handle --hwaccel / --hwaccel-device as our extended flags
  let k = 0;
  while (k < rest.length) {
    const a = rest[k] ?? '';
    if (a === '--hwaccel') {
      if (k + 1 >= rest.length) {
        console.error('Error: --hwaccel requires a value');
        exitWith(USAGE_EXIT);
        return;
      }
      ffmpegArgs.push('-hwaccel', rest[++k]!);
    } else if (a === '--hwaccel-device') {
      if (k + 1 >= rest.length) {
        console.error('Error: --hwaccel-device requires a value');
        exitWith(USAGE_EXIT);
        return;
      }
      ffmpegArgs.push('-hwaccel_device', rest[++k]!);
    } else if (a === '--progress') {
      ffmpegArgs.push('-progress', 'pipe:2');
    } else {
      ffmpegArgs.push(a);
    }
    k++;
  }

  await runPassthrough(binary, ffmpegArgs);
}

/**
 * Run a raw ffmpeg command line.
 *
 * Handles stdin/stdout piping. Without this, `mediaforge -f lavfi -i testsrc …
 * -f mjpeg pipe:1` wrote nothing to stdout, and both directions hung outright:
 * ffmpeg blocks writing to a pipe nobody drains, and blocks reading one nobody
 * feeds.
 */
async function runPassthrough(binary: string, ffmpegArgs: string[]): Promise<void> {
  const { spawnFFmpeg } = await import('../process/spawn.ts');

  const readsStdin = wantsStdin(ffmpegArgs);
  const writesStdout = writesToStdout(ffmpegArgs);

  const proc = spawnFFmpeg({
    binary,
    args: ffmpegArgs,
    parseProgress: ffmpegArgs.includes('pipe:2'),
    // Piped stdout must be inherited, not captured: a captured pipe that is
    // never drained deadlocks as soon as the OS buffer (64 KiB) fills, and a
    // short payload would still be discarded.
    stdio: {
      stdin: readsStdin ? 'pipe' : 'ignore',
      stdout: writesStdout ? 'inherit' : 'pipe',
      stderr: 'pipe',
    },
  });

  if (readsStdin && proc.stdin !== null) {
    const childStdin = proc.stdin;

    // ffmpeg routinely stops reading early — `-t`, `-frames`, or an encode
    // error — and the next write to its stdin raises EPIPE. That is expected
    // here, not a failure, so it must not become an uncaught exception.
    childStdin.on('error', () => {});

    // `end: true` closes the child's stdin once this process finishes writing.
    // Without it ffmpeg waits forever for an EOF that never arrives.
    process.stdin.pipe(childStdin, { end: true });

    // Piping puts process.stdin in flowing mode, which holds an open handle on
    // the event loop. If ffmpeg has already exited while an endless upstream
    // producer is still writing, nothing would ever unpip it and the CLI would
    // hang after the encode finished. Release it whenever the child settles.
    const releaseStdin = (): void => {
      process.stdin.unpipe(childStdin);
      process.stdin.pause();
    };
    proc.emitter.once('end', releaseStdin);
    proc.emitter.once('error', releaseStdin);
    process.stdin.on('error', () => {});
  }

  if (!writesStdout) {
    proc.emitter.on('stderr', (line) => process.stderr.write(line + '\n'));
  }

  proc.emitter.on('progress', (info) => {
    // `percent` is only set when a total duration is known. Printing it
    // unconditionally produced an empty status line for most commands, because
    // the passthrough path never learns the duration.
    const stats = [
      info.percent !== undefined ? `${info.percent.toFixed(1)}%` : info.outTime,
      `${info.fps}fps`,
      info.bitrate !== 'N/A' ? info.bitrate : undefined,
      info.speed > 0 ? `${info.speed}x` : undefined,
    ].filter((part): part is string => part !== undefined);
    if (stats.length === 0) return;
    process.stderr.write(`\r  ${stats.join(' | ')}`);
  });

  proc.emitter.on('end', () => {
    process.stderr.write('\n');
    exitWith(SUCCESS_EXIT);
  });

  proc.emitter.on('error', (err: Error) => {
    process.stderr.write('\n');
    console.error(`\nError: ${err.message}`);
    exitWith(FAILURE_EXIT);
  });

  // Ctrl-C must terminate the child and leave no partial output behind.
  const onInterrupt = (): void => {
    void killTree(proc.child).finally(() => {
      console.error('\nInterrupted. Output left in place may be incomplete.');
      exitWith(INTERRUPTED_EXIT);
    });
  };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', () => {
    void killTree(proc.child).finally(() => exitWith(TERMINATED_EXIT));
  });
}

/** Does this command line read from standard input? */
function wantsStdin(args: readonly string[]): boolean {
  return args.some((a) => a === '-' || a === 'pipe:0' || a === '/dev/stdin');
}

/** Does this command line write to standard output? */
function writesToStdout(args: readonly string[]): boolean {
  return args.some((a) => a === 'pipe:1' || a === '-');
}

/**
 * Terminate a child and its process group, escalating if it does not go quietly.
 *
 * Mirrors the library's own kill sequence: `SIGTERM` gives an in-flight encode a
 * moment to close its output cleanly, and `SIGKILL` guarantees the prompt
 * returns even for a child that ignores the first signal.
 */
async function killTree(child: import('node:child_process').ChildProcess): Promise<void> {
  const signal = (sig: NodeJS.Signals): void => {
    try {
      if (process.platform !== 'win32' && child.pid !== undefined) {
        process.kill(-child.pid, sig);
        return;
      }
    } catch {
      // Fall through to the direct kill.
    }
    try {
      child.kill(sig);
    } catch {
      // Already gone.
    }
  };

  signal('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal('SIGKILL');
      resolve();
    }, 3000);
    if (typeof timer.unref === 'function') timer.unref();
    child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// Lazy import to avoid circular issues at module level
main().catch((err: unknown) => {
  console.error((err as Error).message);
  exitWith(FAILURE_EXIT);
});
