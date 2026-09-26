/**
 * mediaforge battle test — CLI task commands
 *
 * Companion to `battle.test.ts` and `battle.newfeatures.test.ts`. Everything
 * here drives the real `mediaforge` binary as a subprocess, so it covers the
 * argv surface, the help text, the exit codes, and the error messages a user
 * actually sees — not just the functions behind them.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, 'tmp_cli');
const CLI = path.join(__dirname, 'dist/esm/cli/index.js');

const p = (name: string) => path.join(TMP, name);
const errors: { label: string; error: string; stack: string }[] = [];
let passed = 0;
let skipped = 0;

async function run(label: string, fn: () => void | Promise<void>): Promise<void> {
  process.stdout.write(`  ▸ ${label} ... `);
  try {
    await fn();
    console.log('✅ PASS');
    passed++;
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    console.log(`❌ FAIL\n      ${msg}`);
    errors.push({ label, error: msg, stack: (err as Error)?.stack ?? '' });
  }
}

function skip(label: string, reason: string): void {
  console.log(`  ▸ ${label} ... ⏭  SKIP (${reason})`);
  skipped++;
}

function section(title: string): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

function ffmpegExec(args: string): void {
  execFileSync('ffmpeg', ['-y', ...args.trim().split(/\s+/)], { stdio: 'pipe' });
}

function ffmpegExecQuoted(args: string): void {
  // Split on whitespace but keep "quoted groups" together — lavfi graphs and
  // filter_complex strings need their spaces and semicolons preserved.
  const argv = args.trim().match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  execFileSync('ffmpeg', ['-y', ...argv.map(a => (a.startsWith('"') ? a.slice(1, -1) : a))], { stdio: 'pipe' });
}

function hasFilter(name: string): boolean {
  try {
    const out = execFileSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8', stdio: 'pipe' });
    return new RegExp(`\\b${name}\\b`).test(out);
  } catch {
    return false;
  }
}

const HAS_ZSCALE = hasFilter('zscale');
const HAS_TONEMAP = hasFilter('tonemap');
const HAS_DRAW_TEXT = hasFilter('drawtext');

const {
  CLI_TASKS, parseTaskArgs, taskHelpText, taskDetail, toGif,
} = await import('./lib/index.js');
const { CLI_TASKS: TASKS_MOD } = await import('./lib/cli/tasks.js');

const EXPECTED_TASKS = [
  'trim', 'speed', 'volume', 'normalize', 'extract', 'replace-audio', 'concat',
  'transitions', 'hls', 'abr', 'dash', 'segments', 'chapters', 'metadata',
  'thumbnail', 'sprite', 'frames', 'gif', 'watermark', 'text', 'subtitles',
  'quality', 'tonemap', 'interpolate', 'silence', 'scenes', 'waveform',
  'spectrum', 'delogo', 'twopass', 'to-bitrate',
  // The commands that close the gap between the library and the CLI.
  'filter', 'graph', 'codec', 'map', 'preset', 'analyze', 'features',
  'hwaccel', 'args', 'mix', 'loop', 'deinterlace', 'stabilize', 'aspect',
  'lut', 'timecode', 'cropdetect', 'gif2mp4', 'extract-subs', 'retime-subs', 'stack',
];

/**
 * Listing-only commands take no positionals on purpose, so they cannot reject an
 * empty invocation the way the others do. `features` is the only one today; the
 * assertion below keeps it that way instead of letting the exception spread.
 */
const LISTING_ONLY = ['features'];

// ─── setup ──────────────────────────────────────────────────────────────────
section('SETUP — generating test media and checking the build');

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const built = fs.existsSync(CLI);

await run('generate src.mp4 (4s 320x180 video+audio)', () => {
  ffmpegExec(
    '-f lavfi -i testsrc=duration=4:size=320x180:rate=15 ' +
    '-f lavfi -i sine=frequency=440:duration=4 ' +
    '-c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -movflags +faststart ' +
    p('src.mp4'),
  );
});

await run('generate lossy.mp4 (crf 40 re-encode)', () => {
  ffmpegExec('-i ' + p('src.mp4') + ' -c:v libx264 -preset veryfast -crf 40 -pix_fmt yuv420p -c:a aac ' + p('lossy.mp4'));
});

await run('generate with_subs.mkv (video + audio + srt)', () => {
  fs.writeFileSync(
    p('subs.srt'),
    '1\n00:00:00,500 --> 00:00:02,000\nHello world\n\n2\n00:00:03,000 --> 00:00:04,000\nTest subtitle\n',
  );
  ffmpegExec(
    '-f lavfi -i testsrc=duration=4:size=320x180:rate=15 ' +
    '-f lavfi -i sine=frequency=440:duration=4 ' +
    '-i ' + p('subs.srt') +
    ' -c:v libx264 -preset ultrafast -c:a aac -c:s srt ' + p('with_subs.mkv'),
  );
});

await run('generate gap.m4a (tone, silence, tone) for replace-audio', () => {
  // AAC, not a PCM wav: replace-audio stream-copies the audio into the MP4,
  // and pcm_s16le is not a legal MP4 codec.
  ffmpegExecQuoted(
    '-f lavfi -i "sine=frequency=440:duration=2" ' +
    '-f lavfi -i "sine=frequency=880:duration=1,volume=0.0001" ' +
    '-filter_complex "[0:a][1:a]concat=n=2:v=0:a=1[out]" ' +
    '-map "[out]" -c:a aac ' + p('gap.m4a'),
  );
});

await run('generate tone_gap.wav (tone, silence, tone)', () => {
  // Three separate inputs: a multi-source lavfi graph needs one -i per source.
  // WAV rather than mp3/aac, which reject the mono float stream this produces.
  ffmpegExecQuoted(
    '-f lavfi -i "sine=frequency=440:duration=1" ' +
    '-f lavfi -i "sine=frequency=880:duration=1,volume=0.0001" ' +
    '-f lavfi -i "sine=frequency=440:duration=1" ' +
    '-filter_complex "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]" ' +
    '-map "[out]" -c:a pcm_s16le ' + p('tone_gap.wav'),
  );
});

await run('generate cut.mp4 (three hard-cut scenes)', () => {
  ffmpegExecQuoted(
    '-f lavfi -i testsrc=duration=1.5:size=160x90:rate=15 ' +
    '-f lavfi -i color=blue:duration=1.5:size=160x90:rate=15 ' +
    '-f lavfi -i color=green:duration=1.5:size=160x90:rate=15 ' +
    '-filter_complex "[0:v][1:v][2:v]concat=n=3:v=1:a=0[out]" -map "[out]" ' +
    '-c:v libx264 -preset ultrafast -pix_fmt yuv420p ' + p('cut.mp4'),
  );
});

await run('generate sdr10.mp4 (10-bit BT.709, deliberately not HDR)', () => {
  ffmpegExec(
    '-f lavfi -i testsrc=duration=2:size=160x90:rate=15 ' +
    '-c:v libx264 -preset ultrafast -pix_fmt yuv420p10le ' +
    '-color_primaries bt709 -color_trc bt709 -colorspace bt709 ' + p('sdr10.mp4'),
  );
});

await run('generate hdr.mp4 (BT.2020 / PQ tagged)', () => {
  ffmpegExec(
    '-f lavfi -i testsrc=duration=2:size=160x90:rate=15 ' +
    '-c:v libx264 -preset ultrafast -pix_fmt yuv420p10le ' +
    '-color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc ' + p('hdr.mp4'),
  );
});

await run('generate logo.png (watermark source)', () => {
  ffmpegExec('-f lavfi -i color=red:size=100x50:rate=1 -frames:v 1 ' + p('logo.png'));
});

// ─── helpers for the e2e section ────────────────────────────────────────────
const cli = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 180_000 });

const ok = (r: { status: number | null; stdout: string; stderr: string }, what: string) => {
  if (r.status !== 0) throw new Error(`${what} exited ${r.status}\n${(r.stderr || r.stdout).slice(-600)}`);
};

const exists = (f: string) => {
  if (!fs.existsSync(f)) throw new Error(`expected output file: ${f}`);
  if (fs.statSync(f).size === 0) throw new Error(`output is empty: ${f}`);
};

const fresh = (name: string) => {
  const dir = path.join(TMP, name);
  fs.rmSync(dir, { recursive: true, force: true });
  return dir;
};

const probeJson = (file: string, extra: string[]) => JSON.parse(
  execFileSync('ffprobe', ['-v', 'error', ...extra, '-of', 'json', file], { encoding: 'utf8' }),
);

const duration = (file: string) =>
  Number(probeJson(file, ['-show_entries', 'format=duration']).format?.duration);

// ─── 50. Task table, help, argument parsing ─────────────────────────────────
section('50 — CLI: task table, help, parsing');

await run(`CLI_TASKS exposes all ${EXPECTED_TASKS.length} task commands`, () => {
  for (const name of EXPECTED_TASKS) {
    if (!CLI_TASKS[name]) throw new Error(`missing task: ${name}`);
    const t = CLI_TASKS[name]!;
    if (typeof t.run !== 'function') throw new Error(`${name} has no run()`);
    if (!t.summary || t.summary.length < 5) throw new Error(`${name} has no usable summary`);
    if (!t.usage.startsWith(`mediaforge ${name} `)) {
      throw new Error(`${name} usage does not start with its own name: ${t.usage}`);
    }
    if (!Array.isArray(t.positionals)) throw new Error(`${name} has no positionals`);
    if (t.positionals.length === 0 && !LISTING_ONLY.includes(name)) {
      throw new Error(`${name} declares no positionals but is not a listing command`);
    }
  }
});

await run(`the only positional-free commands are ${LISTING_ONLY.join(', ')}`, () => {
  const zero = Object.entries(CLI_TASKS).filter(([, t]) => t.positionals.length === 0).map(([n]) => n);
  const extra = zero.filter(n => !LISTING_ONLY.includes(n));
  if (extra.length > 0) throw new Error(`undeclared positional-free commands: ${extra.join(', ')}`);
});

await run('no unexpected extra task commands are exported', () => {
  const extra = Object.keys(CLI_TASKS).filter(n => !EXPECTED_TASKS.includes(n));
  if (extra.length > 0) throw new Error(`undocumented tasks: ${extra.join(', ')}`);
});

await run('the index re-export matches the tasks module', () => {
  const a = Object.keys(CLI_TASKS).sort();
  const b = Object.keys(TASKS_MOD).sort();
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${a.length} vs ${b.length}`);
});

await run('every task usage line names its own flags', () => {
  for (const name of EXPECTED_TASKS) {
    const t = CLI_TASKS[name]!;
    for (const flag of Object.keys(t.flags)) {
      if (!t.usage.includes(`--${flag}`)) {
        throw new Error(`${name} declares --${flag} but its usage line omits it: ${t.usage}`);
      }
    }
  }
});

await run('every task flag is described in the flags table', () => {
  for (const name of EXPECTED_TASKS) {
    for (const [flag, desc] of Object.entries(CLI_TASKS[name]!.flags)) {
      if (!desc || desc.length < 3) throw new Error(`${name} --${flag} has no description`);
    }
  }
});

await run('taskHelpText() lists every task', () => {
  const text = taskHelpText();
  for (const name of EXPECTED_TASKS) {
    if (!text.includes(name)) throw new Error(`help omits ${name}`);
  }
  console.log(`      ${text.split('\n').length} lines of help`);
});

await run('taskHelpText() includes each task summary', () => {
  const text = taskHelpText();
  for (const name of EXPECTED_TASKS) {
    const summary = CLI_TASKS[name]!.summary;
    if (!text.includes(summary)) throw new Error(`help omits the summary for ${name}`);
  }
});

await run('taskDetail("trim") → usage, summary and options', () => {
  const d = taskDetail('trim');
  if (!d.includes('mediaforge trim')) throw new Error(`no usage: ${d}`);
  if (!d.includes('--start')) throw new Error(`no flag docs: ${d}`);
  if (!d.includes('OPTIONS')) throw new Error(`no options heading: ${d}`);
});

await run('taskDetail("nope") → explains instead of printing nothing', () => {
  const d = taskDetail('nope');
  // Returning '' here would make `mediaforge help <typo>` look like a silent success.
  if (d.trim() === '') throw new Error('returned nothing for an unknown task');
  if (!/nope/.test(d)) throw new Error(`does not name the bad task: ${d}`);
  if (!/mediaforge help/.test(d)) throw new Error(`does not point at the task list: ${d}`);
});

await run('parseTaskArgs splits positionals, --flag value and --flag=value', () => {
  const r = parseTaskArgs(['in.mp4', 'out.mp4', '--start', '1', '--end=9', '--burn']);
  if (r.positional.join(',') !== 'in.mp4,out.mp4') throw new Error(`positional: ${r.positional}`);
  if (r.flags['start'] !== '1') throw new Error(`start: ${String(r.flags['start'])}`);
  if (r.flags['end'] !== '9') throw new Error(`end: ${String(r.flags['end'])}`);
  if (r.flags['burn'] !== true) throw new Error(`burn: ${String(r.flags['burn'])}`);
});

await run('parseTaskArgs treats a flag before another flag as boolean', () => {
  const r = parseTaskArgs(['in.mp4', '--cut', '--threshold', '0.5']);
  if (r.flags['cut'] !== true) throw new Error(`cut: ${String(r.flags['cut'])}`);
  if (r.flags['threshold'] !== '0.5') throw new Error(`threshold: ${String(r.flags['threshold'])}`);
});

await run('parseTaskArgs handles negative numbers and paths with spaces', () => {
  const r = parseTaskArgs(['/tmp/a b/in.mp4', '--start', '-3.5']);
  if (r.positional[0] !== '/tmp/a b/in.mp4') throw new Error(`positional: ${r.positional[0]}`);
  if (r.flags['start'] !== '-3.5') throw new Error(`start: ${String(r.flags['start'])}`);
});

await run('parseTaskArgs keeps a bare --flag as boolean true', () => {
  const r = parseTaskArgs(['--strip']);
  if (r.flags['strip'] !== true) throw new Error(`strip: ${String(r.flags['strip'])}`);
});

await run('parseTaskArgs([]) → empty result, no throw', () => {
  const r = parseTaskArgs([]);
  if (r.positional.length !== 0 || Object.keys(r.flags).length !== 0) throw new Error('not empty');
});

await run('every task rejects a missing required positional and shows usage', async () => {
  for (const name of EXPECTED_TASKS) {
    if (LISTING_ONLY.includes(name)) continue;
    const t = CLI_TASKS[name]!;
    let msg = '';
    try {
      await t.run([], {});
    } catch (e) { msg = (e as Error).message; }
    if (!msg) throw new Error(`${name} accepted an empty argument list`);
    if (!msg.includes('Usage:') && !/needs \d+ argument/.test(msg)) {
      throw new Error(`${name} error does not show usage: ${msg}`);
    }
  }
});

// ─── 51. End to end through the real binary ─────────────────────────────────
section('51 — CLI: end-to-end task commands');

if (!built) {
  skip('CLI end-to-end', 'run npm run build first');
} else {
  await run('cli version → prints the package version', () => {
    const r = cli('version');
    ok(r, 'version');
    if (!/\d+\.\d+\.\d+/.test(r.stdout)) throw new Error(`no version in output: ${r.stdout}`);
  });

  await run('cli help → usage lists the task commands', () => {
    const r = cli('help');
    ok(r, 'help');
    for (const name of ['trim', 'hls', 'chapters', 'tonemap', 'quality']) {
      if (!r.stdout.includes(name)) throw new Error(`help omits ${name}`);
    }
    if (!r.stdout.includes('TASK COMMANDS')) throw new Error('help has no TASK COMMANDS section');
  });

  await run('cli help mentions every task command', () => {
    const r = cli('help');
    for (const name of EXPECTED_TASKS) {
      if (!r.stdout.includes(name)) throw new Error(`cli help omits ${name}`);
    }
  });

  await run('cli trim --help → detailed help for one task', () => {
    const r = cli('trim', '--help');
    ok(r, 'trim --help');
    if (!r.stdout.includes('mediaforge trim')) throw new Error(`no usage line: ${r.stdout}`);
    if (!r.stdout.includes('--start')) throw new Error(`no flag docs: ${r.stdout}`);
  });

  await run('cli with no arguments → usage, never a crash', () => {
    const r = cli();
    if (!(r.stdout + r.stderr).includes('mediaforge')) throw new Error('no usage printed');
  });

  await run('cli unknown-command → actionable error, not a silent success', () => {
    const r = cli('definitely-not-a-command', p('src.mp4'), 'out.mp4');
    const out = r.stdout + r.stderr;
    if (r.status === 0) throw new Error('exited 0 for an unknown command');
    if (!/unknown command/i.test(out)) throw new Error(`no "unknown command" message:\n${out.slice(-400)}`);
    if (!/mediaforge help/.test(out)) throw new Error(`should point at the help:\n${out.slice(-400)}`);
  });

  await run('cli probe → JSON with video, audio and subtitle streams', () => {
    const r = cli('probe', p('with_subs.mkv'));
    ok(r, 'probe');
    let data: { streams?: { codec_type?: string }[] };
    try { data = JSON.parse(r.stdout); } catch { throw new Error(`not JSON: ${r.stdout.slice(0, 200)}`); }
    const types = new Set((data.streams ?? []).map(s => s.codec_type));
    for (const t of ['video', 'audio', 'subtitle']) {
      if (!types.has(t)) throw new Error(`probe did not report the ${t} stream (got ${[...types].join(', ')})`);
    }
  });

  await run('cli probe → -show_chapters is passed through to ffprobe', () => {
    // Regression: probe used to omit -show_chapters, so `mediaforge probe` could
    // never show the chapters that `mediaforge chapters` writes.
    const r = cli('probe', p('with_subs.mkv'));
    ok(r, 'probe');
    if (/-show_chapters/.test(r.stderr)) throw new Error('ffprobe rejected -show_chapters');
    if (!/"streams"/.test(r.stdout)) throw new Error('probe produced no stream data');
  });

  await run('cli caps --hwaccels → lists accelerations', () => {
    const r = cli('caps', '--hwaccels');
    ok(r, 'caps');
    if (!/vaapi|cuda|qsv/.test(r.stdout)) throw new Error(`no accels listed:\n${r.stdout.slice(0, 300)}`);
  });

  // ── basic edits ──
  await run('cli trim --start 1 --end 2 → a ~1s clip', () => {
    const r = cli('trim', p('src.mp4'), p('cli_trim.mp4'), '--start', '1', '--end', '2');
    ok(r, 'trim');
    exists(p('cli_trim.mp4'));
    const d = duration(p('cli_trim.mp4'));
    if (d > 1.6 || d < 0.4) throw new Error(`duration ${d}s, expected ~1s`);
  });

  await run('cli trim with no --start/--end → copies the whole file', () => {
    const r = cli('trim', p('src.mp4'), p('cli_trim_all.mp4'));
    ok(r, 'trim');
    exists(p('cli_trim_all.mp4'));
  });

  await run('cli speed --factor 2 → a shorter file', () => {
    const r = cli('speed', p('src.mp4'), p('cli_speed.mp4'), '--factor', '2');
    ok(r, 'speed');
    exists(p('cli_speed.mp4'));
    const d = duration(p('cli_speed.mp4'));
    if (d > 2.9) throw new Error(`duration ${d}s, expected ~2s at 2x`);
  });

  await run('cli volume --gain 0.5 → a quieter file', () => {
    const r = cli('volume', p('src.mp4'), p('cli_volume.mp4'), '--gain', '0.5');
    ok(r, 'volume');
    exists(p('cli_volume.mp4'));
  });

  await run('cli volume without --gain → clear error, no output', () => {
    const r = cli('volume', p('src.mp4'), p('cli_volume_bad.mp4'));
    if (r.status === 0) throw new Error('ran volume with no --gain');
    const out = r.stdout + r.stderr;
    if (!/--gain/.test(out)) throw new Error(`unhelpful error:\n${out.slice(-300)}`);
    if (fs.existsSync(p('cli_volume_bad.mp4'))) throw new Error('produced an output anyway');
  });

  await run('cli normalize --target -16 → an EBU R128 normalised file', () => {
    const r = cli('normalize', p('src.mp4'), p('cli_norm.mp4'), '--target', '-16');
    ok(r, 'normalize');
    exists(p('cli_norm.mp4'));
    if (!/LUFS/.test(r.stdout)) throw new Error(`no loudness readout: ${r.stdout.slice(-200)}`);
  });

  await run('cli extract → an audio-only file', () => {
    const r = cli('extract', p('src.mp4'), p('cli_audio.m4a'));
    ok(r, 'extract');
    exists(p('cli_audio.m4a'));
    const types = (probeJson(p('cli_audio.m4a'), ['-show_entries', 'stream=codec_type']).streams ?? [])
      .map(s => s.codec_type);
    if (types.includes('video')) throw new Error(`kept a video stream: ${types.join(', ')}`);
  });

  await run('cli replace-audio <video> <audio> <output> → swapped track', () => {
    const r = cli('replace-audio', p('src.mp4'), p('gap.m4a'), p('cli_replaced.mp4'));
    ok(r, 'replace-audio');
    exists(p('cli_replaced.mp4'));
  });

  await run('cli concat <output> --inputs a,b → one longer file', () => {
    const r = cli('concat', p('cli_concat.mp4'), '--inputs', `${p('src.mp4')},${p('src.mp4')}`);
    ok(r, 'concat');
    exists(p('cli_concat.mp4'));
    const d = duration(p('cli_concat.mp4'));
    if (d < 6) throw new Error(`duration ${d}s, expected ~8s from two 4s inputs`);
  });

  await run('cli concat --inputs with a single file → rejected', () => {
    const r = cli('concat', p('cli_concat_bad.mp4'), '--inputs', p('src.mp4'));
    if (r.status === 0) throw new Error('concatenated a single file');
    if (!/at least two files/.test(r.stdout + r.stderr)) {
      throw new Error(`unhelpful error:\n${(r.stdout + r.stderr).slice(-300)}`);
    }
  });

  await run('cli transitions <output> --inputs a,b → a joined file', () => {
    // 'fade', not 'crossfade': ffmpeg's xfade filter has no such transition
    // and rejects it with "Error setting option transition to value crossfade".
    const r = cli('transitions', p('cli_trans.mp4'),
      '--inputs', `${p('src.mp4')},${p('src.mp4')}`, '--duration', '0.5', '--transition', 'fade');
    ok(r, 'transitions');
    exists(p('cli_trans.mp4'));
  });

  // ── packaging ──
  await run('cli hls --outdir <dir> → a playlist and segments', () => {
    const dir = fresh('cli_hls');
    const r = cli('hls', p('src.mp4'), '--outdir', dir, '--segment', '1');
    ok(r, 'hls');
    const files = fs.readdirSync(dir);
    if (!files.some(f => f.endsWith('.m3u8'))) throw new Error(`no playlist: ${files.join(', ')}`);
    if (!files.some(f => f.endsWith('.ts'))) throw new Error(`no .ts segments: ${files.join(', ')}`);
  });

  await run('cli hls without --outdir → clear error', () => {
    const r = cli('hls', p('src.mp4'));
    if (r.status === 0) throw new Error('ran hls with no --outdir');
    if (!/--outdir/.test(r.stdout + r.stderr)) throw new Error('unhelpful error');
  });

  await run('cli abr --out v%v/index.m3u8 --variants … → a master playlist', () => {
    const dir = fresh('cli_abr');
    const r = cli('abr', p('src.mp4'),
      '--out', path.join(dir, 'v%v/index.m3u8'),
      '--variants', 'hi=320x180:400k,lo=160x90:150k');
    ok(r, 'abr');
    if (!fs.existsSync(path.join(dir, 'master.m3u8'))) {
      throw new Error(`no master playlist: ${fs.readdirSync(dir).join(', ')}`);
    }
  });

  await run('cli abr with an odd resolution → rejected before ffmpeg runs', () => {
    const dir = fresh('cli_abr_bad');
    const r = cli('abr', p('src.mp4'),
      '--out', path.join(dir, 'v%v/index.m3u8'), '--variants', 'odd=321x181:400k');
    if (r.status === 0) throw new Error('accepted an odd variant resolution');
    if (!/is odd/.test(r.stdout + r.stderr)) {
      throw new Error(`unhelpful error:\n${(r.stdout + r.stderr).slice(-300)}`);
    }
  });

  await run('cli dash <input> <output.mpd> → a DASH manifest', () => {
    const dir = fresh('cli_dash');
    const mpd = path.join(dir, 'out.mpd');
    const r = cli('dash', p('src.mp4'), mpd);
    ok(r, 'dash');
    if (!fs.existsSync(mpd)) throw new Error(`no .mpd written: ${fs.readdirSync(dir).join(', ')}`);
  });

  await run('cli segments --pattern "seg%03d.ts" --segment 1 → numbered segments', () => {
    const dir = fresh('cli_segments');
    const r = cli('segments', p('src.mp4'), '--pattern', path.join(dir, 'seg%03d.ts'), '--segment', '1');
    ok(r, 'segments');
    const segs = fs.readdirSync(dir).filter(f => /^seg\d{3}\.ts$/.test(f));
    if (segs.length < 3) throw new Error(`expected ≥3 segments, got ${segs.length}: ${segs.join(', ')}`);
  });

  // ── metadata and chapters ──
  await run('cli chapters --chapters "Intro:0,Outro:2" → the chapters are muxed in', () => {
    const r = cli('chapters', p('src.mp4'), p('cli_chapters.mp4'), '--chapters', 'Intro:0,Outro:2');
    ok(r, 'chapters');
    exists(p('cli_chapters.mp4'));
    const chapters = probeJson(p('cli_chapters.mp4'), ['-show_chapters']).chapters ?? [];
    if (chapters.length < 2) throw new Error(`chapters not muxed: ${JSON.stringify(chapters)}`);
    const titles = chapters.map((c: { tags?: { title?: string } }) => c.tags?.title);
    console.log(`      chapters: ${titles.join(', ')}`);
    if (!titles.includes('Intro') || !titles.includes('Outro')) {
      throw new Error(`wrong titles: ${titles.join(', ')}`);
    }
  });

  await run('cli chapters with a malformed spec → rejected', () => {
    const r = cli('chapters', p('src.mp4'), p('cli_chapters_bad.mp4'), '--chapters', 'NoTimeHere');
    if (r.status === 0) throw new Error('accepted a chapter with no start time');
    if (!/title:startSeconds/.test(r.stdout + r.stderr)) {
      throw new Error(`unhelpful error:\n${(r.stdout + r.stderr).slice(-300)}`);
    }
  });

  await run('cli metadata --set title=…,artist=… → tags written', () => {
    const r = cli('metadata', p('src.mp4'), p('cli_meta.mp4'), '--set', 'title=Battle,artist=mediaforge');
    ok(r, 'metadata');
    const tags = probeJson(p('cli_meta.mp4'), ['-show_format']).format?.tags ?? {};
    if (tags.title !== 'Battle') throw new Error(`title: ${JSON.stringify(tags)}`);
    if (tags.artist !== 'mediaforge') throw new Error(`artist: ${JSON.stringify(tags)}`);
  });

  await run('cli metadata --strip → a re-muxed file', () => {
    const r = cli('metadata', p('cli_meta.mp4'), p('cli_meta_stripped.mp4'), '--strip');
    ok(r, 'metadata --strip');
    exists(p('cli_meta_stripped.mp4'));
  });

  await run('cli metadata with neither --set nor --strip → rejected', () => {
    const r = cli('metadata', p('src.mp4'), p('cli_meta_bad.mp4'));
    if (r.status === 0) throw new Error('ran metadata with no instruction');
    if (!/--set or --strip/.test(r.stdout + r.stderr)) {
      throw new Error(`unhelpful error:\n${(r.stdout + r.stderr).slice(-300)}`);
    }
  });

  // ── stills and images ──
  await run('cli thumbnail <in> <out> --at 1 → a JPEG', () => {
    const r = cli('thumbnail', p('src.mp4'), p('cli_thumb.jpg'), '--at', '1');
    ok(r, 'thumbnail');
    const head = fs.readFileSync(p('cli_thumb.jpg')).subarray(0, 3);
    if (head[0] !== 0xff || head[1] !== 0xd8) throw new Error('not a JPEG');
  });

  await run('cli thumbnail --size 160x90 → the frame is resized', () => {
    const r = cli('thumbnail', p('src.mp4'), p('cli_thumb_sized.jpg'), '--at', '1', '--size', '160x90');
    ok(r, 'thumbnail');
    const s = probeJson(p('cli_thumb_sized.jpg'), ['-show_entries', 'stream=width,height']).streams?.[0] ?? {};
    if (s.width !== 160 || s.height !== 90) throw new Error(`size: ${s.width}x${s.height}`);
  });

  await run('cli sprite <in> <out> --columns 4 --count 8 → a sheet', () => {
    const r = cli('sprite', p('src.mp4'), p('cli_sprite.png'), '--columns', '4', '--count', '8');
    ok(r, 'sprite');
    exists(p('cli_sprite.png'));
    const s = probeJson(p('cli_sprite.png'), ['-show_entries', 'stream=width,height']).streams?.[0] ?? {};
    console.log(`      sheet: ${s.width}x${s.height}`);
  });

  await run('cli frames --outdir <dir> --fps 1 → PNG frames', () => {
    const dir = fresh('cli_frames');
    const r = cli('frames', p('src.mp4'), '--outdir', dir, '--fps', '1');
    ok(r, 'frames');
    const pngs = fs.readdirSync(dir).filter(f => f.endsWith('.png'));
    if (pngs.length < 3) throw new Error(`expected ≥3 frames, got ${pngs.length}: ${pngs.join(', ')}`);
  });

  await run('cli frames without --outdir → rejected', () => {
    const r = cli('frames', p('src.mp4'));
    if (r.status === 0) throw new Error('ran frames with no --outdir');
    if (!/--outdir/.test(r.stdout + r.stderr)) throw new Error('unhelpful error');
  });

  await run('cli gif --width 160 → an animated GIF', () => {
    const r = cli('gif', p('src.mp4'), p('cli_out.gif'), '--width', '160', '--fps', '8');
    ok(r, 'gif');
    const head = fs.readFileSync(p('cli_out.gif')).subarray(0, 6).toString('latin1');
    if (!head.startsWith('GIF8')) throw new Error(`not a GIF: ${head}`);
  });

  await run('cli waveform <in> <out.png> --width 640 → a waveform image', () => {
    const r = cli('waveform', p('src.mp4'), p('cli_wave.png'), '--width', '640', '--height', '240');
    ok(r, 'waveform');
    exists(p('cli_wave.png'));
  });

  await run('cli spectrum <in> <out> --palette fire → a spectrum video', () => {
    const r = cli('spectrum', p('src.mp4'), p('cli_spectrum.mp4'), '--palette', 'fire', '--width', '320');
    ok(r, 'spectrum');
    exists(p('cli_spectrum.mp4'));
  });

  await run('cli spectrum --palette bogus → rejected (showspectrum colours are an enum)', () => {
    const r = cli('spectrum', p('src.mp4'), p('cli_spec_bad.mp4'), '--palette', '#ff0000');
    if (r.status === 0) throw new Error('accepted a CSS colour as a spectrum palette');
    if (!/palette|color/i.test(r.stdout + r.stderr)) throw new Error('unhelpful error');
    if (fs.existsSync(p('cli_spec_bad.mp4'))) throw new Error('produced an output despite the bad palette');
  });

  // ── overlays and subtitles ──
  await run('cli watermark <in> <logo> <out> → a watermarked file', () => {
    const r = cli('watermark', p('src.mp4'), p('logo.png'), p('cli_wm.mp4'), '--position', 'bottom-right');
    ok(r, 'watermark');
    exists(p('cli_wm.mp4'));
  });

  if (HAS_DRAW_TEXT) {
    await run('cli text <in> <out> --text "hi" → a file with a text overlay', () => {
      const r = cli('text', p('src.mp4'), p('cli_text.mp4'), '--text', 'hi', '--position', 'center');
      ok(r, 'text');
      exists(p('cli_text.mp4'));
    });
  } else {
    skip('cli text', 'ffmpeg build has no drawtext filter');
  }

  await run('cli subtitles --convert srt → a converted sidecar', () => {
    const r = cli('subtitles', p('with_subs.mkv'), p('cli_subs.srt'), '--convert', 'srt');
    ok(r, 'subtitles');
    if (!fs.readFileSync(p('cli_subs.srt'), 'utf8').includes('Hello world')) {
      throw new Error('cues missing from the converted subtitle');
    }
  });

  await run('cli subtitles --convert vtt → a WEBVTT file', () => {
    const r = cli('subtitles', p('with_subs.mkv'), p('cli_subs.vtt'), '--convert', 'vtt');
    ok(r, 'subtitles');
    if (!fs.readFileSync(p('cli_subs.vtt'), 'utf8').startsWith('WEBVTT')) throw new Error('no WEBVTT header');
  });

  await run('cli subtitles --convert srt --shift 1 → cues moved later', () => {
    const r = cli('subtitles', p('with_subs.mkv'), p('cli_subs_shift.srt'), '--convert', 'srt', '--shift', '1');
    ok(r, 'subtitles');
    const m = /(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> /.exec(fs.readFileSync(p('cli_subs_shift.srt'), 'utf8'));
    if (!m) throw new Error('no cue timing found');
    const secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
    if (secs <= 0.5) throw new Error(`cue was not shifted: ${secs}`);
  });

  await run('cli subtitles --convert srt --fix-duration → cues rescaled', () => {
    const r = cli('subtitles', p('with_subs.mkv'), p('cli_subs_fixed.srt'), '--convert', 'srt', '--fix-duration');
    ok(r, 'subtitles');
    if (!/-->/.test(fs.readFileSync(p('cli_subs_fixed.srt'), 'utf8'))) throw new Error('no cue timings');
  });

  await run('cli subtitles with neither --file nor --convert → rejected', () => {
    const r = cli('subtitles', p('with_subs.mkv'), p('cli_subs_bad.srt'));
    if (r.status === 0) throw new Error('ran subtitles with no instruction');
    if (!/--file/.test(r.stdout + r.stderr) || !/--convert/.test(r.stdout + r.stderr)) {
      throw new Error(`unhelpful error:\n${(r.stdout + r.stderr).slice(-300)}`);
    }
  });

  // ── 2.1.0 feature commands ──
  await run('cli quality <ref> <dist> --metric ssim → a passing score', () => {
    const r = cli('quality', p('src.mp4'), p('lossy.mp4'), '--metric', 'ssim');
    ok(r, 'quality');
    if (!/ssim/i.test(r.stdout)) throw new Error(`no score printed: ${r.stdout.slice(-300)}`);
  });

  await run('cli quality --min 0.99 on a lossy file → non-zero exit naming both numbers', () => {
    const r = cli('quality', p('src.mp4'), p('lossy.mp4'), '--metric', 'ssim', '--min', '0.99');
    if (r.status === 0) throw new Error('exited 0 despite failing the quality gate');
    if (!/below the required minimum/.test(r.stdout + r.stderr)) {
      throw new Error(`unhelpful failure:\n${(r.stdout + r.stderr).slice(-300)}`);
    }
  });

  await run('cli quality --min 0 on a lossy file → exit 0 (the gate works both ways)', () => {
    const r = cli('quality', p('src.mp4'), p('lossy.mp4'), '--metric', 'ssim', '--min', '0');
    ok(r, 'quality');
  });

  await run('cli quality --metric psnr on identical files → prints Infinity and exits 0', () => {
    const r = cli('quality', p('src.mp4'), p('src.mp4'), '--metric', 'psnr', '--min', '0');
    ok(r, 'quality');
    if (!/Infinity/.test(r.stdout)) throw new Error(`expected Infinity in: ${r.stdout.slice(-200)}`);
  });

  if (HAS_ZSCALE && HAS_TONEMAP) {
    await run('cli tonemap <in> <out> on a real HDR file → an SDR file', () => {
      const r = cli('tonemap', p('hdr.mp4'), p('cli_tonemap.mp4'));
      ok(r, 'tonemap');
      exists(p('cli_tonemap.mp4'));
    });

    await run('cli tonemap --force on an SDR file → allowed', () => {
      // 10-bit: zscale in the builds available here fails on 8-bit input.
      const r = cli('tonemap', p('sdr10.mp4'), p('cli_tonemap_sdr.mp4'), '--force');
      ok(r, 'tonemap --force');
      exists(p('cli_tonemap_sdr.mp4'));
    });

    await run('cli tonemap on an SDR file without --force → rejected with guidance', () => {
      const r = cli('tonemap', p('sdr10.mp4'), p('cli_tonemap_bad.mp4'));
      if (r.status === 0) throw new Error('tone mapped an SDR file without --force');
      if (!/does not look like HDR/.test(r.stdout + r.stderr)) {
        throw new Error(`unhelpful error:\n${(r.stdout + r.stderr).slice(-300)}`);
      }
      if (fs.existsSync(p('cli_tonemap_bad.mp4'))) throw new Error('produced an output anyway');
    });

    await run('cli tonemap --algorithm hable → runs', () => {
      const r = cli('tonemap', p('hdr.mp4'), p('cli_tonemap_hable.mp4'), '--algorithm', 'hable', '--peak', '1000');
      ok(r, 'tonemap --algorithm');
      exists(p('cli_tonemap_hable.mp4'));
    });
  } else {
    skip('cli tonemap', 'ffmpeg build has no zscale/tonemap filters');
  }

  await run('cli interpolate --fps 30 --method dup → a 30fps file', () => {
    const r = cli('interpolate', p('src.mp4'), p('cli_interp.mp4'), '--fps', '30', '--method', 'dup');
    ok(r, 'interpolate');
    exists(p('cli_interp.mp4'));
    const rate = probeJson(p('cli_interp.mp4'), ['-show_entries', 'stream=avg_frame_rate']).streams?.[0]?.avg_frame_rate;
    if (!String(rate).startsWith('30/')) throw new Error(`avg_frame_rate: ${rate}`);
  });

  await run('cli interpolate --method bogus → rejected before ffmpeg runs', () => {
    const r = cli('interpolate', p('src.mp4'), p('cli_interp_bad.mp4'), '--fps', '30', '--method', 'bogus');
    if (r.status === 0) throw new Error('accepted an invalid interpolation method');
    if (!/unknown method "bogus"/.test(r.stdout + r.stderr)) {
      throw new Error(`unhelpful error:\n${(r.stdout + r.stderr).slice(-300)}`);
    }
    if (fs.existsSync(p('cli_interp_bad.mp4'))) throw new Error('wrote an output despite the bad method');
  });

  await run('cli interpolate without --fps → rejected', () => {
    const r = cli('interpolate', p('src.mp4'), p('cli_interp_nofps.mp4'));
    if (r.status === 0) throw new Error('interpolated with no target frame rate');
    if (!/--fps/.test(r.stdout + r.stderr)) throw new Error('unhelpful error');
  });

  await run('cli silence --threshold -50 --min 0.2 → a trimmed file', () => {
    const r = cli('silence', p('tone_gap.wav'), p('cli_silence.wav'), '--threshold', '-50', '--min', '0.2');
    ok(r, 'silence');
    exists(p('cli_silence.wav'));
    const before = duration(p('tone_gap.wav'));
    const after = duration(p('cli_silence.wav'));
    console.log(`      ${before.toFixed(2)}s → ${after.toFixed(2)}s`);
    if (!(after < before)) throw new Error(`expected shorter: ${before} → ${after}`);
  });

  await run('cli silence --detect → reports ranges instead of cutting', () => {
    const r = cli('silence', p('tone_gap.wav'), p('unused_silence.mp3'), '--threshold', '-50', '--min', '0.2', '--detect');
    ok(r, 'silence --detect');
    if (!/silent segment/.test(r.stdout)) throw new Error(`no report: ${r.stdout.slice(-300)}`);
    if (fs.existsSync(p('unused_silence.mp3'))) throw new Error('--detect wrote an output file');
  });

  await run('cli scenes <in> <out> --cut --threshold 0.1 → an auto-edited file', () => {
    const r = cli('scenes', p('cut.mp4'), p('cli_scenes.mp4'), '--threshold', '0.1', '--cut');
    ok(r, 'scenes --cut');
    exists(p('cli_scenes.mp4'));
  });

  await run('cli scenes without --cut → an edit-decision report, no output file', () => {
    const r = cli('scenes', p('cut.mp4'), p('cli_scenes_unused.mp4'), '--threshold', '0.1');
    ok(r, 'scenes');
    if (!/scene change/.test(r.stdout)) throw new Error(`no report: ${r.stdout.slice(-300)}`);
    if (fs.existsSync(p('cli_scenes_unused.mp4'))) throw new Error('wrote an output without --cut');
  });

  await run('cli scenes --cut with no output path → rejected', () => {
    const r = cli('scenes', p('cut.mp4'), '--threshold', '0.1', '--cut');
    if (r.status === 0) throw new Error('cut scenes with no output path');
  });

  await run('cli delogo --x 10 --y 10 --width 60 --height 40 → a de-logoed file', () => {
    const r = cli('delogo', p('src.mp4'), p('cli_delogo.mp4'), '--x', '10', '--y', '10', '--width', '60', '--height', '40');
    ok(r, 'delogo');
    exists(p('cli_delogo.mp4'));
  });

  await run('cli delogo missing --height → rejected naming the flag', () => {
    const r = cli('delogo', p('src.mp4'), p('cli_delogo_bad.mp4'), '--x', '0', '--y', '0', '--width', '10');
    if (r.status === 0) throw new Error('ran delogo with no --height');
    if (!/--height/.test(r.stdout + r.stderr)) throw new Error('unhelpful error');
  });

  await run('cli delogo --width 0 → rejected (nothing to blur)', () => {
    const r = cli('delogo', p('src.mp4'), p('cli_delogo_zero.mp4'), '--x', '0', '--y', '0', '--width', '0', '--height', '10');
    if (r.status === 0) throw new Error('accepted a zero-width delogo region');
    if (fs.existsSync(p('cli_delogo_zero.mp4'))) throw new Error('produced an output anyway');
  });

  // ── bitrate targets ──
  await run('cli to-bitrate --bitrate 300k --preset ultrafast → a re-encoded file', () => {
    const r = cli('to-bitrate', p('src.mp4'), p('cli_bitrate.mp4'), '--bitrate', '300k', '--preset', 'ultrafast');
    ok(r, 'to-bitrate');
    exists(p('cli_bitrate.mp4'));
  });

  await run('cli to-bitrate --maxrate → rate control reaches the command line', () => {
    const r = cli('to-bitrate', p('src.mp4'), p('cli_bitrate_vbr.mp4'),
      '--bitrate', '300k', '--preset', 'ultrafast', '--maxrate', '500k', '--bufsize', '1000k');
    ok(r, 'to-bitrate');
    exists(p('cli_bitrate_vbr.mp4'));
  });

  await run('cli twopass --bitrate 400k → a two-pass encode', () => {
    const r = cli('twopass', p('src.mp4'), p('cli_twopass.mp4'), '--bitrate', '400k');
    ok(r, 'twopass');
    exists(p('cli_twopass.mp4'));
  });

  await run('cli twopass without --bitrate → a clear error, no output', () => {
    const r = cli('twopass', p('src.mp4'), p('cli_twopass_bad.mp4'));
    if (r.status === 0) throw new Error('ran a two-pass encode with no target');
    if (!/--bitrate/.test(r.stdout + r.stderr)) {
      throw new Error(`unhelpful error:\n${(r.stdout + r.stderr).slice(-300)}`);
    }
    if (fs.existsSync(p('cli_twopass_bad.mp4'))) throw new Error('produced an output anyway');
  });

  // ── error handling ──
  await run('cli with a misspelled task flag → hard error, not a silent default run', () => {
    const r = cli('trim', p('src.mp4'), p('cli_typo.mp4'), '--star', '1');
    if (r.status === 0) throw new Error('a misspelled flag was silently ignored');
    const out = r.stdout + r.stderr;
    if (!/unknown flag --star/.test(out)) throw new Error(`unhelpful error:\n${out.slice(-300)}`);
    if (!/--start/.test(out)) throw new Error(`should list the known flags:\n${out.slice(-300)}`);
    if (fs.existsSync(p('cli_typo.mp4'))) throw new Error('produced an output despite the bad flag');
  });

  await run('cli with a non-numeric --start → clear numeric error', () => {
    const r = cli('trim', p('src.mp4'), p('cli_badnum.mp4'), '--start', 'abc');
    if (r.status === 0) throw new Error('accepted --start abc');
    if (!/--start must be a number/.test(r.stdout + r.stderr)) {
      throw new Error(`unhelpful error:\n${(r.stdout + r.stderr).slice(-300)}`);
    }
  });

  await run('cli trim with a missing input file → error, no output', () => {
    const r = cli('trim', path.join(TMP, 'nope-does-not-exist.mp4'), p('cli_missing.mp4'), '--start', '0', '--end', '1');
    if (r.status === 0) throw new Error('exited 0 for a missing input');
    if (fs.existsSync(p('cli_missing.mp4'))) throw new Error('produced an output for a missing input');
  });

  await run('every task with too few positionals exits non-zero and shows usage', () => {
    for (const name of EXPECTED_TASKS) {
      // Listing-only commands take no positionals by design, so they print
      // their listing and exit 0 instead of erroring.
      if (LISTING_ONLY.includes(name)) {
        const r = cli(name);
        ok(r, name);
        if (r.stdout.trim() === '') throw new Error(`${name} printed nothing`);
        continue;
      }
      const r = cli(name);
      if (r.status === 0) throw new Error(`${name} exited 0 with no arguments`);
      const out = r.stdout + r.stderr;
      if (!/Error:/.test(out)) throw new Error(`${name} gave no Error line:\n${out.slice(-200)}`);
      if (!out.includes(`mediaforge ${name}`)) {
        throw new Error(`${name} did not show its usage:\n${out.slice(-300)}`);
      }
    }
  });
}

// ─── 53. Library-surface commands through the real binary ─────────────────────
section('53 — CLI: library-surface commands end to end');

if (!built) {
  skip('library-surface end-to-end', 'run npm run build first');
} else {
  await run('cli filter --list → 77 filters with their option keys', () => {
    const r = cli('filter', '--list');
    ok(r, 'filter --list');
    if (!r.stdout.includes('77 filters')) throw new Error(`no count: ${r.stdout.slice(-200)}`);
    for (const n of ['unsharp', 'scale', 'volume', 'delogo', 'hqdn3d', 'sofalizer']) {
      if (!r.stdout.includes(n)) throw new Error(`filter --list omits ${n}`);
    }
  });

  await run('cli filter <name> --print → the serialised filter', () => {
    const r = cli('filter', 'unsharp', 'lx=5', 'la=1.5', '--print');
    ok(r, 'filter unsharp --print');
    if (!r.stdout.includes('unsharp=lx=5:la=1.5')) throw new Error(`bad output: ${r.stdout}`);
  });

  await run('cli filter --chain → several filters in one graph', () => {
    const r = cli('filter', '--chain', 'scale:w=320,h=240|unsharp:lx=5', '--print');
    ok(r, 'filter --chain --print');
    if (!r.stdout.includes('scale=320:240,unsharp=lx=5')) throw new Error(`bad chain: ${r.stdout}`);
  });

  await run('cli filter with a bad option name → error listing the accepted keys', () => {
    const r = cli('filter', 'unsharp', 'nope=1', '--print');
    if (r.status === 0) throw new Error('accepted an unknown option');
    if (!r.stderr.includes('has no option "nope"')) throw new Error(`no useful error: ${r.stderr}`);
    if (!r.stderr.includes('lx')) throw new Error(`did not list the accepted keys: ${r.stderr}`);
  });

  await run('cli filter with an unknown name → points at --list', () => {
    const r = cli('filter', 'notafilter', '--print');
    if (r.status === 0) throw new Error('accepted an unknown filter');
    if (!r.stderr.includes('filter --list')) throw new Error(`did not point at --list: ${r.stderr}`);
  });

  await run('cli filter unsharp → a real encode with the filter applied', () => {
    const out = p('cli_unsharp.mp4');
    const r = cli('filter', 'unsharp', 'lx=5', 'la=1.0', '--codec', 'libx264', p('src.mp4'), out);
    ok(r, 'filter unsharp');
    if (!fs.existsSync(out)) throw new Error('no output file');
  });

  await run('cli filter volume --print → an audio filter on -af', () => {
    const r = cli('filter', 'volume', 'volume=0.5', '--print');
    ok(r, 'filter volume --print');
    if (!r.stdout.includes('volume=0.5')) throw new Error(`bad output: ${r.stdout}`);
  });

  await run('cli codec --list → 36 encoder builders', () => {
    const r = cli('codec', '--list');
    ok(r, 'codec --list');
    if (!r.stdout.includes('encoder builders')) throw new Error(`no count: ${r.stdout.slice(-200)}`);
    for (const n of ['x264', 'svtav1', 'aac', 'nvenc', 'libmp3lame']) {
      if (!r.stdout.includes(n)) throw new Error(`codec --list omits ${n}`);
    }
  });

  await run('cli codec x264 crf=20 preset=slow → the encoder args', () => {
    const r = cli('codec', 'x264', 'crf=20', 'preset=slow');
    ok(r, 'codec x264');
    if (!r.stdout.includes('-c:v libx264')) throw new Error(`no codec: ${r.stdout}`);
    if (!r.stdout.includes('20')) throw new Error(`no crf: ${r.stdout}`);
  });

  await run('cli codec with no options → only the codec flag', () => {
    const r = cli('codec', 'x264');
    ok(r, 'codec x264 (no options)');
    if (!r.stdout.includes('-c:v libx264')) throw new Error(`no codec: ${r.stdout}`);
    if (r.stdout.includes('-crf')) throw new Error(`invented a quality value: ${r.stdout}`);
  });

  await run('cli args --list → the arg-builder table', () => {
    const r = cli('args', '--list');
    ok(r, 'args --list');
    if (!r.stdout.includes('arg builders')) throw new Error(`no count: ${r.stdout.slice(-200)}`);
    for (const n of ['screenshot', 'hls', 'two-pass', 'hw-chain', 'var-stream-map']) {
      if (!r.stdout.includes(n)) throw new Error(`args --list omits ${n}`);
    }
  });

  await run('cli args screenshot → the exact ffmpeg argv', () => {
    const r = cli('args', 'screenshot', 'input=in.mp4', 'output=out.jpg', 'timestamp=2.5');
    ok(r, 'args screenshot');
    for (const frag of ['-ss 2.5', '-i in.mp4', '-vframes 1', 'out.jpg']) {
      if (!r.stdout.includes(frag)) throw new Error(`missing "${frag}": ${r.stdout}`);
    }
  });

  await run('cli args with a missing required key → error naming the keys', () => {
    const r = cli('args', 'screenshot', 'input=in.mp4');
    if (r.status === 0) throw new Error('accepted a partial arg list');
    if (!r.stderr.includes('output=<value>')) throw new Error(`did not name the missing key: ${r.stderr}`);
  });

  await run('cli args var-stream-map → the -var_stream_map value', () => {
    const variants = JSON.stringify([
      { name: '360p', resolution: '640x360', videoBitrate: '800k', audioBitrate: '64k' },
      { name: '720p', resolution: '1280x720', videoBitrate: '2500k', audioBitrate: '128k' },
    ]);
    const r = cli('args', 'var-stream-map', `variants=${variants}`);
    ok(r, 'args var-stream-map');
    if (!r.stdout.includes('v:0,a:0,name:360p')) throw new Error(`bad map: ${r.stdout}`);
    if (!r.stdout.includes('stream count: 2')) throw new Error(`bad count: ${r.stdout}`);
  });

  await run('cli args hw-chain → an upload/scale/download chain', () => {
    const r = cli('args', 'hw-chain', 'accel=cuda', 'gpuFilters=["scale_cuda=1280:720"]');
    ok(r, 'args hw-chain');
    if (!r.stdout.includes('hwupload')) throw new Error(`no upload: ${r.stdout}`);
    if (!r.stdout.includes('hwdownload=format=nv12')) throw new Error(`no download: ${r.stdout}`);
  });

  await run('cli args abr-validate rejects a malformed ladder', () => {
    const bad = JSON.stringify([{ name: '', resolution: 'nope', videoBitrate: '' }]);
    const r = cli('args', 'abr-validate', `variants=${bad}`);
    if (r.status === 0) throw new Error('accepted a malformed ladder');
  });

  await run('cli map --print → -map arguments from the DSL', () => {
    const r = cli('map', 'in.mp4', 'out.mp4', '--video', 'all', '--audio', '0', '--disposition', 'a:0=default+forced', '--print');
    ok(r, 'map --print');
    for (const frag of ['-map 0:v', '-map 0:a:0', '-disposition:a:0 default+forced']) {
      if (!r.stdout.includes(frag)) throw new Error(`missing "${frag}": ${r.stdout}`);
    }
  });

  await run('cli map with nothing selected → error listing the selectors', () => {
    const r = cli('map', 'in.mp4', 'out.mp4');
    if (r.status === 0) throw new Error('accepted an empty selection');
    if (!r.stderr.includes('--all')) throw new Error(`did not list the selectors: ${r.stderr}`);
  });

  await run('cli map in.mp4 out.mp4 --video all → a real remux', () => {
    const out = p('cli_map.mp4');
    const r = cli('map', p('src.mp4'), out, '--video', 'all', '--audio', 'all');
    ok(r, 'map remux');
    if (!fs.existsSync(out)) throw new Error('no output file');
  });

  await run('cli preset --list → every preset with its arguments', () => {
    const r = cli('preset', '--list');
    ok(r, 'preset --list');
    for (const n of ['web', 'web-hq', 'podcast', 'prores']) {
      if (!r.stdout.includes(n)) throw new Error(`preset --list omits ${n}`);
    }
  });

  await run('cli preset web --print → the full command line', () => {
    const r = cli('preset', 'web', 'in.mp4', 'out.mp4', '--print');
    ok(r, 'preset web --print');
    for (const frag of ['-i in.mp4', '-c:v libx264', '-crf 23', '-c:a aac', 'out.mp4']) {
      if (!r.stdout.includes(frag)) throw new Error(`missing "${frag}": ${r.stdout}`);
    }
  });

  await run('cli preset with an unknown name → error listing the presets', () => {
    const r = cli('preset', 'nope', 'in.mp4', 'out.mp4', '--print');
    if (r.status === 0) throw new Error('accepted an unknown preset');
    if (!r.stderr.includes('web-hq')) throw new Error(`did not list the presets: ${r.stderr}`);
  });

  await run('cli analyze <file> → a structured media report', () => {
    const r = cli('analyze', p('src.mp4'));
    ok(r, 'analyze');
    const report = JSON.parse(r.stdout);
    for (const key of ['file', 'format', 'durationSec', 'video', 'audio', 'chapters', 'hdr', 'interlaced']) {
      if (!(key in report)) throw new Error(`report has no "${key}": ${r.stdout.slice(0, 300)}`);
    }
    if (report.video.length === 0) throw new Error('no video streams reported');
    if (report.video[0].width === undefined) throw new Error('no video width reported');
  });

  await run('cli features → the feature gate table for the installed binary', () => {
    const r = cli('features');
    ok(r, 'features');
    if (!/ffmpeg \d+\.\d+/.test(r.stdout)) throw new Error(`no version banner: ${r.stdout.slice(-200)}`);
    if (!/expected/.test(r.stdout)) throw new Error(`no gate summary: ${r.stdout.slice(-200)}`);
  });

  await run('cli features --ffmpeg-version 6.1 --missing → only the unavailable gates', () => {
    const r = cli('features', '--ffmpeg-version', '6.1', '--missing');
    ok(r, 'features --missing');
    if (!r.stdout.includes('ffmpeg 6.1')) throw new Error(`wrong version banner: ${r.stdout.slice(-200)}`);
    if (/\byes\b/.test(r.stdout)) throw new Error(`listed available gates with --missing: ${r.stdout.slice(-300)}`);
  });

  await run('cli hwaccel --list → every known accelerator', () => {
    const r = cli('hwaccel', '--list');
    ok(r, 'hwaccel --list');
    for (const a of ['cuda', 'vaapi', 'qsv']) {
      if (!r.stdout.includes(a)) throw new Error(`hwaccel --list omits ${a}`);
    }
  });

  await run('cli hwaccel with an unknown accelerator → error listing them', () => {
    const r = cli('hwaccel', 'nope', 'in.mp4', 'out.mp4');
    if (r.status === 0) throw new Error('accepted an unknown accelerator');
    if (!r.stderr.includes('cuda')) throw new Error(`did not list the accelerators: ${r.stderr}`);
  });

  await run('cli hwaccel <name> --print → the hardware filter chain', () => {
    const r = cli('hwaccel', 'cuda', 'in.mp4', 'out.mp4', '--width', '1280', '--height', '720', '--print');
    ok(r, 'hwaccel --print');
    if (!r.stdout.includes('hwupload')) throw new Error(`no upload: ${r.stdout}`);
    if (!r.stdout.includes('scale_cuda')) throw new Error(`no gpu scale: ${r.stdout}`);
  });

  await run('cli graph --print → a -filter_complex string from the pipeline', () => {
    const pipeline = JSON.stringify([
      { from: '0:v', filter: 'scale', args: ['1280', '720'], out: 'scaled' },
      { from: 'scaled', filter: 'unsharp', named: { lx: '5' } },
    ]);
    const r = cli('graph', 'in.mp4', 'out.mp4', '--pipeline', pipeline, '--print');
    ok(r, 'graph --print');
    if (!r.stdout.includes('scale=1280:720')) throw new Error(`no scale: ${r.stdout}`);
    if (!r.stdout.includes('[scaled]')) throw new Error(`no label: ${r.stdout}`);
  });

  await run('cli graph with malformed pipeline JSON → a useful error', () => {
    const r = cli('graph', 'in.mp4', 'out.mp4', '--pipeline', '{not json');
    if (r.status === 0) throw new Error('accepted malformed JSON');
    if (!r.stderr.includes('JSON')) throw new Error(`no useful error: ${r.stderr}`);
  });

  await run('cli graph with a valid pipeline → a real transcode', () => {
    const out = p('cli_graph.mp4');
    const pipeline = JSON.stringify([
      { from: '0:v', filter: 'scale', args: ['160', '90'], out: 'v' },
      { from: 'v', filter: 'unsharp', named: { lx: '5' } },
    ]);
    const r = cli('graph', p('src.mp4'), out, '--pipeline', pipeline, '--map', '0:a');
    ok(r, 'graph encode');
    if (!fs.existsSync(out)) throw new Error('no output file');
  });

  await run('cli stack <output> <a> <b> → a real hstack', () => {
    const out = p('cli_stack.mp4');
    const r = cli('stack', out, p('src.mp4'), p('src.mp4'), '--direction', 'hstack');
    ok(r, 'stack hstack');
    if (!fs.existsSync(out)) throw new Error('no output file');
  });

  await run('cli loop <input> <output> --times 2 → a longer file', () => {
    const out = p('cli_loop.mp4');
    const r = cli('loop', p('src.mp4'), out, '--times', '2');
    ok(r, 'loop');
    if (!fs.existsSync(out)) throw new Error('no output file');
  });

  await run('cli aspect <input> <output> --ratio 1:1 → a square crop', () => {
    const out = p('cli_aspect.mp4');
    const r = cli('aspect', p('src.mp4'), out, '--ratio', '1:1');
    ok(r, 'aspect 1:1');
    if (!fs.existsSync(out)) throw new Error('no output file');
  });

  await run('cli gif2mp4 <gif> <mp4> → a real conversion', async () => {
    await toGif({ input: p('src.mp4'), output: p('cli.gif'), fps: 8, width: 80 });
    const out = p('cli_gif2mp4.mp4');
    const r = cli('gif2mp4', p('cli.gif'), out, '--width', '80');
    ok(r, 'gif2mp4');
    if (!fs.existsSync(out)) throw new Error('no output file');
  });

  await run('cli deinterlace and timecode → real encodes', async () => {
    const a = p('cli_deint.mp4');
    ok(cli('deinterlace', p('src.mp4'), a, '--mode', '0'), 'deinterlace');
    if (!fs.existsSync(a)) throw new Error('no deinterlace output');
    const b = p('cli_tc.mp4');
    ok(cli('timecode', p('src.mp4'), b, '--position', 'bl'), 'timecode');
    if (!fs.existsSync(b)) throw new Error('no timecode output');
  });

  await run('every library-surface command has --help', () => {
    for (const name of [
      'filter', 'graph', 'codec', 'map', 'preset', 'analyze', 'features',
      'hwaccel', 'args', 'mix', 'loop', 'deinterlace', 'stabilize', 'aspect',
      'lut', 'timecode', 'cropdetect', 'gif2mp4', 'extract-subs', 'retime-subs', 'stack',
    ]) {
      const r = cli(name, '--help');
      ok(r, `${name} --help`);
      if (!r.stdout.includes(`mediaforge ${name}`)) throw new Error(`${name} --help has no usage line`);
      if (!r.stdout.includes('OPTIONS')) throw new Error(`${name} --help has no OPTIONS block`);
    }
  });

  await run('a misspelled flag is rejected for the new commands too', () => {
    for (const args of [
      ['filter', 'unsharp', '--print', '--sharpness', '5'],
      ['analyze', 'in.mp4', '--jsn'],
      ['preset', 'web', 'in.mp4', 'out.mp4', '--crff', '20'],
    ]) {
      const r = cli(...args);
      if (r.status === 0) throw new Error(`${args[0]} accepted --${args[args.length - 1]!.replace(/^--/, '')}`);
      if (!r.stderr.includes('unknown flag')) throw new Error(`${args[0]}: no unknown-flag error: ${r.stderr}`);
      if (!r.stderr.includes('Known flags:')) throw new Error(`${args[0]}: no list of known flags`);
    }
  });
}

// ─── summary ────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log('  CLI BATTLE TEST SUMMARY');
console.log('═'.repeat(60));
console.log(`  ✅ PASSED : ${passed}`);
console.log(`  ⏭  SKIPPED: ${skipped}`);
console.log(`  ❌ FAILED : ${errors.length}`);

if (errors.length > 0) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  FAILED TESTS — FULL ERROR LOG');
  console.log('─'.repeat(60));
  for (let i = 0; i < errors.length; i++) {
    console.log(`\n  [${i + 1}] ${errors[i]!.label}`);
    console.log(`       ERROR : ${errors[i]!.error}`);
    const stackLines = errors[i]!.stack.split('\n').slice(1, 4).join('\n       ');
    if (stackLines) console.log(`       STACK : ${stackLines}`);
  }
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${errors.length} test(s) failed. See above for details.`);
  console.log('─'.repeat(60));
  process.exit(1);
} else {
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('\n  All CLI tests passed! 🎉');
}
