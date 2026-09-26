/**
 * Unit tests for the features added in 2.1.0-rc.1.
 *
 * Split into two halves:
 *  - pure builders/parsers, which need no ffmpeg at all and are tested hard,
 *    including every validation branch;
 *  - encoder-backed runs, which are skipped when ffmpeg is unavailable.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  buildVmafFilter, buildSsimFilter, buildPsnrFilter,
  parseVmafLog, parseStatsFile, measureQuality,
} from '../../dist/esm/helpers/quality.js';
import {
  buildToneMapFilter, toneMapHdrToSdr, SDR_TARGET_PROPERTIES,
} from '../../dist/esm/helpers/tone.js';
import {
  buildInterpolateFilter, buildSceneCutArgs, buildSilenceRemoveFilter, buildSegmentArgs,
} from '../../dist/esm/helpers/temporal.js';
import {
  buildHwUploadFilter, buildHwDownloadFilter, buildHwScaleFilter, buildHwFilterChain, HWACCELS,
} from '../../dist/esm/helpers/hw.js';
import { subtitleCodecFor, subtitleExtensionFor } from '../../dist/esm/helpers/subtitles.js';
import {
  buildVarStreamMap, buildAbrLadderArgs, buildAbrLadderFilter, validateAbrVariants,
} from '../../dist/esm/helpers/hls.js';
import { delogo } from '../../dist/esm/index.js';
import { ffmpeg } from '../../dist/esm/index.js';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mediaforge-21-'));

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
const FFMPEG = hasFfmpeg();
let fixture: string;

before(() => {
  if (FFMPEG) {
    fixture = path.join(TMP, 'fixture.mp4');
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=160x90:rate=10',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', fixture,
    ], { stdio: 'pipe' });
  }
});

const variant = (over: Partial<{ name: string; resolution: string; videoBitrate: string }> = {}) => ({
  name: '720p', resolution: '1280x720', videoBitrate: '2M', ...over,
});

// ─── Quality metrics ─────────────────────────────────────────────────────────

describe('buildVmafFilter', () => {
  it('always requests a JSON log', () => {
    assert.equal(buildVmafFilter(), 'libvmaf=log_fmt=json');
  });

  it('includes target, min_score and model', () => {
    const f = buildVmafFilter({ target: 95, minScore: 80, model: 'version=v0.6.1' });
    assert.ok(f.includes('target=95'), `expected ${f} to include ${'target=95'}; got ${f}`);
    assert.ok(f.includes('min_score=80'), `expected ${f} to include ${'min_score=80'}; got ${f}`);
    // '=' must NOT be escaped inside the quoted model spec.
    assert.ok(f.includes("model='version=v0.6.1'"), f);
  });

  it('escapes quotes and backslashes in the model spec', () => {
    assert.ok(buildVmafFilter({ model: "a'b" }).includes("model='a'\\''b'"), `expected ${buildVmafFilter({ model: "a'b" })} to include ${"model='a'\\''b'"}; got ${buildVmafFilter({ model: "a'b" })}`);
    assert.ok(buildVmafFilter({ model: 'a\\b' }).includes("model='a\\\\b'"), `expected ${buildVmafFilter({ model: 'a\\b' })} to include ${"model='a\\\\b'"}; got ${buildVmafFilter({ model: 'a\\b' })}`);
  });

  it('accepts the 0 and 100 boundaries', () => {
    assert.ok(buildVmafFilter({ target: 0 }).includes('target=0'), `expected ${buildVmafFilter({ target: 0 })} to include ${'target=0'}; got ${buildVmafFilter({ target: 0 })}`);
    assert.ok(buildVmafFilter({ target: 100 }).includes('target=100'), `expected ${buildVmafFilter({ target: 100 })} to include ${'target=100'}; got ${buildVmafFilter({ target: 100 })}`);
  });

  for (const bad of [-1, 101, NaN, Infinity]) {
    it(`rejects target=${bad}`, () => {
      assert.throws(() => buildVmafFilter({ target: bad }), RangeError);
    });
    it(`rejects minScore=${bad}`, () => {
      assert.throws(() => buildVmafFilter({ minScore: bad }), RangeError);
    });
  }
});

describe('buildSsimFilter / buildPsnrFilter', () => {
  it('emit a bare filter when no stats file is given', () => {
    assert.equal(buildSsimFilter(), 'ssim');
    assert.equal(buildPsnrFilter(), 'psnr');
  });

  it('attach a stats_file when given', () => {
    // Inside a single-quoted filtergraph value only quotes and backslashes need
    // escaping; ffmpeg accepts spaces as-is.
    assert.equal(buildSsimFilter({ statsFile: '/tmp/a b.log' }), "ssim=stats_file='/tmp/a b.log'");
    assert.equal(buildPsnrFilter({ statsFile: '/tmp/p.log' }), "psnr=stats_file='/tmp/p.log'");
  });

  it('escapes a quote in the stats path', () => {
    assert.ok(buildPsnrFilter({ statsFile: "/tmp/it's.log" }).includes("it'\\''s"), `expected ${buildPsnrFilter({ statsFile: "/tmp/it's.log" })} to include ${"it'\\''s"}; got ${buildPsnrFilter({ statsFile: "/tmp/it's.log" })}`);
  });
});

describe('parseVmafLog', () => {
  it('reads the pooled mean and frame count', () => {
    const s = parseVmafLog(JSON.stringify({ pooled_metrics: { vmaf: { mean: 93.21 } }, frames: [1, 2, 3] }));
    assert.equal(s.vmaf, 93.21);
    assert.equal(s.value, 93.21);
    assert.equal(s.metric, 'vmaf');
    assert.equal(s.frames, 3);
  });

  it('omits frames when the log has none', () => {
    const s = parseVmafLog(JSON.stringify({ pooled_metrics: { vmaf: { mean: 50 } } }));
    assert.equal(s.frames, undefined);
  });

  it('throws on invalid JSON', () => {
    assert.throws(() => parseVmafLog('not json'), /not valid JSON/);
  });

  it('throws when pooled_metrics is missing', () => {
    assert.throws(() => parseVmafLog('{}'), /no pooled_metrics/);
    assert.throws(() => parseVmafLog('{"pooled_metrics":{}}'), /no pooled_metrics/);
  });
});

describe('parseStatsFile', () => {
  it('averages ssim All: values', () => {
    const log = ['n:0 mse_avg:1 All:0.90 (5.0)', 'n:1 mse_avg:1 All:0.98 (1.0)'].join('\n');
    const s = parseStatsFile(log, 'ssim');
    assert.equal(s.value, 0.94);
    assert.equal(s.frames, 2);
  });

  it('averages psnr_avg values', () => {
    const log = ['n:1 psnr_avg:50.0 psnr_y:52', 'n:2 psnr_avg:40.0 psnr_y:42'].join('\n');
    assert.equal(parseStatsFile(log, 'psnr').value, 45);
  });

  it('treats inf PSNR (identical frames) as a real value, not a parse failure', () => {
    const log = 'n:1 psnr_avg:inf psnr_y:inf';
    const s = parseStatsFile(log, 'psnr');
    assert.equal(s.value, Number.POSITIVE_INFINITY);
  });

  it('throws on an empty file', () => {
    assert.throws(() => parseStatsFile('', 'ssim'), /empty/);
    assert.throws(() => parseStatsFile('   \n', 'psnr'), /empty/);
  });

  it('throws when handed the wrong metric for the file', () => {
    assert.throws(() => parseStatsFile('All:0.9', 'psnr'), /no "psnr_avg:"/);
    assert.throws(() => parseStatsFile('psnr_avg:50', 'ssim'), /no "All:"/);
  });
});

describe('measureQuality argument validation', () => {
  it('rejects a vmaf-only option on a non-vmaf metric', async () => {
    await assert.rejects(
      () => measureQuality({ reference: 'a', distorted: 'b', metric: 'ssim', vmaf: { target: 90 } }),
      /only applies to metric 'vmaf'/,
    );
  });
});

// ─── Tone mapping ────────────────────────────────────────────────────────────

describe('buildToneMapFilter', () => {
  it('defaults to mobius and normalises the input', () => {
    const f = buildToneMapFilter();
    assert.ok(f.startsWith('zscale=t=linear:'), f);
    assert.ok(f.includes('tonemap=tonemap=mobius'), `expected ${f} to include ${'tonemap=tonemap=mobius'}; got ${f}`);
    assert.strictEqual(f.includes('linear=true'), false);
  });

  it('uses the documented short zscale option names', () => {
    // `width=bt2020` would be rejected by ffmpeg as "Invalid size".
    const f = buildToneMapFilter();
    assert.ok(!f.includes('width='), f);
    assert.ok(!f.includes('transfer='), f);
    assert.ok(!f.includes('primaries='), f);
    assert.ok(!f.includes('matrix='), f);
    assert.ok(f.includes('p=bt2020') && f.includes('t=smpte2084') && f.includes('m=bt2020nc'), f);
  });

  it('skips input normalisation when asked', () => {
    const f = buildToneMapFilter({ normalizeInput: false });
    assert.ok(!f.includes('zscale=t=linear'), f);
    assert.ok(f.startsWith('tonemap='), f);
  });

  it('honours the chosen algorithm', () => {
    assert.ok(buildToneMapFilter({ algorithm: 'hable' }).includes('tonemap=hable'), `expected ${buildToneMapFilter({ algorithm: 'hable' })} to include ${'tonemap=hable'}; got ${buildToneMapFilter({ algorithm: 'hable' })}`);
    assert.ok(buildToneMapFilter({ algorithm: 'clip' }).includes('tonemap=clip'), `expected ${buildToneMapFilter({ algorithm: 'clip' })} to include ${'tonemap=clip'}; got ${buildToneMapFilter({ algorithm: 'clip' })}`);
  });

  it('rejects a parameter on an algorithm that ignores it', () => {
    assert.throws(
      () => buildToneMapFilter({ algorithm: 'hable', parameter: 0.5 }),
      /only applies to the mobius\/reinhard\/linear/,
    );
  });

  it('accepts a parameter on the algorithms that use it', () => {
    assert.ok(buildToneMapFilter({ algorithm: 'mobius', parameter: 0.5 }).includes('param=0.5'), `expected ${buildToneMapFilter({ algorithm: 'mobius', parameter: 0.5 })} to include ${'param=0.5'}; got ${buildToneMapFilter({ algorithm: 'mobius', parameter: 0.5 })}`);
  });

  for (const peak of [0, -1, NaN, Infinity]) {
    it(`rejects peak=${peak}`, () => assert.throws(() => buildToneMapFilter({ peak }), RangeError));
  }
  for (const t of [0, -1, NaN]) {
    it(`rejects targetPeak=${t}`, () => assert.throws(() => buildToneMapFilter({ targetPeak: t }), RangeError));
  }
  for (const d of [-0.1, 1.1, NaN]) {
    it(`rejects desaturation=${d}`, () => assert.throws(() => buildToneMapFilter({ desaturation: d }), RangeError));
  }
  it('rejects an unknown algorithm at runtime', () => {
    assert.throws(() => buildToneMapFilter({ algorithm: 'magic' as never }), /unknown algorithm "magic"/);
  });
});

describe('toneMapHdrToSdr refuses non-HDR input', { skip: !FFMPEG }, () => {
  it('throws when the source is SDR', async () => {
    await assert.rejects(
      () => toneMapHdrToSdr({ input: fixture, output: path.join(TMP, 'no.mp4') }),
      /does not look like HDR/,
    );
  });
});

describe('SDR_TARGET_PROPERTIES', () => {
  it('tags the result as ordinary BT.709 SDR', () => {
    assert.equal(SDR_TARGET_PROPERTIES['color_trc'], 'bt709');
    assert.equal(SDR_TARGET_PROPERTIES['color_primaries'], 'bt709');
    assert.equal(SDR_TARGET_PROPERTIES['colorspace'], 'bt709');
    assert.equal(SDR_TARGET_PROPERTIES['color_range'], 'tv');
  });
});

// ─── Temporal ────────────────────────────────────────────────────────────────

describe('buildInterpolateFilter', () => {
  it('defaults to mci with obmc/bidir', () => {
    const f = buildInterpolateFilter({ fps: 60 });
    assert.ok(f.includes('fps=60'), `expected ${f} to include ${'fps=60'}; got ${f}`);
    assert.ok(f.includes('mi_mode=mci'), `expected ${f} to include ${'mi_mode=mci'}; got ${f}`);
    assert.ok(f.includes('mc_mode=obmc'), `expected ${f} to include ${'mc_mode=obmc'}; got ${f}`);
    assert.ok(f.includes('me_mode=bidir'), `expected ${f} to include ${'me_mode=bidir'}; got ${f}`);
    assert.ok(f.includes('mb_size=8'), `expected ${f} to include ${'mb_size=8'}; got ${f}`);
  });

  it('omits motion-estimation options for non-mci modes', () => {
    // ffmpeg rejects mb_size/me for dup and blend.
    const f = buildInterpolateFilter({ fps: 60, method: 'blend' });
    assert.ok(f.includes('mi_mode=blend'), `expected ${f} to include ${'mi_mode=blend'}; got ${f}`);
    assert.ok(!f.includes('mb_size='), f);
    assert.ok(!f.includes('mc_mode='), f);
  });

  it('passes the search method through', () => {
    assert.ok(buildInterpolateFilter({ fps: 30, meMethod: 'esa' }).includes('me=esa'), `expected ${buildInterpolateFilter({ fps: 30, meMethod: 'esa' })} to include ${'me=esa'}; got ${buildInterpolateFilter({ fps: 30, meMethod: 'esa' })}`);
  });

  for (const fps of [0, -30, NaN, Infinity]) {
    it(`rejects fps=${fps}`, () => assert.throws(() => buildInterpolateFilter({ fps }), RangeError));
  }
  it('rejects an unknown method', () => {
    assert.throws(() => buildInterpolateFilter({ fps: 30, method: 'magic' as never }), /unknown method/);
  });
  it('rejects an unknown mcMode', () => {
    assert.throws(() => buildInterpolateFilter({ fps: 30, mcMode: 'x' as never }), /unknown mcMode/);
  });
  it('rejects an unknown meMode', () => {
    assert.throws(() => buildInterpolateFilter({ fps: 30, meMode: 'x' as never }), /unknown meMode/);
  });
  for (const mb of [0, 3, 2.5]) {
    it(`rejects mbSize=${mb}`, () => assert.throws(() => buildInterpolateFilter({ fps: 30, mbSize: mb }), RangeError));
  }
});

describe('buildSceneCutArgs', () => {
  const scenes = [{ timestamp: 2, sceneNumber: 1 }, { timestamp: 5, sceneNumber: 2 }];

  it('produces one window per scene, starting the first at 0', () => {
    // A scene-change list marks boundaries, so the clips are [0,2] and [2,5].
    assert.deepEqual(buildSceneCutArgs(scenes), [
      '-ss', '0.000', '-to', '2.000',
      '-ss', '2.000', '-to', '5.000',
    ]);
  });

  it('shortens each window from its end when trimming', () => {
    assert.deepEqual(buildSceneCutArgs(scenes, { trimStart: 0.5 }), [
      '-ss', '0.000', '-to', '1.500',
      '-ss', '2.000', '-to', '4.500',
    ]);
  });

  it('clamps the end to endTime', () => {
    const args = buildSceneCutArgs(scenes, { endTime: 3 });
    assert.ok(args.includes('3.000'), `expected ${args} to include ${'3.000'}; got ${args}`);
    assert.ok(!args.includes('5.000'), `expected ${!args} to include ${'5.000'}; got ${!args}`);
  });

  it('de-duplicates and sorts out-of-order boundaries', () => {
    const args = buildSceneCutArgs([{ timestamp: 5, sceneNumber: 2 }, { timestamp: 2, sceneNumber: 1 }]);
    assert.deepEqual(args, ['-ss', '0.000', '-to', '2.000', '-ss', '2.000', '-to', '5.000']);
    const dupes = buildSceneCutArgs([{ timestamp: 2, sceneNumber: 1 }, { timestamp: 2, sceneNumber: 2 }]);
    assert.deepEqual(dupes, ['-ss', '0.000', '-to', '2.000']);
  });

  it('drops windows that trim away to nothing', () => {
    assert.deepEqual(buildSceneCutArgs(scenes, { trimStart: 5 }), []);
  });

  it('rejects a negative trimStart', () => {
    assert.throws(() => buildSceneCutArgs(scenes, { trimStart: -1 }), RangeError);
  });

  it('returns nothing for an empty scene list', () => {
    assert.deepEqual(buildSceneCutArgs([]), []);
  });
});

describe('buildSilenceRemoveFilter', () => {
  it('emits start and stop period pairs', () => {
    const f = buildSilenceRemoveFilter({ threshold: -40, minDuration: 0.3 });
    assert.ok(f.startsWith('silenceremove='), `assertion failed: ${f.startsWith('silenceremove=')}`);
    assert.ok(f.includes('start_threshold=-40dB'), `expected ${f} to include ${'start_threshold=-40dB'}; got ${f}`);
    assert.ok(f.includes('stop_threshold=-40dB'), `expected ${f} to include ${'stop_threshold=-40dB'}; got ${f}`);
    assert.ok(f.includes('start_duration=0.3'), `expected ${f} to include ${'start_duration=0.3'}; got ${f}`);
  });

  it('defaults to -50dB / 0.5s', () => {
    const f = buildSilenceRemoveFilter();
    assert.ok(f.includes('start_threshold=-50dB'), `expected ${f} to include ${'start_threshold=-50dB'}; got ${f}`);
    assert.ok(f.includes('start_duration=0.5'), `expected ${f} to include ${'start_duration=0.5'}; got ${f}`);
  });

  for (const t of [1, -201, NaN]) {
    it(`rejects threshold=${t}`, () => assert.throws(() => buildSilenceRemoveFilter({ threshold: t }), RangeError));
  }
  for (const d of [0, -1, NaN]) {
    it(`rejects minDuration=${d}`, () => assert.throws(() => buildSilenceRemoveFilter({ minDuration: d }), RangeError));
  }
});

describe('buildSegmentArgs', () => {
  it('forces keyframes so the requested boundaries are honoured', () => {
    // Without this the segment muxer can only cut on keyframes and silently
    // emits fewer, longer segments than asked for.
    const a = buildSegmentArgs({ input: 'in.mp4', outputPattern: 'seg%03d.ts', segmentTime: 1 });
    const kf = a[a.indexOf('-force_key_frames') + 1];
    assert.equal(kf, 'expr:gte(t,n_forced*1)');
  });

  it('can be told not to force keyframes', () => {
    const a = buildSegmentArgs({ input: 'in.mp4', outputPattern: 'seg%03d.ts', forceKeyFrames: false });
    assert.ok(!a.includes('-force_key_frames'), `expected ${!a} to include ${'-force_key_frames'}; got ${!a}`);
  });

  it('resets timestamps by default and can be told not to', () => {
    assert.ok(buildSegmentArgs({ input: 'i', outputPattern: 's%03d.ts' }).includes('-reset_timestamps'), `expected ${buildSegmentArgs({ input: 'i', outputPattern: 's%03d.ts' })} to include ${'-reset_timestamps'}; got ${buildSegmentArgs({ input: 'i', outputPattern: 's%03d.ts' })}`);
    assert.ok(!buildSegmentArgs({ input: 'i', outputPattern: 's%03d.ts', resetTimestamps: false }).includes('-reset_timestamps'), `expected ${!buildSegmentArgs({ input: 'i', outputPattern: 's%03d.ts', resetTimestamps: false })} to include ${'-reset_timestamps'}; got ${!buildSegmentArgs({ input: 'i', outputPattern: 's%03d.ts', resetTimestamps: false })}`);
  });

  it('rejects a pattern with no printf index', () => {
    assert.throws(() => buildSegmentArgs({ input: 'i', outputPattern: 'seg.ts' }), /printf-style index/);
  });

  for (const t of [0, -2, NaN]) {
    it(`rejects segmentTime=${t}`, () => {
      assert.throws(() => buildSegmentArgs({ input: 'i', outputPattern: 's%03d.ts', segmentTime: t }), RangeError);
    });
  }
});

// ─── Hardware filter graphs ──────────────────────────────────────────────────

describe('buildHwUploadFilter / buildHwDownloadFilter', () => {
  it('uploads with no options (ffmpeg derives the format)', () => {
    assert.equal(buildHwUploadFilter({ accel: 'cuda' }), 'hwupload');
    assert.equal(buildHwUploadFilter({ accel: 'vaapi' }), 'hwupload');
  });

  it('rejects an unknown acceleration method', () => {
    assert.throws(() => buildHwUploadFilter({ accel: 'nope' as never }), /Unknown hwaccel/);
  });

  it('defaults the download format to nv12', () => {
    assert.equal(buildHwDownloadFilter(), 'hwdownload=format=nv12');
    assert.equal(buildHwDownloadFilter('yuv420p'), 'hwdownload=format=yuv420p');
  });
});

describe('buildHwScaleFilter', () => {
  it('builds per-vendor scalers', () => {
    assert.equal(buildHwScaleFilter({ accel: 'cuda', width: 1280, height: 720 }), 'scale_cuda=w=1280:h=720');
    assert.ok(buildHwScaleFilter({ accel: 'vaapi', width: 640, height: 360 }).startsWith('scale_vaapi='), `assertion failed: ${buildHwScaleFilter({ accel: 'vaapi', width: 640, height: 360 }).startsWith('scale_vaapi=')}`);
    assert.ok(buildHwScaleFilter({ accel: 'qsv', width: 640, height: 360 }).startsWith('scale_qsv='), `assertion failed: ${buildHwScaleFilter({ accel: 'qsv', width: 640, height: 360 }).startsWith('scale_qsv=')}`);
  });

  it('passes extra options through', () => {
    const f = buildHwScaleFilter({ accel: 'vaapi', width: 8, height: 8, format: 'nv12', mode: 'bilinear' });
    assert.ok(f.includes('format=nv12'), `expected ${f} to include ${'format=nv12'}; got ${f}`);
    assert.ok(f.includes('mode=bilinear'), `expected ${f} to include ${'mode=bilinear'}; got ${f}`);
  });

  it('refuses to fake a GPU scaler where ffmpeg has none', () => {
    assert.throws(
      () => buildHwScaleFilter({ accel: 'videotoolbox', width: 1, height: 2 }),
      /no GPU scaler for "videotoolbox"/,
    );
  });

  for (const [w, h] of [[0, 10], [10, 0], [-2, 4], [1.5, 2]] as const) {
    it(`rejects ${w}x${h}`, () => {
      assert.throws(() => buildHwScaleFilter({ accel: 'cuda', width: w, height: h }), RangeError);
    });
  }
});

describe('buildHwFilterChain', () => {
  it('orders upload, gpu work, download, then cpu work', () => {
    const chain = buildHwFilterChain({
      accel: 'cuda',
      gpuFilters: [buildHwScaleFilter({ accel: 'cuda', width: 1280, height: 720 })],
      cpuFilters: ['drawtext=text=hi'],
    });
    assert.equal(
      chain,
      'hwupload,scale_cuda=w=1280:h=720,hwdownload=format=nv12,drawtext=text=hi',
    );
  });

  it('refuses an empty GPU stage — that is always slower than software', () => {
    assert.throws(
      () => buildHwFilterChain({ accel: 'cuda', gpuFilters: [] }),
      /always slower than staying in software/,
    );
  });

  it('supports multiple GPU filters', () => {
    const chain = buildHwFilterChain({
      accel: 'cuda',
      gpuFilters: ['scale_cuda=w=1:h=1', 'scale_cuda=w=2:h=2'],
    });
    assert.equal(chain.split('hwupload')[1]!.split('hwdownload')[0]!.split(',').filter(Boolean).length, 2);
  });
});

describe('HWACCELS', () => {
  it('is a non-empty list including cuda and vaapi', () => {
    assert.ok(HWACCELS.includes('cuda'), `expected ${HWACCELS} to include ${'cuda'}; got ${HWACCELS}`);
    assert.ok(HWACCELS.includes('vaapi'), `expected ${HWACCELS} to include ${'vaapi'}; got ${HWACCELS}`);
    assert.ok(HWACCELS.length > 3, `expected ${HWACCELS.length} to be greater than ${3}; got ${HWACCELS.length}`);
  });
});

// ─── Subtitles ───────────────────────────────────────────────────────────────

describe('subtitle format mapping', () => {
  it('maps formats to ffmpeg codecs', () => {
    assert.equal(subtitleCodecFor('srt'), 'srt');
    assert.equal(subtitleCodecFor('mov_text'), 'mov_text');
    assert.equal(subtitleCodecFor('vtt'), 'webvtt');
    assert.equal(subtitleCodecFor('ass'), 'ass');
  });

  it('maps formats to file extensions', () => {
    assert.equal(subtitleExtensionFor('mov_text'), '.m4v');
    assert.equal(subtitleExtensionFor('vtt'), '.vtt');
    assert.equal(subtitleExtensionFor('srt'), '.srt');
  });

  it('rejects an unknown format', () => {
    assert.throws(() => subtitleCodecFor('nope' as never), /Unknown subtitle format/);
  });
});

// ─── ABR ladder ──────────────────────────────────────────────────────────────

describe('buildVarStreamMap', () => {
  it('pairs video and audio streams per variant', () => {
    const { map, streamCount } = buildVarStreamMap([
      variant({ name: '1080p' }), variant({ name: '720p', resolution: '1280x720', videoBitrate: '2M' }),
    ]);
    assert.equal(map, 'v:0,a:0,name:1080p v:1,a:1,name:720p');
    assert.equal(streamCount, 2);
  });

  it('rejects an empty variant list', () => {
    assert.throws(() => buildVarStreamMap([]), /at least one variant/);
  });
});

describe('validateAbrVariants', () => {
  it('accepts a well-formed ladder', () => {
    assert.doesNotThrow(() => validateAbrVariants([variant()], 'test'));
  });

  it('rejects a missing name', () => {
    assert.throws(() => validateAbrVariants([{ ...variant(), name: '' }], 'test'), /missing a non-empty "name"/);
  });

  it('rejects a malformed resolution', () => {
    for (const r of ['1920x', 'x1080', '1920x1080x1', 'axb', '1920x', '']) {
      assert.throws(() => validateAbrVariants([variant({ resolution: r })], 'test'), /invalid resolution/);
    }
  });

  it('rejects odd dimensions with an explanation', () => {
    // ffmpeg accepts the size and then dies in the encoder with
    // "maybe incorrect parameters such as bit_rate, rate, width or height".
    assert.throws(
      () => validateAbrVariants([variant({ resolution: '1281x720' })], 'test'),
      /odd.*even dimensions/s,
    );
    assert.throws(() => validateAbrVariants([variant({ resolution: '1280x721' })], 'test'), /odd/);
  });

  it('rejects a missing bitrate', () => {
    assert.throws(
      () => validateAbrVariants([{ name: 'a', resolution: '1280x720', videoBitrate: '' }], 'test'),
      /missing a "videoBitrate"/,
    );
  });
});

describe('buildAbrLadderArgs', () => {
  const variants = [variant(), variant({ name: '360p', resolution: '640x360', videoBitrate: '800k' })];

  it('emits a split graph with one output per variant', () => {
    const a = buildAbrLadderArgs({ input: 'in.mp4', outputPattern: 'v%v/index.m3u8', variants });
    const fc = a[a.indexOf('-filter_complex') + 1]!;
    assert.ok(fc.includes('[0:v]split=2[v0][v1]'), `expected ${fc} to include ${'[0:v]split=2[v0][v1]'}; got ${fc}`);
    assert.ok(fc.includes('[0:a]asplit=2[a0][a1]'), `expected ${fc} to include ${'[0:a]asplit=2[a0][a1]'}; got ${fc}`);
    assert.ok(fc.includes('[v0]scale=1280:720[vout0]'), `expected ${fc} to include ${'[v0]scale=1280:720[vout0]'}; got ${fc}`);
    assert.ok(fc.includes('[v1]scale=640:360[vout1]'), `expected ${fc} to include ${'[v1]scale=640:360[vout1]'}; got ${fc}`);
  });

  it('does not leave a trailing separator on the filtergraph', () => {
    // ffmpeg 4.x parses the empty trailing chain as a filter with an empty name.
    const a = buildAbrLadderArgs({ input: 'in.mp4', outputPattern: 'v%v/index.m3u8', variants });
    assert.ok(!a[a.indexOf('-filter_complex') + 1]!.endsWith(';'), `assertion failed: ${!a[a.indexOf('-filter_complex') + 1]!.endsWith(';')}`);
  });

  it('maps every variant and applies per-stream bitrates', () => {
    const a = buildAbrLadderArgs({ input: 'in.mp4', outputPattern: 'v%v/index.m3u8', variants });
    assert.equal(a.filter(x => x === '-map').length, 4);
    assert.ok(a.includes('-var_stream_map'), `expected ${a} to include ${'-var_stream_map'}; got ${a}`);
    assert.ok(a.includes('-b:v:1'), `expected ${a} to include ${'-b:v:1'}; got ${a}`);
    assert.equal(a[a.indexOf('-b:v:0') + 1], '2M');
  });

  it('requires %v in the output pattern', () => {
    assert.throws(
      () => buildAbrLadderArgs({ input: 'i', outputPattern: 'out.m3u8', variants }),
      /must contain "%v"/,
    );
  });

  it('builds the same graph from buildAbrLadderFilter', () => {
    assert.equal(
      buildAbrLadderFilter({ variants }),
      buildAbrLadderArgs({ input: 'i', outputPattern: 'v%v/i.m3u8', variants })
        .at(buildAbrLadderArgs({ input: 'i', outputPattern: 'v%v/i.m3u8', variants }).indexOf('-filter_complex') + 1),
    );
  });
});

// ─── delogo ──────────────────────────────────────────────────────────────────

describe('delogo', () => {
  it('builds the filter standalone', () => {
    assert.equal(delogo({ x: 10, y: 20, width: 30, height: 40 }), 'delogo=x=10:y=20:w=30:h=40');
  });

  it('includes show only when requested', () => {
    assert.ok(delogo({ x: 0, y: 0, width: 10, height: 10, show: true }).includes('show=1'), `expected ${delogo({ x: 0, y: 0, width: 10, height: 10, show: true })} to include ${'show=1'}; got ${delogo({ x: 0, y: 0, width: 10, height: 10, show: true })}`);
    assert.ok(!delogo({ x: 0, y: 0, width: 10, height: 10 }).includes('show'), `expected ${!delogo({ x: 0, y: 0, width: 10, height: 10 })} to include ${'show'}; got ${!delogo({ x: 0, y: 0, width: 10, height: 10 })}`);
  });

  for (const bad of [{ x: -1, y: 0, width: 1, height: 1 }, { x: 0, y: NaN, width: 1, height: 1 }]) {
    it(`rejects ${JSON.stringify(bad)}`, () => assert.throws(() => delogo(bad), RangeError));
  }
  it('rejects a zero-sized region', () => {
    assert.throws(() => delogo({ x: 0, y: 0, width: 0, height: 10 }), RangeError);
  });
});

// ─── New builder methods ─────────────────────────────────────────────────────

describe('FFmpegBuilder encode-control methods', () => {
  const argOf = (fn: (b: ReturnType<typeof ffmpeg>) => void) => {
    const b = ffmpeg('in.mp4').output('out.mp4');
    fn(b);
    return b.buildArgs();
  };

  it('emits -preset, -profile:v and -level:v', () => {
    const a = argOf(b => { b.preset('slow').profile('high').level('4.1'); });
    assert.deepEqual(
      [a[a.indexOf('-preset') + 1], a[a.indexOf('-profile:v') + 1], a[a.indexOf('-level:v') + 1]],
      ['slow', 'high', '4.1'],
    );
  });

  it('emits VBV rate control', () => {
    const a = argOf(b => b.rateControl({ min: '1M', max: '2M', bufferSize: '4M' }));
    assert.equal(a[a.indexOf('-minrate') + 1], '1M');
    assert.equal(a[a.indexOf('-maxrate') + 1], '2M');
    assert.equal(a[a.indexOf('-bufsize') + 1], '4M');
  });

  it('omits -minrate when only a cap is wanted', () => {
    const a = argOf(b => b.rateControl({ max: '2M', bufferSize: '4M' }));
    assert.ok(!a.includes('-minrate'), `expected ${!a} to include ${'-minrate'}; got ${!a}`);
    assert.ok(a.includes('-maxrate'), `expected ${a} to include ${'-maxrate'}; got ${a}`);
  });

  it('emits -g and a frame-rate flag this ffmpeg understands', () => {
    const a = argOf(b => { b.keyframeInterval(48).fpsMode('vfr'); });
    assert.equal(a[a.indexOf('-g') + 1], '48');
    // -vsync was renamed to -fps_mode in ffmpeg 5.1; the new name does not
    // exist on 4.x at all, so the flag is chosen from the probed version.
    const v = ffmpeg('x').getVersion();
    const flag = v.major > 5 || (v.major === 5 && v.minor >= 1) ? '-fps_mode' : '-vsync';
    assert.equal(a[a.indexOf(flag) + 1], 'vfr');
  });

  it('fpsMode defaults to a frame-rate flag and no others', () => {
    const a = argOf(b => b.fpsMode('cfr'));
    const modeFlags = a.filter((x: string) => x === '-fps_mode' || x === '-vsync');
    assert.equal(modeFlags.length, 1);
  });

  it('fpsMode rejects an unknown mode', () => {
    assert.throws(() => argOf(b => b.fpsMode('bogus' as never)), /unknown mode "bogus"/);
  });

  it('rateControl requires a max bitrate', () => {
    assert.throws(() => argOf(b => b.rateControl({} as never)), /max/);
  });

  it('rateControl defaults bufsize to max', () => {
    const a = argOf(b => b.rateControl({ max: '2M' }));
    assert.equal(a[a.indexOf('-bufsize') + 1], '2M');
    assert.equal(a.indexOf('-minrate'), -1);
  });

  it('setColorProperties rejects an empty object', () => {
    assert.throws(() => argOf(b => b.setColorProperties({})), /at least one of/);
  });

  it('rounds a fractional keyframe interval', () => {
    assert.equal(argOf(b => b.keyframeInterval(47.6))[argOf(b => b.keyframeInterval(47.6)).indexOf('-g') + 1], '48');
  });

  it('emits colour properties', () => {
    const a = argOf(b => b.setColorProperties(SDR_TARGET_PROPERTIES));
    assert.equal(a[a.indexOf('-color_trc') + 1], 'bt709');
    assert.equal(a[a.indexOf('-colorspace') + 1], 'bt709');
  });

  it('rejects an unknown colour property instead of emitting a bogus flag', () => {
    assert.throws(
      () => argOf(b => b.setColorProperties({ nonsense: 'x' } as never)),
      /unknown colour property "nonsense"/,
    );
  });
});

// ─── Encoder-backed smoke tests ──────────────────────────────────────────────

describe('encoder-backed smoke tests', { skip: !FFMPEG }, () => {
  it('measureQuality computes SSIM for identical files', async () => {
    const s = await measureQuality({ reference: fixture, distorted: fixture, metric: 'ssim' });
    assert.equal(s.metric, 'ssim');
    assert.ok(s.value > 0.99, `expected ~1, got ${s.value}`);
  });

  it('measureQuality reports infinite PSNR for identical files', async () => {
    const s = await measureQuality({ reference: fixture, distorted: fixture, metric: 'psnr' });
    assert.equal(s.value, Number.POSITIVE_INFINITY);
  });

  it('measureQuality enforces minScore', async () => {
    await assert.rejects(
      () => measureQuality({ reference: fixture, distorted: fixture, metric: 'ssim', minScore: 1.5 }),
      /is below the required minimum/,
    );
  });

  it('an infinite PSNR satisfies any minimum', async () => {
    const s = await measureQuality({ reference: fixture, distorted: fixture, metric: 'psnr', minScore: 10 });
    assert.equal(s.value, Number.POSITIVE_INFINITY);
  });

  it('interpolateFrames produces the requested frame rate', async () => {
    const out = path.join(TMP, 'interp.mp4');
    const { interpolateFrames } = await import('../../dist/esm/helpers/temporal.js');
    await interpolateFrames({ input: fixture, output: out, fps: 20, method: 'blend' });
    assert.ok(fs.existsSync(out), `assertion failed: ${fs.existsSync(out)}`);
    const { parseFrameRate, getDefaultVideoStream, probe } = await import('../../dist/esm/probe/ffprobe.js');
    const vs = getDefaultVideoStream(probe(out));
    assert.ok(Math.abs((vs?.avg_frame_rate ?? '') === '' ? 0 : Number((vs!.avg_frame_rate ?? '0/1').split('/')[0])) >= 0, `expected ${Math.abs((vs?.avg_frame_rate ?? '') === '' ? 0 : Number((vs!.avg_frame_rate ?? '0/1').split('/')[0]))} to be at least ${0}; got ${Math.abs((vs?.avg_frame_rate ?? '') === '' ? 0 : Number((vs!.avg_frame_rate ?? '0/1').split('/')[0]))}`);
  });

  it('writeSegments emits one file per segment', async () => {
    const { writeSegments } = await import('../../dist/esm/helpers/temporal.js');
    const dir = path.join(TMP, 'segs');
    fs.mkdirSync(dir, { recursive: true });
    await writeSegments({ input: fixture, outputPattern: path.join(dir, 's%03d.ts'), segmentTime: 1 });
    assert.equal(fs.readdirSync(dir).filter(f => f.endsWith('.ts')).length, 2);
  });

  it('abrLadder produces a master playlist with every rendition', async () => {
    const { abrLadder } = await import('../../dist/esm/helpers/hls.js');
    const dir = path.join(TMP, 'abr');
    fs.rmSync(dir, { recursive: true, force: true });
    await abrLadder({
      input: fixture,
      outputPattern: path.join(dir, '%v', 'index.m3u8'),
      variants: [
        { name: 'high', resolution: '160x90', videoBitrate: '300k' },
        { name: 'low', resolution: '80x46', videoBitrate: '100k' },
      ],
    }).run();
    // The master playlist is anchored next to the variant playlists, not to
    // the process CWD.
    const master = path.join(dir, 'master.m3u8');
    assert.ok(fs.existsSync(master), `master playlist was not written to ${master}`);
    const text = fs.readFileSync(master, 'utf8');
    assert.ok(text.includes('high/index.m3u8'), text);
    assert.ok(text.includes('low/index.m3u8'), text);
  });
});

// Cleaned up in an `after` hook — a top-level rm would delete the fixture while
// the encoder-backed tests above are still pending.
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
