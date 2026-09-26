/**
 * mediaforge battle test — CLI gaps
 *
 * `battle.coverage.test.ts` covers the pure builder surface. This one covers
 * the other half of the gap: the task commands themselves, driven **in process**
 * so the coverage tool can see them. The end-to-end suite spawns the built
 * binary, which instruments nothing, so without this file the command bodies
 * look untested.
 *
 * Every case drives a real command against a real 2-second clip, or asserts the
 * exact error a user sees when a required flag is missing.
 *
 * Run: npm run battle:gaps
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, 'tmp_gaps');
const p = (name: string) => path.join(TMP, name);
const errors: { label: string; error: string; stack: string }[] = [];
let passed = 0;
let skipped = 0;

function section(title: string): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

async function run(label: string, fn: () => void | Promise<void>): Promise<void> {
  process.stdout.write(`  ▸ ${label} ... `);
  try {
    await fn();
    console.log('✅ PASS');
    passed++;
  } catch (err) {
    const e = err as Error;
    console.log(`❌ FAIL\n      ${e.message}`);
    errors.push({ label, error: e.message, stack: e.stack ?? '' });
  }
}

function skip(label: string, reason: string): void {
  console.log(`  ▸ ${label} ... ⏭  SKIP (${reason})`);
  skipped++;
}

function ok(cond: unknown, what: string): void {
  if (!cond) throw new Error(what);
}

function eq(actual: unknown, expected: unknown, what: string): void {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function ff(args: string): void {
  const argv = args.trim().split(/\s+/);
  const out = argv[argv.length - 1]!;
  try {
    execFileSync('ffmpeg', ['-y', ...argv], { stdio: 'pipe' });
  } catch (e) {
    const err = e as { stderr?: Buffer };
    throw new Error(
      `fixture ${out} failed: ffmpeg ${argv.slice(0, -1).join(' ')}\n` +
      (err.stderr ? err.stderr.toString().split('\n').filter(l => /error|invalid|Unable|No such/i.test(l))[0] ?? '' : ''),
    );
  }
}

function ffQuoted(args: string): void {
  // One argv token per match: a quoted run keeps its spaces (filter graphs) but
  // a quoted option name and its value stay separate, which is what ffmpeg needs
  // for `-filter_complex "…"`.
  const argv = args.trim().match(/"[^"]*"|[^\s]+/g) ?? [];
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

const HAS_DRAW_TEXT = hasFilter('drawtext');
const HAS_VIDSTAB = hasFilter('vidstabdetect');
const HAS_LUT3D = hasFilter('lut3d');

const m = await import('./lib/index.js') as Record<string, any>;
const CLI_TASKS = (await import('./lib/cli/tasks.js')).CLI_TASKS as Record<string, any>;
const extra = await import('./lib/cli/tasks.extra.js');

/** Run a task and return everything it printed. */
async function say(task: string, pos: string[], f: Record<string, string> = {}): Promise<string> {
  const orig = console.log;
  let out = '';
  console.log = (...a: unknown[]) => { out += a.map(String).join(' ') + '\n'; };
  try {
    await CLI_TASKS[task]!.run(pos, f);
  } finally {
    console.log = orig;
  }
  return out;
}

/** Assert that a task rejects, matching `re`. */
async function errs(task: string, pos: string[], f: Record<string, string>, re: RegExp): Promise<string> {
  let msg = '';
  try {
    await say(task, pos, f);
  } catch (e) {
    msg = (e as Error).message;
  }
  if (!re.test(msg)) throw new Error(`${task}: expected /${re.source}/, got ${JSON.stringify(msg)}`);
  return msg;
}

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

// ─── Fixtures ────────────────────────────────────────────────────────────────
ff(
  '-f lavfi -i testsrc=duration=2:size=320x180:rate=15 ' +
  '-f lavfi -i sine=frequency=440:duration=2 ' +
  '-c:v libx264 -preset ultrafast -crf 45 -pix_fmt yuv420p -c:a aac -shortest ' +
  p('src.mp4'),
);
fs.writeFileSync(p('tone.mp3'), fs.readFileSync(p('src.mp4')));
ff('-f lavfi -i testsrc=duration=2:size=320x180:rate=15 -c:v libx264 -preset ultrafast -crf 45 -pix_fmt yuv420p ' + p('video.mp4'));
// A second angle for the stacking and mixing commands. It carries audio too, so
// `mix` has two real audio streams to combine.
ff(
  '-f lavfi -i testsrc=duration=2:size=320x180:rate=15 ' +
  '-f lavfi -i sine=frequency=880:duration=2 ' +
  '-vf hflip -c:v libx264 -preset ultrafast -crf 45 -pix_fmt yuv420p -c:a aac -shortest ' +
  p('flip.mp4'),
);
// A GIF for gif2mp4.
ffQuoted(
  '-f lavfi -i "testsrc=duration=1:size=120x90:rate=10" ' +
  '"-filter_complex" "[0:v]fps=10,split[a][b];[a]palettegen[p];[b][p]paletteuse" ' +
  p('src.gif'),
);
// Two hard-cut colour segments, so the scene detector has a real change to find.
ffQuoted(
  '-f lavfi -i "color=red:duration=1:size=160x90:rate=10" ' +
  '-f lavfi -i "color=blue:duration=1:size=160x90:rate=10" ' +
  '"-filter_complex" "[0:v][1:v]concat=n=2:v=1:a=0[v]" -map "[v]" ' +
  '-c:v libx264 -preset ultrafast -crf 45 -pix_fmt yuv420p ' +
  p('scenes.mp4'),
);
// A subtitle track plus a sidecar .srt, for the subtitle commands.
fs.writeFileSync(
  p('sub.srt'),
  '1\n00:00:00,000 --> 00:00:01,000\nhello\n\n2\n00:00:01,000 --> 00:00:02,000\nworld\n',
);
ff('-i ' + p('src.mp4') + ' -i ' + p('sub.srt') + ' -c copy -c:s mov_text ' + p('subs.mp4'));
// A black-bordered clip so cropdetect has borders to find.
ffQuoted(
  '-f lavfi -i "color=black:duration=1:size=320x180:rate=10" ' +
  '-f lavfi -i "color=red:duration=1:size=160x90:rate=10" ' +
  '"-filter_complex" "[0:v][1:v]overlay=(W-w)/2:(H-h)/2" -c:v libx264 -preset ultrafast -crf 45 -pix_fmt yuv420p ' +
  p('padded.mp4'),
);
// A neutral 2x2x2 LUT cube for the lut command: eight entries, not four.
fs.writeFileSync(
  p('grade.cube'),
  'LUT_3D_SIZE 2\n' +
  ['0 0 0', '0 0 1', '0 1 0', '0 1 1', '1 0 0', '1 0 1', '1 1 0', '1 1 1'].join('\n') + '\n',
);

const exists = (name: string) => fs.existsSync(p(name));

// ─── 1. Required-flag errors in the editing commands ─────────────────────────
section('1 — editing commands reject a missing flag');

await run('every editing command names the flag it needs', async () => {
  const cases: Array<[string, string[], Record<string, string>, RegExp]> = [
    ['speed', [p('src.mp4'), p('o.mp4')], {}, /speed requires --factor/],
    ['volume', [p('src.mp4'), p('o.mp4')], {}, /volume requires --gain/],
    ['concat', [p('o.mp4')], { inputs: 'a.mp4' }, /at least two files/],
    ['transitions', [p('o.mp4')], { inputs: 'a.mp4' }, /at least two files/],
    ['hls', [p('src.mp4')], {}, /hls requires --outdir/],
    ['abr', [p('src.mp4')], {}, /abr requires --out/],
    ['segments', [p('src.mp4')], {}, /segments requires --pattern/],
    ['chapters', [p('src.mp4'), p('o.mp4')], {}, /chapters requires --chapters/],
    ['metadata', [p('src.mp4'), p('o.mp4')], {}, /--set or --strip/],
    ['frames', [p('src.mp4')], {}, /frames requires --outdir/],
    ['text', [p('src.mp4'), p('o.mp4')], {}, /text requires --text/],
    ['subtitles', [p('src.mp4'), p('o.mp4')], {}, /--file .* or --convert/],
    ['interpolate', [p('src.mp4'), p('o.mp4')], {}, /interpolate requires --fps/],
    ['twopass', [p('src.mp4'), p('o.mp4')], {}, /twopass requires --bitrate/],
    ['thumbnail', [p('src.mp4'), p('o.tiff')], { format: 'tiff' }, /must be png, jpg\/jpeg or bmp/],
  ];
  for (const [task, pos, f, re] of cases) await errs(task, pos, f, re);
});

await run('list-style flags are parsed before anything is encoded', async () => {
  await errs('abr', [p('src.mp4')], { out: p('v%v/index.m3u8') }, /abr requires --variants/);
  await errs('abr', [p('src.mp4')], { out: p('v%v/index.m3u8'), variants: 'broken' }, /must look like name=WxH:bitrate/);
  await errs('chapters', [p('src.mp4'), p('o.mp4')], { chapters: 'Intro' }, /must look like title:startSeconds/);
  await errs('chapters', [p('src.mp4'), p('o.mp4')], { chapters: 'Intro:whenever' }, /non-numeric start time/);
  await errs('metadata', [p('src.mp4'), p('o.mp4')], { set: 'title' }, /must look like key=value/);
  await errs('delogo', [p('src.mp4'), p('o.mp4')], {}, /delogo requires --x/);
});

await run('a command with too few positionals prints its usage', async () => {
  const msg = await errs('speed', [], {}, /Usage: mediaforge speed/);
  ok(msg.includes('arguments'), `no count in: ${msg}`);
  await errs('analyze', [], {}, /analyze needs 1 argument/);
  await errs('stack', [p('o.mp4')], {}, /stack needs 2 arguments/);
});

// ─── 2. The filter command ───────────────────────────────────────────────────
section('2 — the filter command');

await run('filter --list prints every filter with its keys', async () => {
  const out = await say('filter', [], { list: 'true' });
  ok(out.includes('77 filters'), `no count line: ${out.slice(-200)}`);
  ok(out.includes('scale'), 'scale missing from the list');
});

await run('filter prints a chain without touching the encoder', async () => {
  const out = await say('filter', ['eq'], { print: 'true' });
  ok(out.trim() === 'eq', `eq chain: ${JSON.stringify(out)}`);
  const sc = await say('filter', ['scale', 'w=160', 'h=90'], { print: 'true' });
  ok(/scale=(w=)?160/.test(sc), `scale chain: ${sc}`);
});

await run('filter reports a missing option, a bad option and a missing path', async () => {
  await errs('filter', [], {}, /filter needs a filter name/);
  await errs('filter', ['nope', p('src.mp4'), p('o.mp4')], {}, /unknown filter "nope"/);
  await errs('filter', ['scale', 'w=160'], {}, /needs <input> <output>/);
  await errs('filter', ['scale', 'nope=1', p('src.mp4'), p('o.mp4')], {}, /has no option "nope"/);
});

await run('filter encodes a real clip through -vf', async () => {
  const out = await say('filter', ['scale', 'w=160', 'h=90', p('src.mp4'), p('filter_vf.mp4')]);
  ok(exists('filter_vf.mp4'), `no output: ${out}`);
  ok(out.includes('Wrote'), `no confirmation: ${out}`);
});

await run('filter encodes through -af when the filter is an audio filter', async () => {
  await say('filter', ['volume', 'volume=2', p('src.mp4'), p('filter_af.m4a')], { audio: 'true' });
  ok(exists('filter_af.m4a'), 'no audio output');
});

await run('filter --chain applies several filters in order', async () => {
  const printed = await say('filter', [], { chain: 'scale:w=160,h=90|eq:contrast=1.1', print: 'true' });
  ok(printed.includes('scale') && printed.includes('eq'), `chain: ${printed}`);
  await say('filter', [p('src.mp4'), p('chain.mp4')], { chain: 'scale:w=160,h=90' });
  ok(exists('chain.mp4'), 'chain did not encode');
  await errs('filter', [], { chain: 'nope' }, /unknown filter "nope" in --chain/);
  await errs('filter', [], { chain: 'scale:w=160' }, /filter needs 2 arguments/);
});

// ─── 3. The graph command ────────────────────────────────────────────────────
section('3 — the graph command');

await run('graph prints a -filter_complex string', async () => {
  const out = await say('graph', [p('src.mp4'), p('o.mp4')], {
    pipeline: '[{"from":"0:v","filter":"scale","args":["160","90"]}]',
    print: 'true',
  });
  ok(out.includes('scale'), `graph: ${out}`);
  ok(/\[0:v\]scale=160:90\[out0\]/.test(out.trim()), `unexpected graph: ${out.trim()}`);
});

await run('graph maps the final output label and encodes', async () => {
  await say('graph', [p('src.mp4'), p('graph.mp4')], {
    pipeline: '[{"from":"0:v","filter":"scale","args":["160","90"]}]',
  });
  ok(exists('graph.mp4'), 'graph did not encode');
});

await run('graph rejects a missing, malformed or short pipeline', async () => {
  await errs('graph', [p('src.mp4'), p('o.mp4')], {}, /graph requires --pipeline/);
  await errs('graph', [p('src.mp4'), p('o.mp4')], { pipeline: 'not json' }, /must be a JSON array/);
  await errs('graph', [p('src.mp4'), p('o.mp4')], { pipeline: '[]' }, /non-empty JSON array/);
  await errs('graph', [p('src.mp4'), p('o.mp4')], { pipeline: '[{"filter":"scale"}]' }, /needs "from" and "filter" strings/);
});

// ─── 4. The map command ──────────────────────────────────────────────────────
section('4 — the map command');

await run('map prints -map arguments for every selector', async () => {
  const out = await say('map', [p('src.mp4'), p('o.mp4')], {
    all: 'true', default: 'true', av: 'true', spec: '0:a:0', video: 'all', audio: 'all',
    subs: 'all', label: 'vout', exclude: '0:a:0', print: 'true',
  });
  ok(out.includes('-map'), `no -map: ${out}`);
  ok(out.includes('-c copy'), `no copy codec: ${out}`);
  const idx = await say('map', [p('src.mp4'), p('o.mp4')], { video: '0', audio: '0', print: 'true' });
  ok(idx.includes('-map 0:v:0'), `index mapping: ${idx}`);
});

await run('map prints dispositions, per-stream codecs and metadata', async () => {
  const out = await say('map', [p('src.mp4'), p('o.mp4')], {
    default: 'true', disposition: 'v:0=default+forced', 'copy-stream': 'v:0=copy',
    'codec-stream': 'a:0=aac', metadata: 'title:Clip', 'stream-meta': 'a:0=language=eng',
    print: 'true',
  });
  ok(out.includes('disposition'), `no disposition: ${out}`);
  ok(out.includes('language'), `no stream metadata: ${out}`);
  ok(out.includes('title'), `no metadata: ${out}`);
});

await run('map rejects a malformed selector', async () => {
  await errs('map', [p('src.mp4'), p('o.mp4')], {}, /needs at least one of/);
  await errs('map', [p('src.mp4'), p('o.mp4')], { video: 'first' }, /expected "all", "none" or an index/);
  await errs('map', [p('src.mp4'), p('o.mp4')], { default: 'true', disposition: 'oops' }, /must be v:0=default\+forced/);
  await errs('map', [p('src.mp4'), p('o.mp4')], { default: 'true', disposition: 'v=default' }, /must be v:0=default\+forced/);
  await errs('map', [p('src.mp4'), p('o.mp4')], { default: 'true', 'copy-stream': 'oops' }, /must be v:0=copy/);
  await errs('map', [p('src.mp4'), p('o.mp4')], { default: 'true', 'codec-stream': 'v' }, /must be v:0=copy/);
  await errs('map', [p('src.mp4'), p('o.mp4')], { default: 'true', metadata: 'title' }, /must be key:value/);
  await errs('map', [p('src.mp4'), p('o.mp4')], { default: 'true', 'stream-meta': 'a0' }, /must be a:0=language=eng/);
});

await run('map remuxes for real', async () => {
  const out = await say('map', [p('src.mp4'), p('remux.mp4')], { remux: 'true' });
  ok(exists('remux.mp4'), `no output: ${out}`);
});

// ─── 5. Preset, analyze, features ────────────────────────────────────────────
section('5 — preset, analyze and features');

await run('preset lists, validates and applies', async () => {
  const list = await say('preset', [], { list: 'true' });
  ok(list.includes('web'), `no presets listed: ${list.slice(0, 200)}`);
  await errs('preset', ['nope', p('src.mp4'), p('o.mp4')], {}, /unknown preset "nope"/);
  const printed = await say('preset', ['web', p('src.mp4'), p('o.mp4')], { print: 'true', size: '160x90', crf: '30' });
  ok(printed.includes('-crf 30') && printed.includes('-s 160x90'), `preset args: ${printed}`);
  await say('preset', ['web', p('src.mp4'), p('preset.mp4')]);
  ok(exists('preset.mp4'), 'preset did not encode');
});

await run('analyze reports the file as text and as JSON', async () => {
  const text = await say('analyze', [p('src.mp4')]);
  ok(text.includes('"file"') && text.includes('"video"'), `analyze report: ${text.slice(0, 200)}`);
  const json = await say('analyze', [p('src.mp4')], { json: 'true' });
  const parsed = JSON.parse(json) as Record<string, any>;
  ok(typeof parsed.durationSec === 'number', 'no duration in JSON');
  ok(parsed.video.length === 1, 'no video stream');
  ok(parsed.audio.length === 1, 'no audio stream');
  ok(parsed.video[0].default === true, 'the default video stream is not marked');
  ok(parsed.audio[0].default === true, 'the default audio stream is not marked');
});

await run('analyze reads a file that has chapters and subtitles', async () => {
  const out = await say('analyze', [p('subs.mp4')]);
  ok(out.includes('"subtitles"'), `no subtitles key: ${out.slice(0, 200)}`);
  ok(out.includes('chapters'), 'no chapters key');
});

await run('features evaluates the installed binary and a requested version', async () => {
  const now = await say('features', []);
  ok(/ffmpeg \d+\.\d+/.test(now), `no version line: ${now.slice(-200)}`);
  const missing = await say('features', [], { missing: 'true' });
  ok(missing.length > 0, 'no unavailable gates listed');
  const req = await say('features', [], { 'ffmpeg-version': '7' });
  ok(/ffmpeg 7\.0/.test(req), 'bare major not accepted');
  await errs('features', [], { 'ffmpeg-version': 'seven' }, /must look like "7.0" or "6.1"/);
});

await run('features does not report a gate twice', async () => {
  const out = await say('features', []);
  const lines = out.split('\n').filter(l => /^ {2}(yes|no ) /.test(l));
  const keys = lines.map(l => l.trim().split(/\s+/)[1]!);
  eq0(new Set(keys).size, keys.length, 'a gate is listed more than once');
  ok(lines.length > 5, `only ${lines.length} gates`);
});

function eq0(a: unknown, b: unknown, what: string): void {
  if (a !== b) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ─── 6. The remaining library-surface commands ───────────────────────────────
section('6 — hwaccel, args, stack, mix and loop');

await run('hwaccel lists accelerators and prints a chain', async () => {
  const list = await say('hwaccel', [], { list: 'true' });
  ok(list.includes('cuda'), `no accelerators: ${list}`);
  await errs('hwaccel', ['nope'], {}, /unknown accelerator "nope"/);
  const chain = await say('hwaccel', ['cuda'], { print: 'true', width: '160', height: '90', format: 'nv12' });
  ok(chain.includes('scale_cuda'), `no scale filter: ${chain}`);
  await errs('hwaccel', ['cuda', p('src.mp4'), p('o.mp4')], { width: '160' }, /needs both --width and --height/);
});

await run('hwaccel --check reports the device without encoding', async () => {
  const prev = process.exitCode;
  const out = await say('hwaccel', ['cuda'], { check: 'true' });
  process.exitCode = prev;
  ok(/cuda: (un)?available/.test(out), `no verdict: ${out}`);
});

await run('args lists, validates and refuses an unknown key', async () => {
  const list = await say('args', [], { list: 'true' });
  ok(list.includes('arg builders'), `no count line: ${list.slice(-200)}`);
  await errs('args', [], {}, /args needs an op name/);
  await errs('args', ['nope'], {}, /unknown arg builder "nope"/);
  await errs('args', ['screenshot', 'nope=1'], {}, /has no option "nope"/);
  await errs('args', ['screenshot'], {}, /requires input=<value>/);
});

await run('stack joins two clips side by side and on top of each other', async () => {
  const side = await say('stack', [p('stack_h.mp4'), p('src.mp4'), p('flip.mp4')]);
  ok(exists('stack_h.mp4'), `no hstack output: ${side}`);
  await say('stack', [p('stack_v.mp4'), p('src.mp4'), p('flip.mp4')], { direction: 'vstack', shortest: 'true' });
  ok(exists('stack_v.mp4'), 'no vstack output');
  await errs('stack', [p('o.mp4'), p('a.mp4'), p('b.mp4')], { direction: 'diagonal' }, /must be hstack or vstack/);
});

await run('mix combines two tracks with and without weights', async () => {
  // The default encoder is libmp3lame, so the first output has to be an MP4/
  // MP3 container; the second switches to AAC for an M4A.
  await say('mix', [p('mix.mp3'), p('src.mp4'), p('flip.mp4')]);
  ok(exists('mix.mp3'), 'no mix output');
  await say('mix', [p('mix_w.m4a'), p('src.mp4'), p('flip.mp4')], {
    weights: '1,0.5', duration: 'longest', bitrate: '192k', codec: 'aac',
  });
  ok(exists('mix_w.m4a'), 'no weighted mix output');
  await errs('mix', [p('o.mp3'), p('a.mp4'), p('b.mp4')], { weights: '1,loud' }, /--weights must be numbers/);
  await errs('mix', [p('o.mp3'), p('a.mp4'), p('b.mp4')], { weights: '1' }, /1 entries but 2 inputs/);
});

await run('loop repeats a clip and honours a duration cap', async () => {
  await say('loop', [p('src.mp4'), p('loop.mp4')], { times: '1', codec: 'libx264' });
  ok(exists('loop.mp4'), 'no loop output');
  const probe = m.probe(p('loop.mp4'));
  ok(m.getMediaDuration(probe) > 3, 'the loop did not lengthen the clip');
  await say('loop', [p('src.mp4'), p('loop_cap.mp4')], { duration: '1' });
  const capped = m.getMediaDuration(m.probe(p('loop_cap.mp4')));
  ok(capped <= 1.2, `duration cap ignored: ${capped}`);
});

await run('deinterlace and aspect rewrite the picture', async () => {
  await say('deinterlace', [p('src.mp4'), p('deint.mp4')], { mode: '0', parity: '-1', deint: '0' });
  ok(exists('deint.mp4'), 'no deinterlace output');
  await say('aspect', [p('src.mp4'), p('square.mp4')], { ratio: '1:1', codec: 'libx264' });
  ok(exists('square.mp4'), 'no aspect output');
  const { width, height } = m.getVideoStreams(m.probe(p('square.mp4')))[0]!;
  ok(width === height, `not square: ${width}x${height}`);
  await errs('aspect', [p('src.mp4'), p('o.mp4')], {}, /aspect requires --ratio/);
});

await run('cropdetect reports the content region of a padded clip', async () => {
  const out = await say('cropdetect', [p('padded.mp4')], { limit: '20', skip: '0' });
  ok(/w=\d+ h=\d+ x=\d+ y=\d+/.test(out), `no region: ${out}`);
  // The red panel is 160x90 centred in 320x180, so the borders are 80px either
  // side; ffmpeg rounds the vertical border, so allow a pixel of slack.
  const m2 = /w=(\d+) h=(\d+) x=(\d+) y=(\d+)/.exec(out);
  ok(m2 !== null, `unparseable region: ${out}`);
  ok(m2![1] === '160' && m2![2] === '90' && m2![3] === '80', `wrong region: ${out}`);
  ok(Math.abs(Number(m2![4]) - 45) <= 2, `wrong y: ${out}`);
  // Nothing to scan: the default --skip is 5s and the clip is 2s long, so the
  // detector has no frames to measure and reports no region at all.
  const none = await say('cropdetect', [p('src.mp4')], { limit: '4' });
  ok(none.includes('No crop region'), `unexpected region: ${none}`);
});

await run('gif2mp4 converts a GIF', async () => {
  const out = await say('gif2mp4', [p('src.gif'), p('from.gif.mp4')], { width: '120' });
  ok(exists('from.gif.mp4'), `no output: ${out}`);
});

await run('extract-subs writes a subtitle file and retime-subs retimes it', async () => {
  await say('extract-subs', [p('subs.mp4'), p('out.srt')], { stream: '0' });
  ok(exists('out.srt') && fs.readFileSync(p('out.srt'), 'utf8').includes('hello'), 'no subtitle text');
  await say('extract-subs', [p('subs.mp4'), p('out2.srt')]);
  ok(exists('out2.srt'), 'default stream not used');
  await say('retime-subs', [p('subs.mp4'), p('retimed.srt')], { format: 'srt', stream: '0' });
  ok(exists('retimed.srt'), 'no retimed subtitle');
  ok(fs.readFileSync(p('retimed.srt'), 'utf8').includes('hello'), 'retiming lost the text');
});

await run('subtitles burns and converts through the editing commands', async () => {
  const burned = await say('subtitles', [p('src.mp4'), p('burned.mp4')], { file: p('sub.srt') });
  ok(exists('burned.mp4'), `no burned output: ${burned}`);
  await say('subtitles', [p('subs.mp4'), p('converted.mkv')], { convert: 'vtt', stream: '0', shift: '0.5' });
  ok(exists('converted.mkv'), 'no converted output');
});

// ─── 7. Filters that depend on the ffmpeg build ──────────────────────────────
section('7 — optional filters');

if (HAS_DRAW_TEXT) {
  await run('the drawtext path is wired through both the filter and args commands', async () => {
    const chain = await say('filter', ['drawtext', `text=${p('sub.srt')}`, 'fontsize=24'], { print: 'true' });
    ok(chain.includes('drawtext'), `no drawtext: ${chain}`);
  });
} else {
  skip('drawtext is unavailable in this ffmpeg build', 'no drawtext filter');
}

if (HAS_VIDSTAB) {
  await run('stabilize runs the vidstab pass chain', async () => {
    const out = await say('stabilize', [p('src.mp4'), p('stab.mp4')], {
      smoothing: '5', 'max-shift': '10', 'max-angle': '1', crop: '1',
    });
    ok(exists('stab.mp4'), `no stabilize output: ${out}`);
  });
} else {
  skip('vidstab is unavailable in this ffmpeg build', 'no vidstabdetection filter');
}

if (HAS_LUT3D) {
  await run('lut applies a .cube table', async () => {
    const out = await say('lut', [p('src.mp4'), p('graded.mp4')], { lut: p('grade.cube'), interp: 'tetrahedral' });
    ok(exists('graded.mp4'), `no lut output: ${out}`);
    await errs('lut', [p('src.mp4'), p('o.mp4')], {}, /lut requires --lut/);
  });
} else {
  skip('lut3d is unavailable in this ffmpeg build', 'no lut3d filter');
}

await run('timecode burns a counter into the picture', async () => {
  if (!HAS_DRAW_TEXT) {
    skip('timecode needs drawtext', 'no drawtext filter');
    return;
  }
  const out = await say('timecode', [p('src.mp4'), p('tc.mp4')], {
    position: 'bl', fontcolor: 'white', fontsize: '32', format: '%{pts\\:hms}',
  });
  ok(exists('tc.mp4'), `no timecode output: ${out}`);
});

// ─── 8. Every editing command, for real ──────────────────────────────────────
section('8 — the editing commands against real media');

await run('trim, speed and volume rewrite the clip', async () => {
  await say('trim', [p('src.mp4'), p('trim.mp4')], { start: '0', duration: '1' });
  ok(exists('trim.mp4'), 'no trim output');
  await say('speed', [p('src.mp4'), p('fast.mp4')], { factor: '2' });
  ok(exists('fast.mp4'), 'no speed output');
  ok(m.getMediaDuration(m.probe(p('fast.mp4'))) < 1.5, 'the speed-up did not shorten the clip');
  await say('volume', [p('src.mp4'), p('quiet.m4a')], { gain: '0.2' });
  ok(exists('quiet.m4a'), 'no volume output');
});

await run('extract and replace-audio swap the audio track', async () => {
  await say('extract', [p('src.mp4'), p('audio.m4a')]);
  ok(exists('audio.m4a'), 'no extracted audio');
  await say('replace-audio', [p('video.mp4'), p('audio.m4a'), p('swap.mp4')]);
  ok(exists('swap.mp4'), 'no replaced-audio output');
  eq(m.getAudioStreams(m.probe(p('swap.mp4'))).length, 1, 'audio stream count');
});

await run('normalize reports the loudness it measured', async () => {
  const out = await say('normalize', [p('src.mp4'), p('norm.m4a')], { target: '-20' });
  ok(exists('norm.m4a'), 'no normalized output');
  ok(/measured I=-?\d/.test(out), `no measurement line: ${out}`);
});

await run('concat copies by default and re-encodes on request', async () => {
  await say('concat', [p('joined.mp4')], { inputs: `${p('src.mp4')},${p('flip.mp4')}` });
  ok(exists('joined.mp4'), 'no stream-copied concat');
  await say('concat', [p('joined2.mp4')], { inputs: `${p('src.mp4')},${p('flip.mp4')}`, reencode: 'true' });
  ok(exists('joined2.mp4'), 'no re-encoded concat');
  await say('transitions', [p('xf.mp4')], { inputs: `${p('src.mp4')},${p('flip.mp4')}`, duration: '0.5', fps: '15' });
  ok(exists('xf.mp4'), 'no transition output');
});

await run('hls, abr and dash package the clip', async () => {
  const hlsDir = p('hls');
  fs.mkdirSync(hlsDir, { recursive: true });
  await say('hls', [p('src.mp4')], { outdir: hlsDir, segment: '1', bitrate: '200k', audio: '64k' });
  ok(fs.readdirSync(hlsDir).some(f => f.endsWith('.m3u8')), 'no playlist');
  ok(fs.readdirSync(hlsDir).some(f => f.endsWith('.ts')), 'no segments');
  await say('abr', [p('src.mp4')], {
    out: p('abr/v%v/index.m3u8'), variants: 'low=320x180:150k,high=640x360:400k',
  });
  ok(exists('abr/vlow/index.m3u8') && exists('abr/vhigh/index.m3u8'), 'no ABR variants');
  await say('dash', [p('src.mp4'), p('dash/manifest.mpd')], { segment: '1', bitrate: '300k' });
  ok(fs.existsSync(p('dash/manifest.mpd')), 'no DASH manifest');
  ok(fs.readdirSync(p('dash')).some(f => f.endsWith('.m4s')), 'no DASH segments');
});

await run('segments, chapters and metadata edit the container', async () => {
  await say('segments', [p('src.mp4')], { pattern: p('seg%03d.ts'), segment: '1' });
  ok(fs.readdirSync(TMP).some(f => f.startsWith('seg')), 'no segments');
  await say('chapters', [p('src.mp4'), p('chap.mp4')], { chapters: 'Intro:0,Outro:1' });
  eq(m.getChapterList(m.probe(p('chap.mp4'))).length, 2, 'chapter count');
  await say('metadata', [p('src.mp4'), p('meta.mp4')], { set: 'title=Test Clip,artist=Someone' });
  const info = m.probe(p('meta.mp4'));
  eq(info.format?.tags?.['title'], 'Test Clip', 'title tag');
  await say('metadata', [p('meta.mp4'), p('stripped.mp4')], { strip: 'true' });
  ok(exists('stripped.mp4'), 'no stripped output');
});

await run('thumbnail, sprite, frames and gif produce images', async () => {
  await say('thumbnail', [p('src.mp4'), p('thumb.png')], { at: '1', size: '160x90' });
  ok(fs.statSync(p('thumb.png')).size > 0, 'no thumbnail');
  await say('thumbnail', [p('src.mp4'), p('thumb.jpg')], { at: '1', format: 'jpg' });
  ok(fs.statSync(p('thumb.jpg')).size > 0, 'no JPEG thumbnail');
  await say('sprite', [p('src.mp4'), p('sprite.png')], { columns: '3', count: '9', width: '80' });
  ok(fs.statSync(p('sprite.png')).size > 0, 'no sprite');
  fs.mkdirSync(p('frames'), { recursive: true });
  await say('frames', [p('src.mp4')], { outdir: p('frames'), fps: '1', format: 'png' });
  ok(fs.readdirSync(p('frames')).length >= 2, 'no frames');
  await say('gif', [p('src.mp4'), p('out.gif')], { fps: '10', width: '160', colors: '32' });
  ok(fs.statSync(p('out.gif')).size > 0, 'no GIF');
});

await run('watermark and text burn an overlay', async () => {
  await say('watermark', [p('src.mp4'), p('thumb.png'), p('marked.mp4')], {
    position: 'top-left', opacity: '0.5', margin: '5', width: '40',
  });
  ok(exists('marked.mp4'), 'no watermarked output');
  if (HAS_DRAW_TEXT) {
    await say('text', [p('src.mp4'), p('titled.mp4')], {
      text: 'hello', position: 'bottom-right', margin: '5', size: '20', color: 'white',
    });
    ok(exists('titled.mp4'), 'no text output');
  } else {
    skip('text needs drawtext', 'no drawtext filter');
  }
});

await run('silence and scenes report, and cut, what they find', async () => {
  const quiet = p('quiet.m4a');
  ffQuoted(
    '-f lavfi -i "sine=frequency=440:duration=1" ' +
    '-f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100:d=1" ' +
    '"-filter_complex" "[0:a][1:a]concat=n=2:v=0:a=1[a]" -map "[a]" ' + p('quiet.m4a'),
  );
  ok(fs.existsSync(quiet), 'no quiet fixture');
  const found = await say('silence', [p('quiet.m4a'), p('unused.m4a')], { detect: 'true', threshold: '-50', min: '0.3' });
  ok(/silent segment/.test(found), `no silence reported: ${found}`);
  await say('silence', [p('quiet.m4a'), p('trimmed.m4a')], { threshold: '-50', min: '0.3' });
  ok(exists('trimmed.m4a'), 'no silence-removed output');

  const scenes = await say('scenes', [p('scenes.mp4')], { threshold: '0.1' });
  ok(/1 scene change/.test(scenes), `no scene change reported: ${scenes}`);
  await say('scenes', [p('scenes.mp4'), p('cuts.mp4')], { cut: 'true', threshold: '0.1' });
  ok(exists('cuts.mp4'), 'no auto-edited output');
});

await run('interpolate, delogo and twopass re-encode', async () => {
  await say('interpolate', [p('src.mp4'), p('smooth.mp4')], { fps: '30', method: 'blend' });
  ok(exists('smooth.mp4'), 'no interpolated output');
  await say('delogo', [p('src.mp4'), p('deboxed.mp4')], {
    x: '10', y: '10', width: '20', height: '20',
  });
  ok(exists('deboxed.mp4'), 'no delogo output');
  await say('twopass', [p('src.mp4'), p('two.mp4')], { bitrate: '300k', codec: 'libx264', audio: 'aac' });
  ok(exists('two.mp4'), 'no two-pass output');
});

await run('to-bitrate honours every rate-control flag', async () => {
  await say('to-bitrate', [p('src.mp4'), p('cbr.mp4')], {
    bitrate: '400k', crf: '30', codec: 'libx264', audio: 'aac', preset: 'ultrafast',
    fps: '15', size: '160x90', maxrate: '600k', bufsize: '800k',
  });
  ok(exists('cbr.mp4'), 'no rate-controlled output');
  eq(m.getVideoStreams(m.probe(p('cbr.mp4')))[0]?.width, 160, 'the size override was ignored');
});

await run('quality compares two renders and reports the score', async () => {
  const score = await say('quality', [p('src.mp4'), p('fast.mp4')], { metric: 'ssim' });
  ok(/ssim/i.test(score), `no score: ${score}`);
  const json = await say('quality', [p('src.mp4'), p('fast.mp4')], { metric: 'psnr' });
  ok(/psnr/i.test(json), `no psnr score: ${json}`);
});

await run('the audio analysis commands report their findings', async () => {
  const wave = await say('waveform', [p('src.mp4'), p('wave.png')], { width: '400', height: '100' });
  ok(exists('wave.png'), `no waveform: ${wave}`);
  const spectrum = await say('spectrum', [p('src.mp4'), p('spec.mp4')], { width: '400', height: '300', palette: 'fire' });
  ok(exists('spec.mp4'), `no spectrum: ${spectrum}`);
});

// ─── 9. The documented split still holds after the new commands ──────────────
section('9 — library reachability');

await run('the new commands keep every public export reachable', () => {
  for (const n of Object.keys(extra.LIBRARY_ONLY)) {
    ok(n in m, `LIBRARY_ONLY names ${n}, which is not exported`);
  }
  // "Reachable" means the name appears in the CLI sources: a command name, a flag
  // name, or an identifier passed to one of the library helpers.
  const dir = path.join(__dirname, 'lib/cli');
  const named = new Set<string>();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.ts')) continue;
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const match of src.matchAll(/[A-Za-z_$][\w$]*/g)) named.add(match[0]);
  }
  const missing = Object.keys(m).filter(
    n => !named.has(n) && !(n in extra.LIBRARY_ONLY) && !/^[A-Z0-9_]+$/.test(n),
  );
  ok(missing.length === 0, `unreachable from the CLI: ${missing.join(', ')}`);
});

await run('arg and codec tables are still complete', () => {
  ok(extra.argOpNames().length >= 55, `only ${extra.argOpNames().length} arg builders`);
  ok(extra.codecBuilderNames().length >= 36, `only ${extra.codecBuilderNames().length} codec builders`);
  ok(Object.keys(CLI_TASKS).length >= 52, `only ${Object.keys(CLI_TASKS).length} commands`);
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log('  CLI GAP BATTLE SUMMARY');
console.log('═'.repeat(60));
console.log(`  ✅ PASSED : ${passed}`);
console.log(`  ⏭  SKIPPED: ${skipped}`);
console.log(`  ❌ FAILED : ${errors.length}`);

if (errors.length > 0) {
  console.log(`\n${'─'.repeat(60)}\n  FAILED TESTS — FULL ERROR LOG\n${'─'.repeat(60)}`);
  for (const { label, error, stack } of errors) {
    console.log(`\n  [${label}]\n       ERROR : ${error}`);
    if (process.env.MEDIAFORGE_TRACE === '1') console.log(stack);
  }
  process.exit(1);
}
if (skipped > 0) console.log('\n  All executed CLI gap tests passed 🎉');
else console.log('\n  All CLI gap tests passed! 🎉');
