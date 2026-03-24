#!/usr/bin/env node
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

import { parseVersionOutput } from '../utils/version.js';
import { CapabilityRegistry } from '../codecs/registry.js';
import { resolveBinary } from '../utils/binary.js';
import { FFmpegBuilder } from '../FFmpeg.js';
import { execFileSync } from 'child_process';

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
`.trim());
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
    process.exit(1);
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

function cmdProbe(binary: string, file: string): void {
  const probeBin = process.env['FFPROBE_PATH'] ?? binary.replace('ffmpeg', 'ffprobe');
  let output: string;
  try {
    output = execFileSync(probeBin, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      file,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  } catch (err) {
    console.error(`Error probing "${file}": ${(err as Error).message}`);
    process.exit(1);
  }
  console.log(output);
}

// ─── Main arg parser ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    printUsage();
    process.exit(0);
  }

  // ── Pull out our own flags before forwarding the rest ──────────────────────
  let binary = resolveBinary();
  let ffprobeOverride: string | undefined;
  const rest: string[] = [];
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--ffmpeg') {
      binary = argv[++i] ?? binary;
    } else if (arg === '--ffprobe') {
      ffprobeOverride = argv[++i];
    } else {
      rest.push(arg ?? '');
    }
    i++;
  }

  if (ffprobeOverride !== undefined) {
    process.env['FFPROBE_PATH'] = ffprobeOverride;
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
      process.exit(1);
    }
    cmdProbe(binary, file);
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

  // ── FFmpeg passthrough mode ────────────────────────────────────────────────
  // Parse rest[] into an FFmpegBuilder and run it.
  // This lets users drive the full API from the CLI with typed validation.

  const builder = new FFmpegBuilder();
  builder.setBinary(binary);
  void builder; // builder available for future typed subcommand parsing

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
      ffmpegArgs.push('-hwaccel', rest[++k] ?? '');
    } else if (a === '--hwaccel-device') {
      ffmpegArgs.push('-hwaccel_device', rest[++k] ?? '');
    } else if (a === '--progress') {
      ffmpegArgs.push('-progress', 'pipe:2');
    } else {
      ffmpegArgs.push(a);
    }
    k++;
  }

  // Execute via spawnFFmpeg so we get live stderr
  const { spawnFFmpeg } = await import('../process/spawn.js');
  const proc = spawnFFmpeg({ binary, args: ffmpegArgs, parseProgress: ffmpegArgs.includes('pipe:2') });

  proc.emitter.on('stderr', (line) => process.stderr.write(line + '\n'));
  proc.emitter.on('progress', (info) => {
    if (info.percent !== undefined) {
      process.stderr.write(`\r  Progress: ${info.percent.toFixed(1)}% | ${info.fps}fps | ${info.bitrate} | ${info.speed}x`);
    }
  });
  proc.emitter.on('end', () => {
    process.stderr.write('\n');
    process.exit(0);
  });
  proc.emitter.on('error', (err) => {
    process.stderr.write('\n');
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  });
}

// Lazy import to avoid circular issues at module level
main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exit(1);
});
