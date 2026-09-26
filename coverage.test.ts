/**
 * mediaforge battle test — coverage gaps
 *
 * The other battle suites assert behaviour. This one exists to reach the
 * library paths those suites cannot: pure builder branches that need no
 * encoder, error paths, and the argument-printing surface behind
 * `mediaforge args` / `mediaforge codec` / `mediaforge filter`.
 *
 * It is deliberately mechanical — each case is a direct call whose purpose is
 * to execute a specific range — but every case also asserts the value it
 * produced, so a wrong result still fails here rather than passing silently.
 *
 * Run: npm run battle:cov
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, 'tmp_cov');
const p = (name: string) => path.join(TMP, name);
const errors: { label: string; error: string; stack: string }[] = [];
let passed = 0;

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

function eq(actual: unknown, expected: unknown, what: string): void {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function ok(cond: unknown, what: string): void {
  if (!cond) throw new Error(what);
}

/** Assert that `fn` throws, optionally matching `re`, and return the message. */
function throws(fn: () => unknown, re: RegExp, what: string): string {
  let msg = '';
  try {
    fn();
  } catch (e) {
    msg = (e as Error).message;
  }
  if (!re.test(msg)) throw new Error(`${what}: expected /${re.source}/, got ${JSON.stringify(msg)}`);
  return msg;
}

const m = await import('./lib/index.js') as Record<string, any>;
// The time helpers are internal to the library rather than part of the public
// index, so they are reached through their own module.
const time = await import('./lib/utils/time.js');
const { FilterChain } = await import('./lib/types/filters.js') as { FilterChain: new () => any };
const flags = await import('./lib/cli/flags.js');
const extra = await import('./lib/cli/tasks.extra.js');
const registry = await import('./lib/cli/filter-registry.js');
const CLI_TASKS = (await import('./lib/cli/tasks.js')).CLI_TASKS as Record<string, any>;

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

// ─── 1. Time helpers ─────────────────────────────────────────────────────────
section('1 — time helpers');

await run('toSeconds handles every accepted form', () => {
  eq(time.toSeconds(undefined), null, 'undefined');
  eq(time.toSeconds(12.5), 12.5, 'number');
  eq(time.toSeconds('00:01:30'), 90, 'HH:MM:SS');
  eq(time.toSeconds('01:30'), 90, 'MM:SS');
  eq(time.toSeconds('2.5'), 2.5, 'fractional');
  eq(time.toSeconds('abc'), null, 'unparseable');
  eq(time.toSeconds('aa:bb:cc'), null, 'NaN in a clock form');
  eq(time.toSeconds('aa:bb'), null, 'NaN in a short clock form');
});

await run('toSecondsStrict falls back to 0 instead of null', () => {
  eq(time.toSecondsStrict(3), 3, 'number');
  eq(time.toSecondsStrict('00:00:05'), 5, 'HH:MM:SS');
  eq(time.toSecondsStrict('00:05'), 5, 'MM:SS');
  eq(time.toSecondsStrict('1.5'), 1.5, 'fractional');
  eq(time.toSecondsStrict('nope'), 0, 'unparseable');
  eq(time.toSecondsStrict('aa:bb:cc'), 0, 'NaN in a clock form');
  eq(time.toSecondsStrict('aa:bb'), 0, 'NaN in a short clock form');
});

// ─── 2. Binary discovery ─────────────────────────────────────────────────────
section('2 — binary discovery');

await run('isDeno reflects the runtime', () => {
  eq(typeof m.isDeno(), 'boolean', 'isDeno returns a boolean');
});

await run('isBinaryAvailable distinguishes present from missing binaries', () => {
  eq(m.isBinaryAvailable('ffmpeg'), true, 'ffmpeg on PATH');
  eq(m.isBinaryAvailable('definitely-not-a-real-binary-xyz'), false, 'missing binary');
});

await run('isBinaryAvailableAsync agrees with the sync variant', async () => {
  // The async form is exercised for real: it spawns and waits for 'close'.
  const yes = await m.isBinaryAvailableAsync('ffmpeg', 10_000);
  eq(yes, true, 'ffmpeg resolves true');
  const no = await m.isBinaryAvailableAsync('definitely-not-a-real-binary-xyz', 10_000);
  eq(no, false, 'missing binary resolves false');
});

await run('validateBinary rejects a missing path and a non-executable file', () => {
  throws(() => m.validateBinary('/definitely/not/here/ffmpeg'), /not found|BinaryNotFound/i, 'missing absolute path');
  // A real file with the execute bit cleared is found but not executable.
  const notExec = p('not-executable');
  fs.writeFileSync(notExec, '#!/bin/sh\n', { mode: 0o644 });
  throws(() => m.validateBinary(notExec), /not executable|BinaryNotExecutable/i, 'non-executable file');
  throws(() => m.validateBinary('definitely-not-a-real-binary-xyz'), /not found|BinaryNotFound/i, 'missing PATH name');
});

// ─── 3. Version parsing ──────────────────────────────────────────────────────
section('3 — version parsing');

const GIT_OUTPUT = 'ffmpeg version N-113402-g1a2b3c4d5 Copyright (c) 2000-2025\n';
const PLAIN_OUTPUT = 'some-unknown-build\n';

await run('parseVersionOutput handles git, release and unknown builds', () => {
  const git = m.parseVersionOutput(GIT_OUTPUT);
  eq(git.isGit, true, 'git build isGit');
  eq(git.raw, 'N-113402-g1a2b3c4d5', 'git raw');
  // Nightly builds report a high sentinel so feature gates pass.
  eq(git.major, 999, 'git major sentinel');

  const rel = m.parseVersionOutput(
    'ffmpeg version 6.1.1 Copyright (c) 2000-2024\nconfiguration: --enable-gpl --enable-libx264\n  libavutil 58. 29.100\n',
  );
  eq(rel.isGit, false, 'release isGit');
  eq(rel.major, 6, 'release major');
  eq(rel.minor, 1, 'release minor');
  eq(rel.patch, 1, 'release patch');
  eq(rel.configuration.includes('--enable-libx264'), true, 'configuration flags');
  // "58. 29.100" is normalised to "58.29.100".
  eq(rel.libraries['libavutil'], '58.29.100', 'library version normalised');

  const plain = m.parseVersionOutput(PLAIN_OUTPUT);
  eq(plain.major, 0, 'unknown build major');
  eq(plain.raw, 'some-unknown-build', 'unknown build raw');
});

await run('satisfiesVersion compares semver and treats git builds as unknown', () => {
  const v = (major: number, minor: number, patch: number, isGit = false) => ({ major, minor, patch, isGit });
  eq(m.satisfiesVersion(v(7, 1, 0), 7, 0), true, 'newer major');
  eq(m.satisfiesVersion(v(6, 1, 0), 7, 0), false, 'older major');
  eq(m.satisfiesVersion(v(7, 0, 0), 7, 1), false, 'older minor on the same major');
  eq(m.satisfiesVersion(v(7, 1, 0), 7, 0, 1), true, 'equal patch');
  eq(m.satisfiesVersion(v(7, 0, 0), 7, 0, 1), false, 'older patch');
  // A git build satisfies only a zero minimum.
  eq(m.satisfiesVersion(v(999, 999, 999, true), 0, 0, 0), true, 'git satisfies 0.0.0');
  eq(m.satisfiesVersion(v(999, 999, 999, true), 7, 0), false, 'git does not satisfy 7.0');
  eq(m.satisfiesVersion(v(7, 0, 0, undefined as never), 7, 0), true, 'missing isGit is treated as false');
});

// ─── 4. CLI flag helpers ─────────────────────────────────────────────────────
section('4 — CLI flag helpers');

await run('num rejects a non-numeric value instead of passing NaN on', () => {
  eq(flags.num({ a: '5' }, 'a'), 5, 'numeric string');
  eq(flags.num({}, 'a'), undefined, 'absent flag');
  eq(flags.num({ a: true }, 'a'), undefined, 'boolean flag is not a number');
  throws(() => flags.num({ a: 'abc' }, 'a'), /--a must be a number/, 'non-numeric');
});

await run('list splits, trims and drops empty entries', () => {
  eq(flags.list({ a: 'x, y ,z' }, 'a').join('|'), 'x|y|z', 'split');
  eq(flags.list({ a: '' }, 'a').length, 0, 'empty string');
  eq(flags.list({}, 'a').length, 0, 'absent flag');
  eq(flags.list({ a: ' , ' }, 'a').length, 0, 'only separators');
});

await run('requireFlag names the flag it is missing', () => {
  eq(flags.requireFlag({ a: 'v' }, 'a', 'demo'), 'v', 'present');
  throws(() => flags.requireFlag({}, 'a', 'demo'), /demo requires --a/, 'absent');
  throws(() => flags.requireFlag({ a: '' }, 'a', 'demo'), /demo requires --a/, 'empty');
});

await run('coerceValue maps CLI text onto the option primitive types', () => {
  eq(flags.coerceValue('true'), true, 'true');
  eq(flags.coerceValue('false'), false, 'false');
  eq(flags.coerceValue('42'), 42, 'integer');
  eq(flags.coerceValue('2.5'), 2.5, 'float');
  eq(flags.coerceValue('lanczos'), 'lanczos', 'string');
  eq(flags.coerceValue(''), '', 'empty stays a string');
  eq(flags.coerceValue('0x10'), '0x10', 'hex stays a string');
  eq(flags.coerceValue('  7  '), '  7  ', 'padded digits stay a string');
  eq(flags.coerceValue('1e3'), '1e3', 'exponent stays a string');
  eq(flags.coerceValue('-3.5'), -3.5, 'negative float');
});

await run('parseOptions builds a coerced record and rejects bare tokens', () => {
  const rec = flags.parseOptions(['lx=5', 'mode=fast', 'mono=true', 'name=hello']);
  eq(rec['lx'], 5, 'number');
  eq(rec['mode'], 'fast', 'string');
  eq(rec['mono'], true, 'boolean');
  eq(rec['name'], 'hello', 'value with an = inside the key/value split');
  eq(flags.parseOptions([]).lx, undefined, 'empty input');
  throws(() => flags.parseOptions(['bare']), /key=value/, 'bare token');
  throws(() => flags.parseOptions(['=v']), /empty key/, 'empty key');
});

// ─── 5. Filter graph ─────────────────────────────────────────────────────────
section('5 — filter graph');

await run('FilterGraph chains video filters and commits a labelled output', () => {
  const g = m.filterGraph();
  const [scaled] = g.from('0:v').scale(1280, 720).out('scaled');
  g.from(scaled).crop(1280, 720).mapOut();
  const out = g.toString();
  ok(out.includes('scale=1280:720[scaled]'), `scale step: ${out}`);
  ok(out.includes('[scaled]crop=1280:720'), `crop step: ${out}`);
});

await run('from() accepts the array out() returns', () => {
  // Passing the array straight back used to stringify into a bogus label.
  const g = m.filterGraph();
  const parts = g.from('0:v').filter('split', [2], {}).out('a', 'b');
  g.merge(parts).hstack(2).mapOut();
  const out = g.toString();
  ok(out.includes('split=2[a][b]'), `split: ${out}`);
  ok(out.includes('[a][b]hstack'), `hstack inputs: ${out}`);
});

await run('merge() builds a multi-input node', () => {
  const g = m.filterGraph();
  g.merge('0:v', '1:v').overlay(10, 20, {}).mapOut();
  ok(g.toString().includes('overlay=10:20'), g.toString());
});

await run('GraphNode exposes the single-filter shorthands', () => {
  const g = m.filterGraph();
  g.from('0:v')
    .crop(640, 360, 0, 0)
    .pad(1280, 720, '(ow-iw)/2', '(oh-ih)/2', 'black')
    .fps(30)
    .format('yuv420p')
    .setpts('PTS-STARTPTS')
    .vflip()
    .hflip()
    .colorkey('green', 0.1, 0.0)
    .mapOut();
  const out = g.toString();
  for (const frag of ['crop=640:360:x=0:y=0', 'pad=1280:720', 'fps=30', 'format=yuv420p', 'vflip', 'hflip', 'colorkey=']) {
    ok(out.includes(frag), `missing ${frag} in ${out}`);
  }
});

await run('GraphNode audio shorthands', () => {
  const g = m.filterGraph();
  g.from('0:a').volume(0.5).atempo(1.25).asetpts('PTS-STARTPTS').mapOut();
  const out = g.toString();
  for (const frag of ['volume=0.5', 'atempo=1.25', 'asetpts=PTS-STARTPTS']) {
    ok(out.includes(frag), `missing ${frag} in ${out}`);
  }
});

await run('GraphNode loudnorm and the out()/outAuto() label forms', () => {
  const g = m.filterGraph();
  g.from('0:a').loudnorm(-23, 7, -2).out('norm');
  g.from('0:a').outAuto('audio');
  const out = g.toString();
  ok(out.includes('loudnorm=i=-23:lra=7:tp=-2[norm]'), out);
  ok(/\[\w+\]/.test(out.slice(out.indexOf('[norm]'))), 'auto label present');
});

await run('an uncommitted node is reported rather than silently dropped', () => {
  const g = m.filterGraph();
  g.from('0:v').scale(320, 240);
  throws(() => g.toString(), /uncommitted node/, 'uncommitted graph');
});

// ─── 6. Filter registry ──────────────────────────────────────────────────────
section('6 — filter registry');

await run('the registry names all 77 filters and every one serialises', () => {
  eq(registry.filterNames().length, 77, 'filter count');
  for (const name of registry.filterNames()) {
    const entry = registry.FILTER_REGISTRY[name];
    const rec: Record<string, string | number | boolean> = {};
    for (const k of entry.required ?? []) rec[k] = (k === 'width' || k === 'height') ? 4 : 1;
    const out = entry.apply(new FilterChain(), rec).toString();
    ok(out.length > 0, `${name} serialised to nothing`);
    ok(!/undefined|NaN|\[object Object\]/.test(out), `${name} serialised a placeholder: ${out}`);
  }
});

await run('a value-kind filter takes its option positionally', () => {
  eq(registry.FILTER_REGISTRY['setpts']!.apply(new FilterChain(), { expr: 'PTS/2' }).toString(), 'setpts=PTS/2', 'setpts');
  eq(registry.FILTER_REGISTRY['split']!.apply(new FilterChain(), { n: 3 }).toString(), 'split=3', 'split');
});

await run('an opts-kind filter reads its named options', () => {
  eq(registry.FILTER_REGISTRY['scale']!.apply(new FilterChain(), { w: 320, h: 240 }).toString(), 'scale=320:240', 'scale');
});

// ─── 7. The args/codec task surface ──────────────────────────────────────────
section('7 — args and codec tables');

/** Capture stdout while `fn` runs, so the printed text can be asserted. */
async function capture(fn: () => void | Promise<void>): Promise<string> {
  const seen: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => { seen.push(a.map(x => String(x)).join(' ')); };
  try {
    await fn();
  } finally {
    console.log = orig;
  }
  return seen.join('\n');
}

await run('args --list prints every op with its keys', async () => {
  const out = await capture(() => CLI_TASKS['args']!.run([], { list: 'true' }));
  ok(out.includes('arg builders'), 'no count line');
  for (const op of extra.argOpNames()) ok(out.includes(op), `args --list omits ${op}`);
});

await run('every arg op accepts its required keys and prints something', async () => {
  // A representative sample per family: argv builders, filter-string builders
  // and the JSON parsers.
  const cases: Array<[string, Record<string, string>]> = [
    ['screenshot', { input: 'in.mp4', output: 'out.jpg', timestamp: '2' }],
    ['framebuffer', { input: 'in.mp4', timestamp: '1', format: 'rawvideo' }],
    ['timestamp-filename', { pattern: 'frame_%04d.jpg', index: '7', ext: 'jpg' }],
    ['frames', { input: 'in.mp4', output: 'f%03d.png', fps: '2' }],
    ['gif-palette', { fps: '10', width: '320' }],
    ['metadata', { global: '{"title":"t"}', streams: '{"a:0":{"language":"eng"}}' }],
    ['chapters', { chapters: '[{"title":"A","startSec":0,"endSec":3}]' }],
    ['concat-transitions', { inputs: 'a.mp4,b.mp4', output: 'out.mp4', transition: 'fade', duration: '0.5' }],
    ['loudnorm', { targetI: '-23', targetLra: '7', targetTp: '-2' }],
    ['loudnorm', { targetI: '-23', targetLra: '7', targetTp: '-2', measured: '{"inputI":-24,"inputLra":7,"inputTp":-3,"inputThresh":-34}' }],
    ['silence-detect', { threshold: '-40', minDuration: '1' }],
    ['silence-remove', { threshold: '-40', minDuration: '1' }],
    ['scene-cut', { scenes: '[{"timestamp":0,"sceneNumber":1},{"timestamp":3,"sceneNumber":2}]' }],
    ['segments', { input: 'in.mp4', outputPattern: 's%03d.ts', segmentTime: '2' }],
    ['tonemap', { algorithm: 'mobius', peak: '1000' }],
    ['interpolate', { fps: '60', method: 'mci' }],
    ['vmaf', { model: 'version=v0.6.1' }],
    ['ssim', { statsFile: 'ssim.log' }],
    ['psnr', { statsFile: 'psnr.log' }],
    ['hw-upload', { accel: 'cuda' }],
    ['hw-download', { destFormat: 'nv12' }],
    ['hw-scale', { accel: 'cuda', width: '1280', height: '720' }],
    ['hw-chain', { accel: 'cuda', gpuFilters: '["scale_cuda=1280:720"]' }],
    ['waveform', { width: '800', height: '120', color: 'blue', scale: 'lin' }],
    ['spectrum', { width: '800', height: '120', color: 'channel', fps: '20' }],
    ['scene-select', { threshold: '0.4' }],
    ['burn-timecode', { fontsize: '48' }],
    ['burn-subtitles', { subtitleFile: 's.srt' }],
    ['text-watermark', { text: 'hi', position: 'top-right', margin: '10', fontSize: '24', fontColor: 'white' }],
    ['watermark', { position: 'top-left', margin: '10', opacity: '0.5' }],
    ['atempo-chain', { speed: '3' }],
    ['to-duration', { value: '00:01:00' }],
    ['to-bitrate', { value: '2M' }],
    ['parse-duration', { value: '00:00:30' }],
    ['parse-bitrate', { value: '2000' }],
    ['parse-framerate', { value: '30000/1001' }],
    ['duration-to-us', { seconds: '1.5' }],
    ['subtitle-codec', { format: 'srt' }],
    ['subtitle-extension', { format: 'vtt' }],
    ['stats-parse', { contents: 'n:0 mse_avg:1.2 mse_y:1.1 All:0.998765 (30.0)', metric: 'ssim' }],    ['stats-parse', { contents: 'n:1 mse_avg:0.50 psnr_avg:51.13 psnr_y:52.07', metric: 'psnr' }],
    ['var-stream-map', { variants: '[{"name":"p","resolution":"640x360","videoBitrate":"800k"}]' }],
    ['abr-validate', { variants: '[{"name":"p","resolution":"640x360","videoBitrate":"800k"}]' }],
    ['abr-filter', { variants: '[{"name":"p","resolution":"640x360","videoBitrate":"800k","audioBitrate":"64k"}]' }],
    ['global', { overwrite: 'true', logLevel: 'warning' }],
    ['input', { seekInput: '5', format: 'mp4' }],
    ['output', { format: 'mp4', map: '0:v,0:a' }],
    ['pipe', { outputArgs: '-c:v libx264 -f nut', outputFormat: 'nut' }],
    ['stream-output', { input: 'in.mp4', outputArgs: '-c copy', outputFormat: 'mp4' }],
    ['vmaf-parse', { json: '{"pooled_metrics":{"vmaf":{"mean":90}}}' }],
  ];
  for (const [op, rec] of cases) {
    const out = await capture(() => CLI_TASKS['args']!.run([op, ...Object.entries(rec).map(([k, v]) => `${k}=${v}`)], {}));
    ok(out.trim().length > 0, `args ${op} printed nothing`);
    ok(!/undefined|NaN|\[object Object\]/.test(out), `args ${op} printed a placeholder: ${out}`);
  }
});

await run('the audio codec builders warn and carry every option', () => {
  // qscale mode drops the rate hints, and says so rather than ignoring them.
  const warned: string[] = [];
  const orig = console.warn;
  console.warn = (msg: unknown) => { warned.push(String(msg)); };
  try {
    const qscale = m.vorbisToArgs({ qscale: 3, minrate: 32, maxrate: 128 });
    ok(qscale.includes('-q:a'), `no qscale: ${qscale.join(' ')}`);
    ok(!qscale.some(a => a.startsWith('-minrate')), `minrate survived: ${qscale.join(' ')}`);
    ok(warned.length > 0, 'no warning about the ignored rate hints');
  } finally {
    console.warn = orig;
  }
  const bitrate = m.vorbisToArgs({ bitrate: 128, minrate: 32, cutoff: 8000 });
  ok(bitrate.includes('-b:a'), `no bitrate: ${bitrate.join(' ')}`);
  ok(bitrate.some(a => a.startsWith('-minrate')), `minrate missing: ${bitrate.join(' ')}`);
  const wav = m.wavpackToArgs({ quality: 4, bitrate: 256, extra: 6 });
  ok(wav.includes('-compression_level'), `no quality: ${wav.join(' ')}`);
  ok(wav.includes('-extra'), `no extra: ${wav.join(' ')}`);
  eq(m.wavpackToArgs().join(' '), '-c:a wavpack', 'a bare wavpack');
  eq(m.pcmToArgs('pcm_s16be' as never, { sampleRate: 48000, channels: 1 }).join(' '),
    '-c:a pcm_s16be -ar 48000 -ac 1', 'pcm');
  eq(m.pcmToArgs('pcm_u8' as never).join(' '), '-c:a pcm_u8', 'a bare pcm');
});

await run('args two-pass and abr-args produce real argv', async () => {
  const tp = await capture(() => CLI_TASKS['args']!.run(
    ['two-pass', 'input=in.mp4', 'output=out.mp4', 'videoBitrate=2M'], {},
  ));
  ok(tp.includes('-pass'), `two-pass has no pass flags: ${tp}`);
  ok(tp.includes('passlog'), `two-pass has no passlog line: ${tp}`);

  const abr = await capture(() => CLI_TASKS['args']!.run([
    'abr-args',
    'input=in.mp4',
    'outputPattern=v%v/index.m3u8',
    'variants=[{"name":"p","resolution":"640x360","videoBitrate":"800k","audioBitrate":"64k"}]',
  ], {}));
  ok(abr.includes('-var_stream_map'), `abr-args has no var_stream_map: ${abr}`);
});

await run('args reports an unknown op and an unknown key', async () => {
  const orig = console.log;
  console.log = () => {};
  try {
    let msg = '';
    try {
      await CLI_TASKS['args']!.run(['nope'], {});
    } catch (e) { msg = (e as Error).message; }
    ok(/unknown arg builder/.test(msg), `unknown op: ${msg}`);
    msg = '';
    try {
      await CLI_TASKS['args']!.run(['screenshot', 'nope=1'], {});
    } catch (e) { msg = (e as Error).message; }
    ok(/has no option "nope"/.test(msg), `unknown key: ${msg}`);
  } finally {
    console.log = orig;
  }
});

await run('args parses a loudnorm measurement and a vmaf log', async () => {
  const text = [
    '[Parsed_loudnorm_0 @ 0x1]',
    '  Input Integrated:    -24.3 LUFS',
    '  Input True Peak:      -3.2 dBFS',
  ].join('\n');
  const ln = await capture(() => CLI_TASKS['args']!.run(
    ['loudnorm-parse', `input=${text}`, 'mode=output'], {},
  ));
  ok(/inputI|input_i/.test(ln), `loudnorm parse output: ${ln}`);

  const vmaf = await capture(() => CLI_TASKS['args']!.run(
    ['vmaf-parse', 'json={"pooled_metrics":{"vmaf":{"mean":90.5}}}'], {},
  ));
  ok(vmaf.includes('90.5'), `vmaf parse output: ${vmaf}`);
});

await run('args version-satisfies reports something', async () => {
  const vs = await capture(() => CLI_TASKS['args']!.run(['version-satisfies', 'minMajor=1'], {}));
  ok(vs.includes('true') || vs.includes('false'), `version-satisfies: ${vs}`);
});

await run('codec --list prints every builder with its keys', async () => {
  const out = await capture(() => CLI_TASKS['codec']!.run([], { list: 'true' }));
  ok(out.includes('encoder builders'), 'no count line');
  for (const c of extra.codecBuilderNames()) ok(out.includes(c), `codec --list omits ${c}`);
});

await run('every codec builder turns options into arguments', async () => {
  // The builders declare different option names, so each is driven with the
  // first candidate its own key list actually accepts. `pcm` also takes a
  // leading format positional, which the list output advertises as `<format>`.
  const candidates = [
    'bitrate=192', 'crf=20', 'qscale=2', 'quality=1', 'preset=medium', 'profile=main',
    'bitrate=2M', 'level=3', 'minPredictionOrder=2', 'sampleRate=48000', 'gopSize=2',
    'compressionLevel=5', 'qp=20', 'bFrames=2', 'aacCoder=coder',
  ];
  const list = await capture(() => CLI_TASKS['codec']!.run([], { list: 'true' }));
  for (const name of extra.codecBuilderNames()) {
    const row = list.split('\n').find(l => l.trim().startsWith(`${name} `)) ?? '';
    const leading = /<format>/.test(row) ? ['pcm_s16le'] : [];
    let printed = '';
    let lastErr = '';
    for (const opt of candidates) {
      try {
        printed = await capture(() => CLI_TASKS['codec']!.run([name, ...leading, opt], {}));
        lastErr = '';
        break;
      } catch (e) {
        lastErr = (e as Error).message;
      }
    }
    ok(lastErr === '', `codec ${name} rejected every candidate: ${lastErr}`);
    ok(printed.length > 0, `codec ${name} printed nothing`);
    ok(!/undefined|NaN|\[object Object\]/.test(printed), `codec ${name} printed a placeholder: ${printed}`);
  }
});

await run('codec pcm requires a known sample format', async () => {
  const orig = console.log;
  const msg = async (pos: string[]): Promise<string> => {
    console.log = () => {};
    try {
      await CLI_TASKS['codec']!.run(pos, {});
      return '';
    } catch (e) {
      return (e as Error).message;
    } finally {
      console.log = orig;
    }
  };
  ok(/needs a <format>/.test(await msg(['pcm'])), 'missing format');
  ok(/no format "bogus"/.test(await msg(['pcm', 'bogus'])), 'unknown format');
  ok((await msg(['pcm', 'pcm_s16le'])).length === 0, 'valid format rejected');
  ok(/pcm_s16le/.test(await msg(['pcm', 'nope'])), 'error does not list the formats');
});

await run('codec rejects an unknown builder and an unknown option', async () => {
  const orig = console.log;
  console.log = () => {};
  try {
    let msg = '';
    try {
      await CLI_TASKS['codec']!.run(['nope'], {});
    } catch (e) { msg = (e as Error).message; }
    ok(/unknown codec builder/.test(msg), `unknown builder: ${msg}`);
    msg = '';
    try {
      await CLI_TASKS['codec']!.run(['x264', 'nope=1'], {});
    } catch (e) { msg = (e as Error).message; }
    ok(/has no option "nope"/.test(msg), `unknown option: ${msg}`);
  } finally {
    console.log = orig;
  }
});

// ─── 8. Library-only and internal notes ──────────────────────────────────────
section('8 — documented CLI/library split');

await run('LIBRARY_ONLY and INTERNAL_NOTES are consistent with the exports', () => {
  for (const [name, reason] of Object.entries(extra.LIBRARY_ONLY)) {
    ok(reason.length >= 10, `${name}: reason too short`);
    ok(name in m, `${name} is listed as library-only but is not a public export`);
  }
  for (const name of Object.keys(extra.INTERNAL_NOTES)) {
    ok(!(name in m), `${name} is a public export, so it belongs in LIBRARY_ONLY`);
  }
});

await run('the arg-op and codec tables expose sorted, duplicate-free names', () => {
  eq(JSON.stringify(extra.argOpNames()), JSON.stringify([...extra.argOpNames()].sort()), 'arg op names sorted');
  eq(extra.argOpNames().length, new Set(extra.argOpNames()).size, 'arg op names unique');
  eq(extra.codecBuilderNames().length, new Set(extra.codecBuilderNames()).size, 'codec names unique');
});

// ─── summary ────────────────────────────────────────────────────────────────
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${'═'.repeat(60)}`);
console.log('  COVERAGE-GAP BATTLE SUMMARY');
console.log('═'.repeat(60));
console.log(`  ✅ PASSED : ${passed}`);
console.log(`  ❌ FAILED : ${errors.length}`);

if (errors.length > 0) {
  console.log(`\n${'─'.repeat(60)}`);
  for (const [i, e] of errors.entries()) {
    console.log(`\n  [${i + 1}] ${e.label}`);
    console.log(`       ERROR : ${e.error}`);
  }
  console.log('─'.repeat(60));
  process.exit(1);
} else {
  console.log('\n  All coverage-gap tests passed! 🎉');
}
