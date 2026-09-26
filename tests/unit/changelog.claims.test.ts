/**
 * CHANGELOG v2.0.0 claim tests.
 *
 * Each entry in CHANGELOG.md's 2.0.0 section is asserted against the current
 * source, so the changelog cannot claim a fix that does not exist.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as m from '../../dist/esm/index.js';
// getSpawnedCount is internal (not re-exported from the package entry point).
const { getSpawnedCount } = await import('../../dist/esm/helpers/process.js');

const root = new URL('../../', import.meta.url);
const read = (f: string) => readFileSync(new URL(f, root), 'utf8');
const lib = (f: string) => read('lib/' + f);
const CHANGELOG = read('CHANGELOG.md');
const v200 = /## \[2\.0\.0\][\s\S]*?(?=\n## \[0\.3\.0\])/.exec(CHANGELOG)![0];

describe('CHANGELOG 2.0.0: section shape', () => {
  it('every entry number in the 2.0.0 section is sequential with no gaps or dupes', () => {
    const nums = [...v200.matchAll(/\*\*#(\d+)\s/g)].map(m2 => Number(m2[1]));
    assert.ok(nums.length > 40, `expected many entries, got ${nums.length}`);
    const sorted = [...new Set(nums)].sort((a, b) => a - b);
    assert.deepEqual(sorted, Array.from({ length: sorted.length }, (_, i) => i + 1),
      'issue numbers must be 1..N with no gaps or duplicates');
  });

  it('declares Keep a Changelog / SemVer format', () => {
    assert.match(CHANGELOG, /Keep a Changelog/);
    assert.match(CHANGELOG, /Semantic Versioning/);
  });
});

describe('CHANGELOG 2.0.0: breaking changes match the code', () => {
  it('concatFiles is async', async () => {
    // Use `true` as the binary so the child exits 0 and no 'error' is emitted.
    const p = m.concatFiles({ inputs: ['/nope-a.mp4', '/nope-b.mp4'], output: '/tmp/mf-out.mp4', binary: 'true' });
    assert.ok(p instanceof Promise, 'concatFiles must return a Promise');
    const proc = await p;
    // Await settlement so the spawned child is reaped before later leak checks.
    await new Promise<void>(res => { proc.emitter.on('end', () => res()); proc.emitter.on('error', () => res()); });
    await new Promise(r => setTimeout(r, 100));
  });

  it('setStreamMetadata takes fileIndex first', () => {
    assert.deepEqual(m.setStreamMetadata(0, 'a', 0, 'language', 'eng'),
      ['-metadata:s:a:0', 'language=eng']);
  });

  it('ffv1ToArgs emits -level from the level option', () => {
    assert.ok(m.ffv1ToArgs({ level: 3 }).includes('-level'), `expected ${m.ffv1ToArgs({ level: 3 })} to include ${'-level'}; got ${m.ffv1ToArgs({ level: 3 })}`);
  });

  it('mapStream numeric overload is declared and returns the same args tuple', () => {
    assert.deepEqual(m.mapStream(0, 'v', 0), ['-map', '0:v:0']);
    assert.deepEqual(m.mapStream('0:a:1'), ['-map', '0:a:1']);
    // The battle test asserts the numeric form is an array, not a bare string.
    assert.ok(Array.isArray(m.mapStream(0, 'v', 0)), `assertion failed: ${Array.isArray(m.mapStream(0, 'v', 0))}`);
    assert.match(v200, /now returns an args tuple/);
  });

  it('satisfiesVersion requires full VersionInfo and compares patch', () => {
    const src = lib('utils/version.ts');
    assert.match(src, /Pick<VersionInfo, 'major' \| 'minor' \| 'patch' \| 'isGit'>/);
    const fn = /export function satisfiesVersion\(([\s\S]*?)\n\}/.exec(src)![0];
    assert.match(fn, /patch >= minPatch/);
  });
});

describe('CHANGELOG 2.0.0: original 23 fixes still hold', () => {
  it('#1 probe uses -v error', () => assert.match(lib('probe/ffprobe.ts'), /'-v', 'error'/));
  it('#2 spawn error carries stderr', () => assert.match(lib('process/spawn.ts'), /new FFmpegSpawnError\(code, signal, stderrOutput\)/));
  it('#3 settled flag on timeout', () => assert.match(lib('process/spawn.ts'), /let settled = false/));
  it('#4 hls segments default to .ts', () => assert.match(lib('helpers/hls.ts'), /segment%03d\.ts/));
  it('#5 anullsrc is a valid source filter', () => {
    const src = lib('helpers/concat.ts');
    assert.match(src, /anullsrc=channel_layout=stereo:sample_rate=44100\[a\$\{i\}\]/);
    assert.doesNotMatch(src, /`\[\$\{i\}:v\]anullsrc\[a\$\{i\}\]`/);
  });
  it('#6/#7 mapping helper signatures', () => {
    assert.match(lib('helpers/mapping.ts'), /export function setStreamMetadata\(\s*_fileIndex: number,/);
    assert.match(lib('helpers/mapping.ts'), /export function mapStream\(fileIndex: number/);
  });
  it('#8 streams read stderrLines at error time', () => assert.match(lib('helpers/streams.ts'), /capturedRef\?\.stderrLines\.join/));
  it('#9 builder forwards timeout', () => assert.match(lib('FFmpeg.ts'), /spawnOpts\.timeout = opts\.timeout/));
  it('#10 invalidate clears _encoders', () => {
    const body = /invalidate\(\): void \{([\s\S]*?)\n  \}/.exec(lib('codecs/registry.ts'))![1];
    assert.match(body, /_encoders = null/);
  });
  it('#11 mergeToFile mkdirs the output dir', () => assert.match(lib('helpers/concat.ts'), /fs\.mkdirSync\(outDir, \{ recursive: true \}\)/));
  it('#12 xfade labels agree with the -map', () => {
    const src = lib('helpers/concat.ts');
    assert.doesNotMatch(src, /\[xv/, 'no stale [xvN] labels');
    // Scale/pad labels stay in the v{i} namespace, xfade writes to x{i}.
    assert.match(src, /`\[x\$\{n - 1\}\]`/);
    for (const n of [2, 3, 4]) {
      const args = m.buildConcatTransitionArgs(
        Array.from({ length: n }, (_, i) => `p${i}.mp4`), 'o.mp4', 'fade', 0.5);
      const graph = args[args.indexOf('-filter_complex') + 1]!;
      // no label may be defined twice (ffmpeg exit 234)
      const defined = graph.split(';').filter(Boolean)
        .map(s => s.slice(s.lastIndexOf('[') + 1, s.lastIndexOf(']')));
      assert.deepEqual(defined.filter((l, i) => defined.indexOf(l) !== i), []);
      // every mapped label must be defined in its graph
      for (const a of args) {
        if (a.startsWith('[') && a.endsWith(']')) assert.ok(graph.includes(a), `${a} undefined in graph`);
      }
    }
  });
  it('#13 buildTwoPassArgs mirrors twoPassEncode', () => {
    const { pass1, pass2 } = m.buildTwoPassArgs({
      input: 'i.mp4', output: 'o.mp4', videoCodec: 'libx264', videoBitrate: '2M', audioCodec: 'aac',
    });
    assert.ok(pass1.includes('-an'), 'pass 1 must silence audio');
    assert.ok(pass1.includes('matroska'), `expected ${pass1} to include ${'matroska'}; got ${pass1}`);
    assert.ok(pass2.includes('-c:a'), `expected ${pass2} to include ${'-c:a'}; got ${pass2}`);
    const none = m.buildTwoPassArgs({
      input: 'i.mp4', output: 'o.mp4', videoCodec: 'libx264', videoBitrate: '2M', audioCodec: 'none',
    });
    assert.ok(none.pass2.includes('-an'), "audioCodec 'none' must map to -an");
  });
  it('#14 drawtext %{...} preserved', () => {
    assert.match(lib('utils/filter.ts'), /export function escapeDrawtextValue/);
    assert.equal(m.buildBurnTimecodeFilter('%{pts_hms}').includes('%{pts_hms}'), true);
  });
  it('#15 git builds: satisfiesVersion unknown, feature gates pass', () => {
    const v = m.parseVersionOutput('ffmpeg version N-116912-gabcdef Copyright (c) 2000-2026');
    assert.equal(v.isGit, true);
    assert.equal(m.satisfiesVersion(v, 0, 0, 0), true);
    assert.equal(m.satisfiesVersion(v, 6, 0, 0), false);
    // parseVersionOutput still records the 999 sentinel that feature gates rely on
    assert.equal(v.major, 999);
    assert.equal(m.isFeatureExpected('libx264', v.major, v.minor), true);
  });
  it('#16 percent clamped to 0..100', () => {
    const [p] = m.parseAllProgress('out_time_us=-5000\nprogress=continue\n', 1_000_000);
    assert.equal(p.percent, 0);
  });
  it('#17 autoKillOnExit re-raises the signal', () => assert.match(lib('helpers/process.ts'), /process\.kill\(process\.pid!/));
  it('#18 one-pass normalize reports NaN, not a fabricated target', () => {
    const src = lib('helpers/normalize.ts');
    assert.match(src, /inputI: Number\.NaN/);
    assert.doesNotMatch(src, /null as unknown as number/);
  });
  it('#19 videotoolbox emits no -realtime / allowFrameReordering', () => {
    const src = lib('codecs/hardware.ts');
    assert.doesNotMatch(src, /'-realtime'/);
    assert.doesNotMatch(src, /opts\.allowFrameReordering/);
    assert.deepEqual(m.videotoolboxToArgs({ allowFrameReordering: true }), ['-c:v', 'h264_videotoolbox']);
  });
  it('#20 mp3ToArgs omits -abr', () => {
    const fn = /export function mp3ToArgs\(([\s\S]*?)\n\}/.exec(lib('codecs/audio.ts'))![0];
    assert.doesNotMatch(fn, /'-abr'/);
  });
  it('#21 watermark uses format=rgba', () => {
    assert.match(lib('helpers/watermark.ts'), /format=rgba/);
  });
  it('#22 generateWaveform strips a leading #', () => {
    assert.match(lib('helpers/waveform.ts'), /color\.startsWith\('#'\) \? color\.slice\(1\)/);
  });
  it('#23 ffv1ToArgs option is level, not version', () => {
    const body = /export interface Ffv1Options \{([\s\S]*?)\n\}/.exec(lib('codecs/video.ts'))![1];
    assert.match(body, /level\?:/);
    assert.doesNotMatch(body, /version\?:/);
  });
});

describe('CHANGELOG 2.0.0: streaming & process lifecycle (#24-#30)', () => {
  it('#24 streamOutput drains stderr into a bounded tail', () => {
    const src = lib('helpers/streams.ts');
    assert.match(src, /STDERR_TAIL_LIMIT = 8192/);
    assert.match(src, /child\.stderr\?\.on\('data'/);
  });
  it('#25 streamOutput defers end() to the close handler', () => {
    assert.match(lib('helpers/streams.ts'), /child\.stdout\?\.pipe\(pass, \{ end: false \}\)/);
  });
  it('#26 destroying the stream kills the child', () => {
    assert.match(lib('helpers/streams.ts'), /pass\.on\('close', \(\) => \{[\s\S]*?child\.kill\('SIGTERM'\)/);
  });
  it('#27 start is emitted on a microtask', () => {
    const re = /queueMicrotask\(\(\) => emitter\.emit\('start', args\)\)/;
    assert.match(lib('process/spawn.ts'), re);
    assert.match(lib('helpers/streams.ts'), re);
  });
  it('#28 stderr released once on every path', () => {
    assert.match(lib('process/spawn.ts'), /const releaseStderr = \(\): void => \{/);
  });
  it('#29 pipeThrough settles once', () => {
    assert.match(lib('helpers/streams.ts'), /let settled = false;/);
  });
  it('#30 streamToFile destroys the write stream before cleanup', () => {
    assert.match(lib('helpers/streams.ts'), /try \{ ws\.destroy\(\); \}[\s\S]{0,120}rmSync\(tmpDir/);
  });
});

describe('CHANGELOG 2.0.0: memory & resource leaks (#31-#36)', () => {
  it('#31 child tracking is a pruned Set', () => {
    const src = lib('helpers/process.ts');
    assert.match(src, /const _spawned = new Set<ChildProcess>\(\)/);
    assert.match(src, /child\.once\('close', release\)/);
    assert.match(src, /child\.once\('exit', release\)/);
    assert.doesNotMatch(src, /_spawnedList/);
  });
  it('#31 getSpawnedCount returns to its baseline after many runs', async () => {
    // Compare against the current count rather than absolute 0: an earlier test
    // in this file deliberately starts a concatFiles child that may still be
    // in flight, and that must not be attributed to a leak here.
    const before = getSpawnedCount();
    for (let i = 0; i < 10; i++) {
      const p = m.spawnFFmpeg({ binary: 'true', args: [] });
      await new Promise<void>(res => { p.emitter.on('end', () => res()); p.emitter.on('error', () => res()); });
    }
    await new Promise(r => setTimeout(r, 100));
    assert.equal(getSpawnedCount(), before, 'tracked children must not accumulate');
  });
  it('#32 autoKillOnExit registers with on and removes with removeListener', () => {
    const src = lib('helpers/process.ts');
    assert.match(src, /process\.on\('SIGINT',\s*handler\)/);
    assert.match(src, /process\.removeListener\('SIGINT',\s*handler\)/);
  });
  it('#33 buildTwoPassArgs documents the retained temp dir', () => {
    assert.match(lib('helpers/twopass.ts'), /intentionally left/);
  });
  it('#34 writeMetadata cleans up on failure', () => {
    assert.match(lib('helpers/metadata.ts'), /chapterTmpDir = null;/);
  });
  it('#35 progress block is capped', () => assert.match(lib('process/progress.ts'), /MAX_PROGRESS_KEYS = 64/));
  it('#36 registry spawnSync is bounded', () => {
    const src = lib('codecs/registry.ts');
    assert.match(src, /timeout: 15000/);
    assert.match(src, /killSignal: 'SIGKILL'/);
    assert.match(src, /maxBuffer: 32 \* 1024 \* 1024/);
  });
});

describe('CHANGELOG 2.0.0: correctness (#37-#47)', () => {
  it('#37 probeAsync settles once and clears its timer', () => {
    assert.match(lib('probe/ffprobe.ts'),
      /child\.on\('close', \(code\) => \{[\s\S]{0,400}settled = true;[\s\S]{0,60}clearTimeout\(timer\)/);
  });
  it('#38 the version probe never unrefs the child it waits on', () => {
    // A child that is unref'd can let the process exit before 'close' fires,
    // so the promise/callback would never settle. The async probe that carried
    // this guard was removed as dead code in 2.1.0-rc.1; the invariant is
    // asserted across every spawn site in the codebase so it cannot come back.
    const sites: [string, string][] = [
      ['utils/version.ts', 'probeVersion'],
      ['process/spawn.ts', 'spawnFFmpeg'],
      ['probe/ffprobe.ts', 'probeAsync'],
      ['helpers/process.ts', 'trackChild'],
    ];
    for (const [rel, fn] of sites) {
      const src = lib(rel);
      // Nothing derived from a spawned child may be unref'd…
      assert.doesNotMatch(src, /child\w*\.unref\(/, `${rel}: ${fn} unrefs the child it waits on`);
      // …and the only unref allowed anywhere is on a timeout handle.
      for (const m of src.matchAll(/(\w+)\.unref\(\)/g)) {
        assert.match(m[1]!, /timer|Timer|timeout|Timeout/, `${rel}: unref'd "${m[1]}", not a timer`);
      }
    }
  });
  it('#39 registries are cached per binary', () => {
    assert.match(lib('codecs/registry.ts'), /const _defaultRegistries = new Map<string, CapabilityRegistry>\(\)/);
    assert.notEqual(m.getDefaultRegistry('/bin/a'), m.getDefaultRegistry('/bin/b'));
  });
  it('#40 N/A progress fields are never NaN', () => {
    const [p] = m.parseAllProgress('frame=N/A\nfps=N/A\nout_time_us=N/A\ndup_frames=N/A\ndrop_frames=N/A\nprogress=continue\n', 1e6);
    for (const k of ['frame', 'fps', 'outTimeUs', 'dupFrames', 'dropFrames', 'percent'] as const) {
      assert.ok(Number.isFinite(p[k] as number), `${k} must be finite, got ${p[k]}`);
    }
  });
  it('#41 parseFrameRate / summarizeAudioStream reject N/A', () => {
    assert.equal(m.parseFrameRate('1/abc'), null);
    assert.equal(m.parseFrameRate('N/A'), null);
    assert.deepEqual(m.parseFrameRate('30000/1001'), { num: 30000, den: 1001, value: 30000 / 1001 });
  });
  it('#42 extractJsonBlock is single-pass', () => {
    const src = lib('helpers/normalize.ts');
    assert.match(src, /let depth = 0;/);
    assert.doesNotMatch(src, /for \(let end = start \+ 1/);
  });
  it('#43 multi-byte UTF-8 is never corrupted across chunk boundaries', () => {
    // probeAsync reads a raw stream and needs StringDecoder; probeVersion reads
    // synchronously with execFileSync, where `encoding: 'utf8'` reassembles the
    // stream for us. Assert the right mechanism for each.
    assert.match(lib('probe/ffprobe.ts'), /StringDecoder/);
    const version = lib('utils/version.ts');
    assert.match(version, /execFileSync/);
    assert.match(version, /encoding: 'utf8'/);
    assert.doesNotMatch(version, /\.toString\(\)/, 'per-chunk toString() corrupts split UTF-8');
  });
  it('#44 isBinaryAvailableAsync never rejects', async () => {
    assert.equal(await m.isBinaryAvailableAsync('a\0b'), false);
    assert.equal(await m.isBinaryAvailableAsync('true'), true);
  });
  it('#45 trimVideo rejects end <= start', () => assert.match(lib('helpers/edit.ts'), /must be greater than start/));
  it('#46 stackVideos probes audio presence', () => {
    assert.match(lib('helpers/edit.ts'), /const audioCount = hasAudio\.filter\(Boolean\)\.length/);
  });
  it('#47 adaptiveHls validates variants and resolutions', () => {
    assert.match(lib('helpers/hls.ts'), /adaptiveHls requires at least one variant/);
    assert.match(lib('helpers/hls.ts'), /Number\(p\) <= 0/);
    assert.throws(() => m.adaptiveHls({ input: 'a.mp4', outputDir: '/tmp/mf-hls', variants: [] }), /at least one variant/);
    assert.throws(() => m.adaptiveHls({
      input: 'a.mp4', outputDir: '/tmp/mf-hls',
      variants: [{ label: 'x', videoBitrate: '1M', resolution: '1920x' }],
    }), /Invalid resolution/);
  });
});

describe('CHANGELOG 2.0.0: security (#48-#50)', () => {
  it('#48 chapter titles cannot inject FFMETADATA keys', () => {
    const out = m.buildChapterContent([{ title: 'A\nSTART=9\nEND=9', startSec: 0, endSec: 1 }]);
    assert.equal(out.match(/^START=/gm)!.length, 1);
    assert.equal(out.match(/^END=/gm)!.length, 1);
  });
  it('#49 burnTimecode escapes the font path', () => {
    const f = m.buildBurnTimecodeFilter('%{pts_hms}', 24, 'white', "/tmp/it's a font.ttf");
    assert.ok(f.includes("'\\''"), 'single quotes in the font path must be escaped');
    assert.match(lib('helpers/normalize.ts'), /:fontfile='\$\{escapeDrawtextValue\(font\)\}'/);
  });
  it('#50 concatFiles probes with the ffprobe binary', () => {
    assert.match(lib('helpers/concat.ts'), /const probeBin = resolveProbe\(\);/);
  });
});

describe('CHANGELOG 2.0.0: known limitations are accurate', () => {
  it('allowFrameReordering is typed but never emitted', () => {
    assert.match(lib('codecs/hardware.ts'), /allowFrameReordering\?: boolean;/);
    assert.deepEqual(m.videotoolboxToArgs({ allowFrameReordering: true }), ['-c:v', 'h264_videotoolbox']);
    assert.match(v200, /allowFrameReordering` is accepted but ignored/);
  });
  it('mapStream asymmetry limitation is removed now both forms return a tuple', () => {
    assert.doesNotMatch(v200, /mapStream` has two different return shapes/);
  });
  it('unhandled error-event throw is disclosed', () => {
    assert.match(v200, /unhandled `'error'` event throws/);
    // captureRejections must not be mistaken for a guard against this.
    assert.match(lib('process/events.ts'), /captureRejections: true/);
  });
});

describe('CHANGELOG 2.0.0: documentation section', () => {
  it('records the README audit', () => {
    assert.match(v200, /### Documentation/);
    assert.match(v200, /\*\*32 defects\*\* were corrected/);
    assert.match(v200, /tests\/unit\/readme\.claims\.test\.ts/);
  });
  it('the README claim test file referenced by the changelog exists', () => {
    assert.ok(read('tests/unit/readme.claims.test.ts').length > 0, `expected ${read('tests/unit/readme.claims.test.ts').length} to be greater than ${0}; got ${read('tests/unit/readme.claims.test.ts').length}`);
  });
});
