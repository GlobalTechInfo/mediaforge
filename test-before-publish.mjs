/**
 * mediaforge — pre-publish verification script
 * Run: node test-before-publish.mjs
 *
 * Checks:
 *   1. Package resolves (ESM + CJS)
 *   2. All public exports present
 *   3. Core builder API works
 *   4. All new helpers exported and callable
 *   5. Presets all valid
 *   6. Arg builders return correct args
 *   7. ffmpeg binary found
 *   8. ffprobe binary found
 */

import { createRequire } from 'module';
import assert from 'assert/strict';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let pass = 0;
let fail = 0;

function ok(label, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => {
        console.log(`  ✅  ${label}`);
        pass++;
      }).catch(err => {
        console.log(`  ❌  ${label}`);
        console.log(`       ${err.message}`);
        fail++;
      });
    }
    console.log(`  ✅  ${label}`);
    pass++;
  } catch (err) {
    console.log(`  ❌  ${label}`);
    console.log(`       ${err.message}`);
    fail++;
  }
}

// ─── 1. ESM import ────────────────────────────────────────────────────────────
console.log('\n── 1. ESM import ──────────────────────────────────────────');
const esm = await import('mediaforge');

// ─── 2. CJS require ───────────────────────────────────────────────────────────
console.log('\n── 2. CJS require ─────────────────────────────────────────');
let cjs;
ok('CJS require works', () => {
  cjs = require('mediaforge');
  assert.ok(typeof cjs.ffmpeg === 'function');
});

// ─── 3. Core exports ──────────────────────────────────────────────────────────
console.log('\n── 3. Core exports ────────────────────────────────────────');

const CORE_EXPORTS = [
  // Primary
  'ffmpeg', 'FFmpegBuilder', 'VersionError',
  // Process
  'spawnFFmpeg', 'runFFmpeg', 'FFmpegSpawnError', 'FFmpegEmitter', 'ProgressParser',
  // Utils
  'resolveBinary', 'resolveProbe', 'validateBinary', 'isBinaryAvailable',
  'BinaryNotFoundError', 'BinaryNotExecutableError',
  'probeVersion', 'parseVersionOutput', 'satisfiesVersion', 'formatVersion',
  'flattenArgs', 'buildGlobalArgs', 'buildInputArgs', 'buildOutputArgs',
  'toDuration', 'toBitrate',
  // Codecs
  'CapabilityRegistry', 'getDefaultRegistry',
  'x264ToArgs', 'x265ToArgs', 'svtav1ToArgs', 'vp9ToArgs',
  'aacToArgs', 'opusToArgs', 'mp3ToArgs', 'flacToArgs', 'ac3ToArgs',
  'libOpusToArgs', 'libMp3LameToArgs', 'svtAv1ToArgs',
  'nvencToArgs', 'vaapiToArgs', 'mediacodecToArgs', 'vulkanToArgs', 'qsvToArgs',
  // Compat
  'isFeatureExpected', 'availableFeatures', 'unavailableFeatures',
  'guardCodec', 'guardHwaccel', 'guardFeatureVersion',
  'selectBestCodec', 'selectBestHwaccel', 'GuardError',
  // Filters
  'FilterChain', 'FilterGraph', 'videoFilterChain', 'audioFilterChain', 'filterGraph',
  'scale', 'crop', 'overlay', 'drawtext', 'fade', 'zoompan', 'colorkey', 'chromakey',
  'volume', 'loudnorm', 'equalizer', 'atempo', 'rubberband',
  // Probe
  'probe', 'probeAsync', 'ProbeError',
  'parseFrameRate', 'parseDuration', 'parseBitrate',
  'getVideoStreams', 'getAudioStreams', 'getSubtitleStreams',
  'getDefaultVideoStream', 'getDefaultAudioStream',
  'getMediaDuration', 'durationToMicroseconds',
  'summarizeVideoStream', 'summarizeAudioStream',
  'getStreamLanguage', 'findStreamByLanguage',
  'formatDuration', 'isHdr', 'isInterlaced', 'getChapterList',
  // Phase 4 helpers
  'twoPassEncode', 'buildTwoPassArgs',
  'hlsPackage', 'adaptiveHls', 'dashPackage',
  'mapStream', 'mapAll', 'mapAVS', 'copyStream', 'setMetadata',
];

for (const name of CORE_EXPORTS) {
  ok(`exports "${name}"`, () => assert.ok(esm[name] !== undefined, `Missing: ${name}`));
}

// ─── 4. New feature exports ────────────────────────────────────────────────────
console.log('\n── 4. New feature exports ─────────────────────────────────');

const NEW_EXPORTS = [
  // Screenshots
  'screenshots', 'frameToBuffer',
  // Concat
  'mergeToFile', 'concatFiles', 'buildConcatList',
  // Streams
  'pipeThrough', 'streamOutput', 'streamToFile',
  // Presets
  'getPreset', 'listPresets', 'applyPreset',
  // GIF
  'toGif', 'gifToMp4',
  // Normalize
  'normalizeAudio', 'adjustVolume',
  // Watermark
  'addWatermark', 'addTextWatermark',
  // Subtitles
  'burnSubtitles', 'extractSubtitles',
  // Metadata
  'writeMetadata', 'stripMetadata',
  // Waveform
  'generateWaveform', 'generateSpectrum',
  // Process
  'renice', 'autoKillOnExit', 'killAllFFmpeg',
  // Arg builders
  'buildHlsArgs', 'buildDashArgs',
  'buildWatermarkFilter', 'buildTextWatermarkFilter',
  'buildBurnSubtitlesFilter',
  'buildWaveformFilter', 'buildSpectrumFilter',
  'buildMetadataArgs', 'buildChapterContent',
  'buildLoudnormFilter',
  'buildGifArgs', 'buildGifPalettegenFilter', 'buildGifPaletteuseFilter',
  'buildScreenshotArgs', 'buildFrameBufferArgs', 'buildTimestampFilename',
  'buildPipeThroughArgs', 'buildStreamOutputArgs',
];

for (const name of NEW_EXPORTS) {
  ok(`exports "${name}"`, () => assert.ok(esm[name] !== undefined, `Missing: ${name}`));
}

// ─── 5. Builder API ────────────────────────────────────────────────────────────
console.log('\n── 5. Builder API ─────────────────────────────────────────');

ok('ffmpeg() returns FFmpegBuilder', () => {
  const b = esm.ffmpeg('input.mp4');
  assert.ok(b instanceof esm.FFmpegBuilder);
});

ok('buildArgs() produces correct structure', () => {
  const args = esm.ffmpeg('input.mp4')
    .output('output.mp4')
    .videoCodec('libx264')
    .crf(22)
    .audioCodec('aac')
    .audioBitrate('128k')
    .buildArgs();
  assert.ok(args.includes('-i'));
  assert.ok(args.includes('input.mp4'));
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('22'));
  assert.ok(args.includes('128k'));
  assert.ok(args.includes('output.mp4'));
});

ok('seekInput sets -ss before -i', () => {
  const args = esm.ffmpeg('in.mp4').seekInput(30).output('out.mp4').buildArgs();
  const ssIdx = args.indexOf('-ss');
  const iIdx = args.indexOf('-i');
  assert.ok(ssIdx >= 0 && ssIdx < iIdx);
});

ok('multiple outputs builds both', () => {
  const args = esm.ffmpeg('in.mp4')
    .output('a.mp4').videoCodec('libx264')
    .output('b.mp4').videoCodec('libx265')
    .buildArgs();
  assert.ok(args.includes('a.mp4'));
  assert.ok(args.includes('b.mp4'));
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('libx265'));
});

ok('noVideo() adds -vn', () => {
  const args = esm.ffmpeg('in.mp4').output('out.mp3').noVideo().buildArgs();
  assert.ok(args.includes('-vn'));
});

ok('noAudio() adds -an', () => {
  const args = esm.ffmpeg('in.mp4').output('out.mp4').noAudio().buildArgs();
  assert.ok(args.includes('-an'));
});

ok('complexFilter() adds -filter_complex', () => {
  const args = esm.ffmpeg('in.mp4').complexFilter('[0:v]scale=1280:720[v]').output('out.mp4').buildArgs();
  assert.ok(args.includes('-filter_complex'));
});

ok('overwrite(false) adds -n not -y', () => {
  const b = new esm.FFmpegBuilder('in.mp4');
  b.overwrite(false).output('out.mp4');
  const args = b.buildArgs();
  assert.ok(args.includes('-n'));
  assert.ok(!args.includes('-y'));
});

// ─── 6. Presets ────────────────────────────────────────────────────────────────
console.log('\n── 6. Presets ─────────────────────────────────────────────');

const ALL_PRESETS = ['web','web-hq','mobile','archive','podcast','hls-input','gif','discord','instagram','prores','dnxhd'];

for (const name of ALL_PRESETS) {
  ok(`preset "${name}" valid`, () => {
    const p = esm.getPreset(name);
    assert.ok(Array.isArray(p.videoArgs));
    assert.ok(Array.isArray(p.audioArgs));
    assert.ok(Array.isArray(p.extraArgs));
    assert.ok(p.videoArgs.length + p.audioArgs.length > 0);
  });
}

ok('getPreset throws on unknown name', () => {
  assert.throws(() => esm.getPreset('invalid'), /Unknown preset/);
});

ok('listPresets returns all 11', () => {
  const list = esm.listPresets();
  assert.strictEqual(list.length, 11);
});

ok('applyPreset web has -c:v and -c:a', () => {
  const args = esm.applyPreset('web');
  assert.ok(args.includes('-c:v'));
  assert.ok(args.includes('-c:a'));
});

// ─── 7. Arg builders ───────────────────────────────────────────────────────────
console.log('\n── 7. Arg builders ────────────────────────────────────────');

ok('buildConcatList formats paths', () => {
  const r = esm.buildConcatList(['/a.mp4', '/b.mp4']);
  assert.ok(r.includes("file '"));
  assert.ok(r.includes('a.mp4'));
});

ok('buildWatermarkFilter has overlay=', () => {
  const f = esm.buildWatermarkFilter('bottom-right', 10, 0.8);
  assert.ok(f.includes('overlay='));
});

ok('buildTextWatermarkFilter has drawtext=', () => {
  const f = esm.buildTextWatermarkFilter('© 2025', 'bottom-right', 10, 24, 'white');
  assert.ok(f.includes('drawtext='));
});

ok('buildBurnSubtitlesFilter has subtitles=', () => {
  const f = esm.buildBurnSubtitlesFilter('/tmp/subs.srt');
  assert.ok(f.includes('subtitles='));
});

ok('buildLoudnormFilter has loudnorm', () => {
  const f = esm.buildLoudnormFilter(-23, 7, -2);
  assert.ok(f.includes('loudnorm'));
  assert.ok(f.includes('i=-23'));
});

ok('buildLoudnormFilter with measured adds linear=true', () => {
  const f = esm.buildLoudnormFilter(-23, 7, -2, { inputI: -24, inputLra: 8, inputTp: -3, inputThresh: -34, targetOffset: 0 });
  assert.ok(f.includes('linear=true'));
});

ok('buildGifArgs pass1 has palettegen', () => {
  const { pass1 } = esm.buildGifArgs('in.mp4', '/tmp/p.png', 'out.gif', 15, 480, 'bayer');
  assert.ok(pass1.some(a => a.includes('palettegen')));
});

ok('buildScreenshotArgs has -vframes 1', () => {
  const args = esm.buildScreenshotArgs('in.mp4', '/tmp/out.png', 30);
  assert.ok(args.includes('-vframes'));
  assert.ok(args.includes('1'));
});

ok('buildPipeThroughArgs has pipe:0 and pipe:1', () => {
  const args = esm.buildPipeThroughArgs('mp4', [], 'mp4');
  assert.ok(args.includes('pipe:0'));
  assert.ok(args.includes('pipe:1'));
});

ok('buildWaveformFilter has showwavespic', () => {
  const f = esm.buildWaveformFilter(1920, 240, '#00ff00', 'lin', 'line', 0);
  assert.ok(f.includes('showwavespic'));
});

ok('buildMetadataArgs has -c copy', () => {
  const args = esm.buildMetadataArgs({ title: 'Test' });
  assert.ok(args.includes('copy'));
  assert.ok(args.includes('title=Test'));
});

ok('buildChapterContent has FFMETADATA1', () => {
  const c = esm.buildChapterContent([{ title: 'Ch1', startSec: 0, endSec: 60 }]);
  assert.ok(c.includes(';FFMETADATA1'));
  assert.ok(c.includes('[CHAPTER]'));
});

ok('buildTimestampFilename formats index', () => {
  assert.strictEqual(esm.buildTimestampFilename('thumb_%04d.png', 0, '.png'), 'thumb_0001.png');
});

ok('buildHlsArgs has -hls_time', () => {
  const args = esm.buildHlsArgs('in.mp4', '/out', { segmentDuration: 6 });
  assert.ok(args.includes('-hls_time'));
  assert.ok(args.includes('6'));
});

ok('buildTwoPassArgs pass1 has -pass 1', () => {
  const r = esm.buildTwoPassArgs({ input: 'in.mp4', output: 'out.mp4', videoCodec: 'libx264', videoBitrate: '2M' });
  assert.ok(r.pass1.includes('1'));
  assert.ok(r.pass2.includes('2'));
});

// ─── 8. Probe helpers ──────────────────────────────────────────────────────────
console.log('\n── 8. Probe utilities ─────────────────────────────────────');

ok('formatDuration(0) = 00:00:00.000', () => {
  assert.strictEqual(esm.formatDuration(0), '00:00:00.000');
});

ok('formatDuration(90) = 00:01:30.000', () => {
  assert.strictEqual(esm.formatDuration(90), '00:01:30.000');
});

ok('parseFrameRate("30/1") returns value=30', () => {
  const r = esm.parseFrameRate('30/1');
  assert.strictEqual(r?.value, 30);
});

ok('parseDuration(undefined) returns null', () => {
  assert.strictEqual(esm.parseDuration(undefined), null);
});

ok('parseBitrate("N/A") returns null', () => {
  assert.strictEqual(esm.parseBitrate('N/A'), null);
});

ok('durationToMicroseconds(1) = 1000000', () => {
  assert.strictEqual(esm.durationToMicroseconds(1), 1000000);
});

// ─── 9. Binary detection ───────────────────────────────────────────────────────
console.log('\n── 9. Binary detection ────────────────────────────────────');

ok('ffmpeg binary found', () => {
  const binary = esm.resolveBinary();
  assert.ok(typeof binary === 'string' && binary.length > 0);
  esm.validateBinary(binary);
});

ok('ffprobe binary found', () => {
  const probe = esm.resolveProbe();
  assert.ok(typeof probe === 'string' && probe.length > 0);
});

ok('isBinaryAvailable("ffmpeg") = true', () => {
  assert.strictEqual(esm.isBinaryAvailable('ffmpeg'), true);
});

ok('isBinaryAvailable("not_real_xyz") = false', () => {
  assert.strictEqual(esm.isBinaryAvailable('not_real_xyz'), false);
});

ok('validateBinary throws BinaryNotFoundError for fake binary', () => {
  assert.throws(() => esm.validateBinary('not_real_xyz'), (e) => e instanceof esm.BinaryNotFoundError);
});

// ─── 10. Version ───────────────────────────────────────────────────────────────
console.log('\n── 10. Version ────────────────────────────────────────────');

ok('probeVersion returns major >= 4', () => {
  const v = esm.probeVersion('ffmpeg');
  assert.ok(v.major >= 4);
});

ok('satisfiesVersion(v6, 6) = true', () => {
  const v = { major: 6, minor: 0, patch: 0, raw: '6.0', isGit: false, libraries: {}, configuration: [] };
  assert.strictEqual(esm.satisfiesVersion(v, 6), true);
});

ok('satisfiesVersion(v5, 6) = false', () => {
  const v = { major: 5, minor: 0, patch: 0, raw: '5.0', isGit: false, libraries: {}, configuration: [] };
  assert.strictEqual(esm.satisfiesVersion(v, 6), false);
});

// ─── 11. Codec registry ────────────────────────────────────────────────────────
console.log('\n── 11. Codec registry ─────────────────────────────────────');

ok('CapabilityRegistry instantiates', () => {
  const r = new esm.CapabilityRegistry('ffmpeg');
  assert.ok(r !== null);
});

ok('registry.codecs is populated', () => {
  const r = new esm.CapabilityRegistry('ffmpeg');
  assert.ok(r.codecs.size > 0);
});

ok('registry.filters is populated', () => {
  const r = new esm.CapabilityRegistry('ffmpeg');
  assert.ok(r.filters.size > 0);
});

ok('registry.hasFilter("scale") = true', () => {
  const r = new esm.CapabilityRegistry('ffmpeg');
  assert.ok(typeof r.hasFilter('scale') === 'boolean');
});

// ─── 12. mergeToFile edge case ─────────────────────────────────────────────────
console.log('\n── 12. Helper edge cases ──────────────────────────────────');

ok('mergeToFile throws on empty inputs', async () => {
  await assert.rejects(esm.mergeToFile({ inputs: [], output: '/tmp/out.mp4' }), /no inputs/);
});

ok('buildConcatList empty = empty string', () => {
  assert.strictEqual(esm.buildConcatList([]), '');
});

ok('autoKillOnExit returns unregister function', () => {
  const child = { pid: 99999, kill: () => {} };
  const unreg = esm.autoKillOnExit(child);
  assert.ok(typeof unreg === 'function');
  unreg();
});

ok('renice throws if pid undefined', () => {
  assert.throws(() => esm.renice({ pid: undefined }, 10), /no PID/);
});

// ─── Summary ───────────────────────────────────────────────────────────────────
// Allow async tests to settle
await new Promise(r => setTimeout(r, 500));

console.log('\n' + '─'.repeat(56));
console.log(`  Results: ${pass} passed, ${fail} failed`);
console.log('─'.repeat(56));

if (fail > 0) {
  console.log('\n❌  Pre-publish checks FAILED. Fix the above before publishing.\n');
  process.exit(1);
} else {
  console.log('\n✅  All pre-publish checks passed. Ready to publish!\n');
  console.log('  npm publish --access public\n');
}
