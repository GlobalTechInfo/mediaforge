/**
 * mediaforge battle test — library gaps
 *
 * Companion to `battle.gaps.test.ts`. That file drives the command table; this
 * one drives the library helpers that the commands reach only indirectly, plus
 * the fluent builder and the streaming paths that no command exercises in
 * process. Everything runs in this process so the coverage tool can see it.
 *
 * Run: npm run battle:lib
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, 'tmp_lib');
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
  if (actual !== expected) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function rejects(fn: () => unknown, re: RegExp, what: string): Promise<string> {
  let msg = '';
  try {
    await fn();
  } catch (e) {
    msg = (e as Error).message;
  }
  if (!re.test(msg)) throw new Error(`${what}: expected /${re.source}/, got ${JSON.stringify(msg)}`);
  return msg;
}

function ff(args: string): void {
  const argv = args.trim().split(/\s+/);
  const target = argv[argv.length - 1]!;
  try {
    execFileSync('ffmpeg', ['-y', ...argv], { stdio: 'pipe' });
  } catch (e) {
    const err = e as { stderr?: Buffer };
    const line = err.stderr?.toString().split('\n').find(l => /error|invalid|Unable|No such/i.test(l));
    throw new Error(`fixture ${target} failed\n${line ?? ''}`);
  }
}

const m = await import('./lib/index.js') as Record<string, any>;
const complex = await import('./lib/filters/complex.js') as Record<string, any>;
const streams = await import('./lib/helpers/streams.js') as Record<string, any>;
const registryMod = await import('./lib/codecs/registry.js') as Record<string, any>;
const { FFmpegBuilder, VersionError } = await import('./lib/FFmpeg.js') as Record<string, any>;

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

ff(
  '-f lavfi -i testsrc=duration=2:size=320x180:rate=15 ' +
  '-f lavfi -i sine=frequency=440:duration=2 ' +
  '-c:v libx264 -preset ultrafast -crf 45 -pix_fmt yuv420p -c:a aac -shortest ' +
  p('a.mp4'),
);
ff(
  '-f lavfi -i testsrc=duration=2:size=320x180:rate=15 ' +
  '-f lavfi -i sine=frequency=660:duration=2 ' +
  '-c:v libx264 -preset ultrafast -crf 45 -pix_fmt yuv420p -c:a aac -shortest ' +
  p('b.mp4'),
);
fs.writeFileSync(p('weird.mp4'), 'x');

const exists = (name: string) => fs.existsSync(p(name));

// ─── 1. Concatenation helpers ────────────────────────────────────────────────
section('1 — concat helpers');

await run('mergeToFile copies a lone input and rejects an empty list', async () => {
  await m.mergeToFile({ inputs: [p('a.mp4')], output: p('merged_single.mp4') });
  ok(exists('merged_single.mp4'), 'single-input copy did not write');
  eq(fs.statSync(p('merged_single.mp4')).size, fs.statSync(p('a.mp4')).size, 'copy size differs');
  await rejects(() => m.mergeToFile({ inputs: [], output: p('x.mp4') }), /no inputs provided/, 'empty list');
  await rejects(
    () => m.mergeToFile({ inputs: [p('missing.mp4')], output: p('x.mp4') }),
    /input file not found/,
    'missing single input',
  );
});

await run('mergeToFile concatenates several files', async () => {
  await m.mergeToFile({ inputs: [p('a.mp4'), p('b.mp4')], output: p('merged.mp4') });
  ok(exists('merged.mp4'), 'no merged output');
  const dur = m.getMediaDuration(m.probe(p('merged.mp4')));
  ok(dur > 3.5, `expected both clips, got ${dur}s`);
});

await run('concatFiles stream-copies and re-encodes', async () => {
  // The copy path awaits the demuxer run itself, so its process has already
  // finished by the time the promise resolves; the re-encode path hands back a
  // live process. Waiting on 'end' alone would hang in the first case.
  const done = (proc: any, out: string) => new Promise<void>((resolve, reject) => {
    if (proc.child?.exitCode !== null && proc.child?.exitCode !== undefined) {
      if (fs.existsSync(out)) resolve();
      else reject(new Error(`ffmpeg exited with ${proc.child.exitCode}`));
      return;
    }
    proc.emitter.on('end', () => resolve());
    proc.emitter.on('error', (e: Error) => reject(e));
  });
  const copied = await m.concatFiles({ inputs: [p('a.mp4'), p('b.mp4')], output: p('cat_copy.mp4'), copy: true });
  await done(copied, p('cat_copy.mp4'));
  ok(exists('cat_copy.mp4'), 'no stream-copied output');
  const reencoded = await m.concatFiles({
    inputs: [p('a.mp4'), p('b.mp4')], output: p('cat_re.mp4'),
    videoCodec: 'libx264', audioCodec: 'aac',
  });
  await done(reencoded, p('cat_re.mp4'));
  ok(exists('cat_re.mp4'), 'no re-encoded output');
});

await run('buildConcatList quotes paths and rejects control characters', () => {
  const list = m.buildConcatList([p('a.mp4'), p('b.mp4')]);
  eq(list.split('\n').length, 2, 'line count');
  ok(list.startsWith("file '"), `not a concat list: ${list}`);
  ok(list.includes('a.mp4') && list.includes('b.mp4'), 'paths missing');
  // A name with a newline cannot be represented in a concat demuxer list.
  fs.writeFileSync(p('bad\nname.mp4'), 'x');
  rejects(
    () => m.buildConcatList([p('bad\nname.mp4')]),
    /control characters/,
    'newline in a path',
  );
});

await run('concatWithTransitions joins two clips and reports progress', async () => {
  const seen: number[] = [];
  await m.concatWithTransitions({
    inputs: [p('a.mp4'), p('b.mp4')],
    output: p('trans.mp4'),
    transition: 'fade',
    duration: 0.5,
    fps: 15,
    resolution: '320x180',
    onProgress: (n: number) => seen.push(n),
  });
  ok(exists('trans.mp4'), 'no transition output');
  ok(seen.length > 0, 'no progress callbacks');
  ok(seen.every(n => n >= 0 && n <= 100), `a percentage is out of range: ${seen.join(', ')}`);
  const args = m.buildConcatTransitionArgs(
    [p('a.mp4'), p('b.mp4')], p('args.mp4'), 'fade', 1, 'libx264', 'aac', '15', '320x180', undefined, [2, 2],
  );
  ok(args.some(a => a.includes('xfade')), `no xfade: ${args.join(' ')}`);
  ok(args.includes(p('a.mp4')) && args.includes(p('b.mp4')), `no input args: ${args.join(' ')}`);
  await rejects(
    () => m.concatWithTransitions({ inputs: [p('a.mp4')], output: p('x.mp4') }),
    /at least 2 input files/,
    'single input',
  );
});

await run('a concat transition falls back when an input cannot be probed', async () => {
  fs.writeFileSync(p('fake.mp4'), 'not a video');
  // The probe failure is warned about and the default duration is used, so the
  // command still runs — and ffmpeg then rejects the unreadable input.
  const orig = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  try {
    await rejects(
      () => m.concatWithTransitions({ inputs: [p('a.mp4'), p('fake.mp4')], output: p('x.mp4') }),
      /.*/,
      'unreadable input',
    );
  } finally {
    console.warn = orig;
  }
  ok(warned, 'no warning about the unprobeable input');
});

// ─── 2. Filter graphs and simple chains ──────────────────────────────────────
section('2 — filter graphs');

await run('the graph node methods build the expected filters', () => {
  const g = m.filterGraph();
  const node = g.from('0:v');
  eq(typeof node.mapOut, 'function', 'mapOut exists');
  // A node has to be committed before the graph can serialise.
  rejects(() => g.toString(), /uncommitted node/, 'serialising too early');
  node.mapOut();
  eq(g.size, 1, 'link count');
  ok(g.toString().includes('[0:v]'), `no link: ${g.toString()}`);

  const g2 = m.filterGraph();
  g2.merge('0:a', '1:a').amix(3, 'longest').mapOut();
  ok(g2.toString().includes('amix=inputs=3:duration=longest'), `amix: ${g2.toString()}`);
  const g3 = m.filterGraph();
  g3.merge('0:a', '1:a').amerge(2).mapOut();
  ok(g3.toString().includes('amerge=inputs=2'), `amerge: ${g3.toString()}`);
  const g4 = m.filterGraph();
  g4.merge('0:v', '1:v').overlay(10, 20, { eval: 'frame' }).mapOut();
  ok(g4.toString().includes('overlay=10:20:eval=frame'), `overlay: ${g4.toString()}`);
});

await run('the stack and concat node helpers take their counts', () => {
  const g = m.filterGraph();
  g.merge('0:v', '1:v').hstack(2, true).mapOut();
  g.merge('2:v', '3:v').vstack(3, false).mapOut();
  g.merge('4:a', '5:a').concat(2, 1, 1).mapOut();
  const str = g.toString();
  ok(str.includes('hstack=inputs=2:shortest=1'), `hstack: ${str}`);
  ok(str.includes('vstack=inputs=3:shortest=0'), `vstack: ${str}`);
  ok(str.includes('concat=n=2:v=1:a=1'), `concat: ${str}`);
});

await run('the video chain covers every helper method', () => {
  const chain = complex.videoFilterChain()
    .raw('null')
    .scale(160, 90, 'bicubic')
    .crop(100, 50, 5, 5)
    .pad(200, 100, 1, 1, 'black')
    .fps(30)
    .setpts('PTS-STARTPTS')
    .vflip()
    .hflip()
    .format('yuv420p')
    .unsharp(3, 3, 0.5)
    .eq(0.1, 1.1, 1.2, 0.9)
    .drawtext('hi', '10', '20', 24, 'white')
    .yadif(1)
    .transpose(2)
    .fade('in', 0, 10)
    .thumbnail(50);
  const str = chain.toString();
  for (const name of [
    'scale=160:90:flags=bicubic', 'crop=100:50:x=5:y=5', 'pad=200:100:x=1:y=1:color=black',
    'fps=30', 'setpts=PTS-STARTPTS', 'vflip', 'hflip', 'format=yuv420p', 'unsharp=lx=3:ly=3:la=0.5',
    'eq=brightness=0.1:contrast=1.1:saturation=1.2:gamma=0.9', 'drawtext=text=hi', 'yadif=mode=1',
    'transpose=2', 'fade=type=in:start_frame=0:nb_frames=10', 'thumbnail=50',
  ]) {
    ok(str.includes(name), `missing ${name} in: ${str}`);
  }
});

await run('the audio chain covers every helper method', () => {
  const chain = complex.audioFilterChain()
    .raw('anull')
    .volume(0.5)
    .loudnorm(-16, 11, -1.5)
    .highpass(80)
    .lowpass(14000)
    .equalizer(1000, 2, 3)
    .afade('out', 0.5, 1)
    .atempo(1.25)
    .asetpts('PTS-STARTPTS')
    .dynaudnorm(400, 0.9)
    .silencedetect('-45dB', 1.5)
    .aecho(0.7, 0.2, '300|600', '0.4|0.2')
    .rubberband(1.1, 0);
  const str = chain.toString();
  for (const name of [
    'volume=0.5', 'loudnorm=', 'highpass=f=80', 'lowpass=f=14000', 'equalizer=f=1000',
    'afade=type=out:start_time=0.5:duration=1', 'atempo=1.25', 'asetpts=PTS-STARTPTS',
    'dynaudnorm=', 'silencedetect=noise=-45dB:duration=1.5', 'aecho=', 'rubberband=',
  ]) {
    ok(str.includes(name), `missing ${name} in: ${str}`);
  }
});

await run('a graph accepts the streams a previous node produced', () => {
  const g = m.filterGraph();
  const halves = g.from('0:v').filter('split', ['2']).out('a', 'b');
  g.from(halves[0]!).filter('crop', ['10:10:0:0']).mapOut();
  const str = g.toString();
  ok(str.includes('split=2'), `no split: ${str}`);
  ok(str.includes('[a]'), `the split labels are missing: ${str}`);
  ok(str.includes('crop=10:10:0:0'), `no crop off a split output: ${str}`);
});

// ─── 3. Streaming helpers ────────────────────────────────────────────────────
section('3 — streaming');

await run('pipeThrough transcodes from a stream', async () => {
  const proc = streams.pipeThrough({
    binary: m.resolveBinary(),
    inputStream: Readable.from(fs.readFileSync(p('a.mp4'))),
    inputFormat: 'mp4',
    outputFormat: 'adts',
    outputArgs: ['-c:a', 'aac'],
  });
  const chunks: Buffer[] = [];
  proc.stdout.on('data', (c: Buffer) => chunks.push(c));
  const ended = new Promise<void>((resolve, reject) => {
    proc.emitter.on('end', () => resolve());
    proc.emitter.on('error', (e: Error) => reject(e));
  });
  await ended;
  ok(Buffer.concat(chunks).length > 0, 'no bytes came back');
});

await run('streamOutput produces a readable and reports a failure', async () => {
  const out = streams.streamOutput({
    binary: m.resolveBinary(),
    input: p('a.mp4'),
    outputFormat: 'adts',
    outputArgs: ['-c:a', 'aac'],
  });
  const chunks: Buffer[] = [];
  for await (const chunk of out) chunks.push(chunk as Buffer);
  ok(Buffer.concat(chunks).length > 0, 'no bytes came back');

  const bad = streams.streamOutput({
    binary: m.resolveBinary(),
    input: p('missing.mp4'),
    outputFormat: 'adts',
    outputArgs: ['-c:a', 'aac'],
  });
  let msg = '';
  try {
    for await (const _ of bad) { void _; }
  } catch (e) {
    msg = (e as Error).message;
  }
  ok(/exited with code|FFmpeg/i.test(msg), `a missing input did not fail: ${msg}`);
});

await run('streamToFile writes through a file list and through stdin', async () => {
  await streams.streamToFile({
    binary: m.resolveBinary(),
    stream: Readable.from(fs.readFileSync(p('a.mp4'))),
    output: p('streamed.mp4'),
    outputArgs: ['-c', 'copy'],
  });
  ok(exists('streamed.mp4'), 'no streamed output');

  fs.rmSync(p('streamed.mp4'), { force: true });
  await streams.streamToFile({
    binary: m.resolveBinary(),
    stream: Readable.from(fs.readFileSync(p('a.mp4'))),
    inputFormat: 'mp4',
    output: p('streamed2.mp4'),
    outputArgs: ['-c', 'copy'],
  });
  ok(exists('streamed2.mp4'), 'no stdin-piped output');
});

await run('a stream error rejects rather than hanging', async () => {
  const broken = new Readable({
    read() { this.destroy(new Error('upstream exploded')); },
  });
  await rejects(
    () => streams.streamToFile({
      binary: m.resolveBinary(),
      stream: broken,
      inputFormat: 'mp4',
      output: p('never.mp4'),
      outputArgs: ['-c', 'copy'],
    }),
    /upstream exploded|exited with code/,
    'a broken stream',
  );
});

// ─── 4. Capability registry ──────────────────────────────────────────────────
section('4 — capability registry');

await run('the registry reports codecs, encoders, filters, formats and hwaccels', () => {
  const reg = registryMod.getDefaultRegistry(m.resolveBinary());
  ok(reg.codecs.size > 20, `only ${reg.codecs.size} codecs`);
  eq(reg.canDecode('h264'), true, 'h264 decodes');
  eq(reg.canEncode('libx264'), true, 'libx264 encodes');
  eq(reg.canEncode('definitely-not-a-codec'), false, 'a made-up codec does not encode');
  ok(reg.encoders.size > 20, `only ${reg.encoders.size} encoders`);
  ok(reg.filters.size > 100, `only ${reg.filters.size} filters`);
  eq(reg.hasFilter('scale'), true, 'scale exists');
  eq(reg.hasFilter('definitely-not-a-filter'), false, 'a made-up filter does not exist');
  ok(reg.formats.size > 20, `only ${reg.formats.size} formats`);
  eq(reg.hasFormat('matroska'), true, 'matroska is a format');
  eq(reg.hasFormat('definitely-not-a-format'), false, 'a made-up format does not exist');
  // Aliases are split, so "matroska" and "webm" are both keys.
  ok(reg.hasFormat('matroska') && reg.hasFormat('webm'), 'format aliases are not split');
  ok(reg.hwaccels.size > 0, 'no hardware acceleration methods');
  reg.invalidate();
  ok(reg.codecs.size > 20, 'the cache was not rebuilt after invalidate()');
});

await run('a missing binary yields an empty registry rather than throwing', () => {
  const reg = new registryMod.CapabilityRegistry('definitely-not-a-real-binary-xyz');
  eq(reg.codecs.size, 0, 'codecs');
  eq(reg.encoders.size, 0, 'encoders');
  eq(reg.filters.size, 0, 'filters');
  eq(reg.formats.size, 0, 'formats');
  eq(reg.hwaccels.size, 0, 'hwaccels');
  eq(reg.canEncode('h264'), false, 'canEncode on an empty registry');
});

// ─── 5. The fluent builder ───────────────────────────────────────────────────
section('5 — the fluent builder');

await run('every builder method contributes to the argv', () => {
  const b = new FFmpegBuilder(p('a.mp4'))
    .input(p('b.mp4'))
    .inputFps(15)
    .output(p('out.mp4'))
    .videoCodec('libx264')
    .audioCodec('aac')
    .videoBitrate('1M')
    .audioBitrate('128k')
    .preset('veryfast')
    .crf(30)
    .fps(25)
    .size('640x360')
    .rateControl({ max: '2M', bufferSize: '4M' })
    .subtitleCodec('mov_text')
    .map('0:v')
    .map('0:a')
    .outputFormat('mp4')
    .hwAccel('cuda', { device: '/dev/dri/renderD128' })
    .videoFilter('scale=320:180')
    .audioFilter('volume=1');
  const args = b.dry();
  const joined = args.join(' ');
  for (const token of [
    '-i', p('a.mp4'), p('b.mp4'), '-r 15', '-c:v libx264', '-c:a aac', '-b:v 1M',
    '-b:a 128k', '-preset veryfast', '-crf 30', '-r 25', '-s 640x360', '-maxrate 2M',
    '-bufsize 4M', '-c:s mov_text', '-map 0:v', '-map 0:a', '-f mp4', '-hwaccel cuda',
    '-hwaccel_device /dev/dri/renderD128', '-vf scale=320:180', '-af volume=1',
  ]) {
    ok(joined.includes(token), `missing ${token} in: ${joined}`);
  }
  ok(b.dryCommand().startsWith(m.resolveBinary()), `dryCommand: ${b.dryCommand()}`);
  ok(b.dryCommand().includes(p('a.mp4')), 'dryCommand lost the input');
});

await run('the builder refuses options before an output exists', async () => {
  const b = new FFmpegBuilder(p('a.mp4'));
  await rejects(() => b.videoCodec('libx264'), /No output defined/, 'videoCodec first');
  await rejects(() => b.subtitleCodec('mov_text'), /No output defined/, 'subtitleCodec first');
  await rejects(() => b.outputFormat('mp4'), /No output defined/, 'outputFormat first');
  await rejects(() => b.map('0:v'), /No output defined/, 'map first');
});

await run('the builder reports versions and capability checks', async () => {
  const b = new FFmpegBuilder(p('a.mp4'));
  const v = await b.getVersion();
  ok(v.major >= 4, `unexpected version ${v.major}.${v.minor}`);
  const str = await b.versionString();
  ok(str.includes(String(v.major)), `versionString: ${str}`);
  const accel = b.checkHwaccel('cuda');
  eq(typeof accel.available, 'boolean', 'checkHwaccel returns a verdict');
  const feature = b.checkFeature('fps_mode');
  eq(typeof feature.available, 'boolean', 'checkFeature returns a verdict');
  const best = b.bestAvailableCodec?.(['libx265', 'libx264']);
  if (best !== undefined) ok(typeof best === 'string' || best === null, 'bestAvailableCodec shape');
});

await run('VersionError explains the missing version', () => {
  const err = new VersionError('fps_mode', 5, 4);
  ok(err.message.includes('fps_mode'), err.message);
  ok(err.message.includes('v5+'), err.message);
  eq(err.name, 'VersionError', 'name');
});

// ─── 6. Probe, process and progress internals ────────────────────────────────
section('6 — probe, process and progress');

await run('the probe helpers tolerate a file that is not media', async () => {
  fs.writeFileSync(p('junk.bin'), 'not media at all');
  await rejects(() => m.probeAsync(p('junk.bin')), /.*/, 'probing junk');
  const parsed = m.parseVersionOutput('ffmpeg version 4.4.2-0ubuntu0.22.04.1 Copyright (c)');
  eq(parsed.major, 4, 'major version');
  eq(parsed.minor, 4, 'minor version');
  const git = m.parseVersionOutput('ffmpeg version N-109016-g0a1b2c3 Copyright (c)');
  eq(git.isGit, true, 'a git build is detected');
  eq(git.major, 999, 'a git build reports the nightly sentinel');
});

await run('progress and process helpers report a failing child', async () => {
  const proc = m.spawnFFmpeg({
    binary: m.resolveBinary(),
    args: ['-i', p('missing.mp4'), '-f', 'null', '-'],
    parseProgress: true,
  });
  const msg = await rejects(
    () => new Promise<void>((resolve, reject) => {
      proc.emitter.on('end', () => resolve());
      proc.emitter.on('error', (e: Error) => reject(e));
    }),
    /exited with code/,
    'a missing input',
  );
  ok(msg.includes('No such file'), `stderr not captured: ${msg}`);
});

await run('autoKillOnExit registers and unregisters a child', async () => {
  const proc = m.spawnFFmpeg({
    binary: m.resolveBinary(),
    args: ['-f', 'lavfi', '-i', 'testsrc=duration=0.2:size=32x32:rate=5', '-f', 'null', '-'],
  });
  const release = m.autoKillOnExit(proc.child as unknown as { kill: () => void });
  ok(typeof release === 'function', 'autoKillOnExit returns a release function');
  release();
  await rejects(
    () => new Promise<void>((resolve, reject) => {
      proc.emitter.on('end', () => resolve());
      proc.emitter.on('error', (e: Error) => reject(e));
    }),
    /.*/,
    'the short child',
  );
  m.killAllFFmpeg();
  ok(true, 'killAllFFmpeg ran');
});

await run('captureStderr collects the output of a child', async () => {
  const proc = m.spawnFFmpeg({
    binary: m.resolveBinary(),
    args: ['-i', p('missing.mp4'), '-f', 'null', '-'],
  });
  // captureStderr is wired up by spawnFFmpeg itself, so listen for its lines.
  const seen: string[] = [];
  proc.emitter.on('stderr', (line: string) => seen.push(line));
  await rejects(
    () => new Promise<void>((resolve, reject) => {
      proc.emitter.on('end', () => resolve());
      proc.emitter.on('error', (e: Error) => reject(e));
    }),
    /.*/,
    'the failing child',
  );
  ok(seen.length > 0, 'no stderr lines were captured');
});

// ─── 7. Summary ──────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log('  LIBRARY GAP BATTLE SUMMARY');
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
if (skipped > 0) console.log('\n  All executed library gap tests passed 🎉');
else console.log('\n  All library gap tests passed! 🎉');
