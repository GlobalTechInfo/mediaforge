import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'stream';

// ─── Presets ────────────────────────────────────────────────────────────────
describe('presets', () => {
  let getPreset: any, listPresets: any, applyPreset: any;

  before(async () => {
    const m = await import('../../dist/esm/helpers/presets.js');
    getPreset = m.getPreset; listPresets = m.listPresets; applyPreset = m.applyPreset;
  });

  it('web has libx264 and aac', () => {
    const p = getPreset('web');
    assert.ok(p.videoArgs.includes('libx264'));
    assert.ok(p.audioArgs.includes('aac'));
  });

  it('web has faststart', () => {
    const p = getPreset('web');
    const all = [...p.videoArgs, ...p.extraArgs];
    assert.ok(all.some(a => a.includes('faststart')));
  });

  it('mobile has baseline profile', () => {
    const p = getPreset('mobile');
    assert.ok(p.videoArgs.includes('baseline'));
  });

  it('archive crf 0 and flac', () => {
    const p = getPreset('archive');
    assert.ok(p.videoArgs.includes('0'));
    assert.ok(p.audioArgs.includes('flac'));
  });

  it('podcast has -vn', () => {
    assert.ok(getPreset('podcast').videoArgs.includes('-vn'));
  });

  it('prores uses prores_ks', () => {
    assert.ok(getPreset('prores').videoArgs.includes('prores_ks'));
  });

  it('dnxhd uses dnxhd codec', () => {
    assert.ok(getPreset('dnxhd').videoArgs.includes('dnxhd'));
  });

  it('hls-input has keyint_min', () => {
    assert.ok(applyPreset('hls-input').includes('-keyint_min'));
  });

  it('gif preset has -an', () => {
    assert.ok(applyPreset('gif').includes('-an'));
  });

  it('discord has faststart', () => {
    const p = getPreset('discord');
    assert.ok([...p.videoArgs, ...p.extraArgs].some(a => a.includes('faststart')));
  });

  it('instagram has crf', () => {
    assert.ok(getPreset('instagram').videoArgs.includes('-crf'));
  });

  it('throws on unknown preset', () => {
    assert.throws(() => getPreset('invalid'), /Unknown preset/);
  });

  it('listPresets includes all 11 names', () => {
    const list = listPresets();
    for (const n of ['web','web-hq','mobile','archive','podcast','hls-input','gif','discord','instagram','prores','dnxhd']) {
      assert.ok(list.includes(n), `missing ${n}`);
    }
  });

  it('applyPreset returns the exact web preset flags', () => {
    expect: assert.deepStrictEqual(applyPreset('web'), [
      '-c:v', 'libx264', '-crf', '23', '-preset', 'medium',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
    ]);
  });

  it('getPreset returns copy not reference (no mutation)', () => {
    const p1 = getPreset('web');
    const p2 = getPreset('web');
    p1.videoArgs.push('MUTATION');
    assert.ok(!p2.videoArgs.includes('MUTATION'));
  });

  it('all presets have valid structure', () => {
    for (const name of listPresets()) {
      const p = getPreset(name);
      assert.ok(Array.isArray(p.videoArgs));
      assert.ok(Array.isArray(p.audioArgs));
      assert.ok(Array.isArray(p.extraArgs));
    }
  });
});

// ─── Concat helpers ──────────────────────────────────────────────────────────
describe('concat helpers', () => {
  let buildConcatList: any;
  before(async () => {
    const m = await import('../../dist/esm/helpers/concat.js');
    buildConcatList = m.buildConcatList;
  });

  it('formats two paths with file prefix', () => {
    const r = buildConcatList(['/tmp/a.mp4', '/tmp/b.mp4']);
    assert.ok(r.includes("file '"));
    assert.ok(r.includes('a.mp4'));
    assert.ok(r.includes('b.mp4'));
  });

  it('empty array returns empty string', () => {
    assert.strictEqual(buildConcatList([]), '');
  });

  it('uses absolute paths', async () => {
    const { resolve } = await import('path');
    const r = buildConcatList(['relative.mp4']);
    assert.ok(r.includes(resolve('relative.mp4')));
  });

  it('each file on its own line', () => {
    const r = buildConcatList(['/a.mp4', '/b.mp4', '/c.mp4']);
    assert.strictEqual(r.split('\n').length, 3);
  });
});

// ─── Process helpers ─────────────────────────────────────────────────────────
describe('process helpers', () => {
  let autoKillOnExit: any, renice: any;
  before(async () => {
    const m = await import('../../dist/esm/helpers/process.js');
    autoKillOnExit = m.autoKillOnExit; renice = m.renice;
  });

  it('autoKillOnExit returns an unregister function', () => {
    const child = { pid: 99999, kill: () => {}, once: () => {} } as any;
    const unreg = autoKillOnExit(child);
    // Calling it twice must be safe: the exit handler is deregistered, so the
    // second call has nothing left to remove and must not throw.
    assert.strictEqual(typeof unreg, 'function');
    unreg();
    unreg();
  });

  it('calling unregister twice does not throw', () => {
    const child = { pid: 99999, kill: () => {}, once: () => {} } as any;
    const unreg = autoKillOnExit(child);
    unreg();
    assert.doesNotThrow(() => unreg());
  });

  it('renice throws if pid is undefined', () => {
    assert.throws(() => renice({ pid: undefined } as any, 10), /no PID/);
  });
});

// ─── Stream helpers ──────────────────────────────────────────────────────────
describe('stream helpers', () => {
  let pipeThrough: any, streamOutput: any, _streamToFile: any;
  before(async () => {
    const m = await import('../../dist/esm/helpers/streams.js');
    pipeThrough = m.pipeThrough; streamOutput = m.streamOutput; _streamToFile = m.streamToFile;
  });

  it('pipeThrough returns emitter, stdout, kill', async () => {
    const proc = pipeThrough({ inputFormat: 'mp4', outputFormat: 'null', outputArgs: ['-f','null'] });
    assert.ok(proc.emitter, 'emitter');
    assert.ok(proc.stdout, 'stdout stream');
    assert.strictEqual(typeof proc.kill, 'function');
    assert.ok(proc.stdin, 'a piped input has to accept the caller\'s bytes');
    await new Promise<void>(res => {
      proc.emitter.on('end', res);
      proc.emitter.on('error', res);
      proc.kill('SIGTERM');
    });
  });

  it('pipeThrough stdin is writable when no inputStream', async () => {
    const proc = pipeThrough({ outputFormat: 'null' });
    assert.ok(proc.stdin !== null);
    await new Promise<void>(res => {
      proc.emitter.on('end', res);
      proc.emitter.on('error', res);
      proc.kill('SIGTERM');
    });
  });

  it('streamOutput returns Readable', () => {
    const s = streamOutput({ input: 'nonexistent.mp4', outputFormat: 'null' });
    assert.ok(s instanceof Readable);
    s.destroy();
  });

  it('streamOutput with seek returns Readable', () => {
    const s = streamOutput({ input: 'nonexistent.mp4', outputFormat: 'null', seekInput: 10 });
    assert.ok(s instanceof Readable);
    s.destroy();
  });
});

// ─── Watermark helpers ───────────────────────────────────────────────────────
describe('watermark helpers', () => {
  it('buildWatermarkFilter places the logo and applies the opacity', async () => {
    const { buildWatermarkFilter } = await import('../../dist/esm/helpers/watermark.js');
    const opaque = buildWatermarkFilter('bottom-right', 10, 1);
    assert.equal(opaque, '[1:v]format=rgba[wm];[0:v][wm]overlay=W-w-10:H-h-10[out]');

    const faded = buildWatermarkFilter('top-left', 4, 0.5);
    assert.ok(faded.includes('colorchannelmixer=aa=0.5'), `no opacity: ${faded}`);
    assert.ok(faded.includes('overlay=4:4'), `wrong top-left: ${faded}`);

    const scaled = buildWatermarkFilter('center', 0, 1, 200);
    assert.ok(scaled.includes('scale=200:-1'), `no logo scale: ${scaled}`);
    assert.ok(scaled.includes('overlay=(W-w)/2:(H-h)/2'), `not centred: ${scaled}`);
  });

  it('buildTextWatermarkFilter escapes its text and carries every option', async () => {
    const { buildTextWatermarkFilter } = await import('../../dist/esm/helpers/watermark.js');
    const plain = buildTextWatermarkFilter('hello', 'top-left', 10, 24, 'white');
    assert.ok(plain.includes("drawtext=text='hello'"), `no text: ${plain}`);
    assert.ok(plain.includes('fontsize=24'), `no font size: ${plain}`);
    assert.ok(plain.includes('fontcolor=white'), `no colour: ${plain}`);

    // A colon is a drawtext separator, so it has to be escaped rather than
    // silently splitting the filter into two arguments.
    const colon = buildTextWatermarkFilter('12:30:00', 'top-left', 10, 24, 'white');
    assert.ok(colon.includes('12\\:30\\:00'), `the colon was not escaped: ${colon}`);

    const fonted = buildTextWatermarkFilter('x', 'top-left', 0, 12, 'red', '/tmp/f.ttf');
    assert.ok(fonted.includes("fontfile='/tmp/f.ttf'"), `no font file: ${fonted}`);
  });
});

// ─── Normalize helpers ───────────────────────────────────────────────────────
describe('normalize helpers', () => {
  it('the silence and scene filters carry their thresholds', async () => {
    const { buildSilenceDetectFilter, buildSceneSelectFilter } = await import('../../dist/esm/helpers/normalize.js');
    const silence = buildSilenceDetectFilter(-45, 1.5);
    assert.ok(silence.startsWith('silencedetect='), `not silencedetect: ${silence}`);
    assert.ok(silence.includes('noise=-45dB'), `no threshold: ${silence}`);
    assert.ok(silence.includes('d=1.5'), `no duration: ${silence}`);

    const scene = buildSceneSelectFilter(0.25);
    // The comma has to be inside quotes, or ffmpeg splits the filter there.
    assert.equal(scene, "select='gt(scene,0.25)',metadata=print");
    assert.equal(buildSceneSelectFilter(0.4), "select='gt(scene,0.4)',metadata=print");
    // metadata=print is what emits lavfi.scene_score for the caller to parse.
    assert.ok(scene.includes('metadata=print'), `no score output: ${scene}`);
    // The defaults are the documented ones, not whatever was left over.
    assert.ok(buildSilenceDetectFilter().includes('noise=-50dB'), 'default threshold');
    assert.ok(buildSceneSelectFilter().includes('0.4'), 'default scene threshold');
  });

  it('buildBurnTimecodeFilter escapes the format and omits an absent font', async () => {
    const { buildBurnTimecodeFilter } = await import('../../dist/esm/helpers/normalize.js');
    const plain = buildBurnTimecodeFilter();
    assert.ok(plain.includes("text='%{pts_hms}'"), `no default format: ${plain}`);
    assert.ok(plain.includes('fontsize=48'), `no default size: ${plain}`);
    assert.ok(!plain.includes('fontfile'), `a font was invented: ${plain}`);

    const withFont = buildBurnTimecodeFilter('%{pts}', 32, 'yellow', '/tmp/f.ttf', '5', '5');
    assert.ok(withFont.includes("fontfile='/tmp/f.ttf'"), `no font: ${withFont}`);
    assert.ok(withFont.includes('x=5:y=5'), `no position: ${withFont}`);
  });

  it('buildLoudnormFilter emits linear mode and omits an absent offset', async () => {
    const { buildLoudnormFilter } = await import('../../dist/esm/helpers/normalize.js');
    const single = buildLoudnormFilter(-16, 11, -1.5);
    assert.equal(single, 'loudnorm=i=-16:lra=11:tp=-1.5');
    // Without a measurement there is nothing to linearise against, so the
    // single-pass form carries the targets only.
    assert.ok(!single.includes('linear'), `linear mode without a measurement: ${single}`);
    assert.ok(!single.includes('measured'), `a measurement was invented: ${single}`);

    const measured = buildLoudnormFilter(-16, 11, -1.5, {
      inputI: -24, inputLra: 7, inputTp: -3, inputThresh: -34,
    } as never);
    assert.ok(measured.includes('measured_i=-24'), `no measured_i: ${measured}`);
    assert.ok(measured.endsWith(':linear=true'), `not linear: ${measured}`);
  });
});

// ─── GIF helpers ─────────────────────────────────────────────────────────────
describe('gif helpers', () => {
  it('the two-pass palette builders describe both passes', async () => {
    const { buildGifPalettegenFilter, buildGifPaletteuseFilter, buildGifArgs } =
      await import('../../dist/esm/helpers/gif.js');

    const gen = buildGifPalettegenFilter(12, 320, 64);
    assert.ok(gen.includes('fps=12'), `no frame rate: ${gen}`);
    assert.ok(gen.includes('scale=320:-1:flags=lanczos'), `no scale: ${gen}`);
    assert.ok(gen.includes('palettegen=max_colors=64'), `no palette: ${gen}`);

    // The second pass has to feed the scaled video and the palette into one
    // graph, so it carries both labels rather than a bare paletteuse.
    const use = buildGifPaletteuseFilter(12, 320, 'sierra2_4a');
    assert.ok(use.includes('paletteuse=dither=sierra2_4a'), `no dither: ${use}`);
    assert.ok(use.includes('[x]'), `the scaled video is not labelled: ${use}`);
    assert.ok(!use.includes('palettegen'), 'the second pass generated a palette too');

    const args = buildGifArgs('in.mp4', 'pal.png', 'out.gif', 12, 320, 'bayer', '1', 3);
    assert.equal(args.pass1[0], '-y', 'pass 1 does not overwrite');
    assert.deepEqual(args.pass1.slice(1, 5), ['-ss', '1', '-t', '3'], 'pass 1 lost its window');
    // palettegen lives inside the -vf argument, not as a standalone flag.
    assert.ok(args.pass1.some(a => a.includes('palettegen')), `pass 1 makes no palette: ${args.pass1.join(' ')}`);
    assert.equal(args.pass1.at(-1), 'pal.png', `pass 1 does not end at the palette: ${args.pass1.join(' ')}`);
    assert.ok(args.pass2.some(a => a.includes('paletteuse')), `pass 2 never uses the palette: ${args.pass2.join(' ')}`);
    assert.ok(args.pass2.includes('-lavfi'), `pass 2 is not a graph: ${args.pass2.join(' ')}`);
    assert.equal(args.pass2.at(-1), 'out.gif', `pass 2 does not end at the output: ${args.pass2.join(' ')}`);

    // A full colour palette is the default; an explicit one narrows it.
    assert.ok(args.pass1.some(a => a.includes('max_colors=256')), 'the default palette size changed');
    const few = buildGifArgs('in.mp4', 'pal.png', 'out.gif', 12, 320, 'bayer', undefined, undefined, 32);
    assert.ok(few.pass1.some(a => a.includes('max_colors=32')), `the colour count is ignored: ${few.pass1.join(' ')}`);
    assert.ok(!few.pass1.includes('-ss'), 'a window was invented');
  });
});

// ─── Waveform helpers ────────────────────────────────────────────────────────
describe('waveform helpers', () => {
  it('the waveform and spectrum filters carry their size and scale', async () => {
    const { buildWaveformFilter, buildSpectrumFilter, SPECTRUM_COLORS } =
      await import('../../dist/esm/helpers/waveform.js');
    // The stream index defaults to the first audio stream, so a four-argument
    // call cannot produce a filter with `undefined` in its stream specifier.
    const wave = buildWaveformFilter(800, 120, 'blue', 'log');
    assert.equal(wave, '[0:a:0]showwavespic=s=800x120:colors=blue:scale=log[v]');
    assert.ok(!wave.includes('undefined'), `an undefined index leaked into: ${wave}`);
    assert.ok(buildWaveformFilter(800, 120, 'blue', 'lin', 1).startsWith('[0:a:1]'), 'the stream index is ignored');

    const spectrum = buildSpectrumFilter(1280, 720, 'fire', 30);
    assert.ok(spectrum.includes('showspectrum=s=1280x720'), `no size: ${spectrum}`);
    assert.ok(spectrum.includes('fps=30'), `no frame rate: ${spectrum}`);
    // A CSS colour is not a palette name, and the error says so.
    assert.throws(
      () => buildSpectrumFilter(800, 120, 'red', 20),
      /palette name, not a CSS colour/,
    );
    assert.ok(SPECTRUM_COLORS.includes('fire' as never), 'fire is not a spectrum palette');
    assert.ok(SPECTRUM_COLORS.length > 3, `only ${SPECTRUM_COLORS.length} palettes`);
  });
});

// ─── Subtitle helpers ────────────────────────────────────────────────────────
describe('subtitle helpers', () => {
  it('buildBurnSubtitlesFilter escapes the path and carries its style', async () => {
    const { buildBurnSubtitlesFilter, subtitleCodecFor, subtitleExtensionFor } =
      await import('../../dist/esm/helpers/subtitles.js');
    const plain = buildBurnSubtitlesFilter('subs/my file.srt');
    assert.ok(plain.startsWith("subtitles='"), `not a subtitles filter: ${plain}`);
    // A path with a colon or a backslash has to survive ffmpeg's filter parser.
    // Both colons and both backslashes have to be escaped, or ffmpeg's filter
    // parser reads `C:` as an option and splits the path.
    const backslash = String.fromCharCode(92);
    const awkward = buildBurnSubtitlesFilter(`C:${backslash}subs${backslash}a:b.srt`);
    const expectedPath = `C\\:${backslash}${backslash}subs${backslash}${backslash}a\\:b.srt`;
    assert.equal(awkward, `subtitles='${expectedPath}'`);

    const styled = buildBurnSubtitlesFilter('a.srt', 28, 'Arial', '&H00FFFFFF');
    for (const style of ['FontSize=28', 'FontName=Arial', 'PrimaryColour=&H00FFFFFF']) {
      assert.ok(styled.includes(style), `missing ${style} in: ${styled}`);
    }

    // The two are inverses of each other, extension included.
    assert.equal(subtitleCodecFor('srt'), 'srt');
    assert.equal(subtitleCodecFor('vtt'), 'webvtt');
    assert.equal(subtitleExtensionFor('webvtt'), '.vtt');
    assert.equal(subtitleExtensionFor('srt'), '.srt');
  });
});

// ─── Metadata helpers ────────────────────────────────────────────────────────
describe('metadata helpers', () => {
  it('buildMetadataArgs writes global and per-stream tags', async () => {
    const { buildMetadataArgs, buildChapterContent } = await import('../../dist/esm/helpers/metadata.js');
    const args = buildMetadataArgs({ title: 'Clip', artist: 'Someone' }, { '0:1': { language: 'eng' } });
    assert.equal(args[0], '-c', 'metadata is written by re-encoding');
    assert.equal(args[1], 'copy', 'metadata is written by re-encoding');
    assert.deepEqual(args.slice(2, 4), ['-map_metadata', '0'], 'the source metadata is not carried over');
    assert.ok(args.includes('title=Clip'), `no title: ${args.join(' ')}`);
    assert.ok(args.includes('artist=Someone'), `no artist: ${args.join(' ')}`);
    assert.ok(args.includes('-metadata:s:0:1'), `no per-stream flag: ${args.join(' ')}`);
    assert.ok(args.includes('language=eng'), `no stream language: ${args.join(' ')}`);

    const empty = buildMetadataArgs({});
    assert.deepEqual(empty, ['-c', 'copy', '-map_metadata', '0'], 'an empty call still copies metadata');

    const chapters = buildChapterContent([
      { title: 'A', startSec: 0, endSec: 1.5 },
      { title: 'B', startSec: 1.5, endSec: 3 },
    ]);
    assert.ok(chapters.startsWith(';FFMETADATA1'), `not an ffmetadata file: ${chapters.slice(0, 30)}`);
    assert.equal(chapters.match(/\[CHAPTER\]/g)?.length, 2, 'wrong chapter count');
    assert.ok(chapters.includes('TIMEBASE=1/1000'), 'no millisecond timebase');
    assert.ok(chapters.includes('START=0\nEND=1500'), `the first chapter is wrong: ${chapters}`);
    assert.ok(chapters.includes('START=1500\nEND=3000'), `the second chapter is wrong: ${chapters}`);
  });
});

// ─── Screenshot helpers ──────────────────────────────────────────────────────
describe('screenshot helpers', () => {
  it('the screenshot and frame-buffer builders both seek before they read', async () => {
    const { buildScreenshotArgs, buildFrameBufferArgs, buildTimestampFilename, buildExtractFramesArgs } =
      await import('../../dist/esm/helpers/screenshots.js');

    const shot = buildScreenshotArgs('in.mp4', 'out.jpg', 2.5, '1280x720');
    assert.equal(shot[0], '-y', 'a screenshot must overwrite');
    assert.ok(shot.indexOf('-ss') < shot.indexOf('in.mp4'), 'the seek comes after the input');
    assert.deepEqual(shot, ['-y', '-ss', '2.5', '-i', 'in.mp4', '-vframes', '1', '-s', '1280x720', 'out.jpg']);

    // The pipe form has to name image2pipe, or ffmpeg cannot infer it.
    const buf = buildFrameBufferArgs('in.mp4', 1, 'rawvideo');
    assert.equal(buf[0], '-y', 'a frame buffer must overwrite');
    assert.equal(buf.at(-1), 'pipe:1', 'the frame buffer is not written to a pipe');
    assert.ok(buf.includes('image2pipe'), `no image muxer: ${buf.join(' ')}`);
    assert.ok(buf.includes('rawvideo'), `the format was dropped: ${buf.join(' ')}`);
    assert.ok(buf.includes('-vframes'), `more than one frame may be read: ${buf.join(' ')}`);

    // The index is 0-based, like ffmpeg's own %03d output.
    assert.equal(buildTimestampFilename('frame_%04d.jpg', 7, 'jpg'), 'frame_0007.jpg');
    assert.equal(buildTimestampFilename('frame_%04d', 6, 'png'), 'frame_0006.png');
    assert.equal(buildTimestampFilename('frame_%04d', 6, '.png'), 'frame_0006.png');
    // A pattern with no placeholder still gets the index, so two calls with
    // different indices can never return the same name — otherwise every
    // extracted frame would overwrite the last one.
    assert.equal(buildTimestampFilename('shot', 0, 'png'), 'shot0000.png');
    assert.equal(buildTimestampFilename('clip.jpg', 0, 'jpg'), 'clip0000.jpg');
    assert.notEqual(buildTimestampFilename('clip.jpg', 9, 'jpg'), buildTimestampFilename('clip.jpg', 0, 'jpg'));
    assert.equal(buildTimestampFilename('clip.jpg', 9, 'jpg'), 'clip0009.jpg');
    assert.equal(buildTimestampFilename('frame_%d.png', 12, 'png'), 'frame_0012.png');
    assert.equal(buildTimestampFilename('/a/b/frame_%03d.png', 5, 'png'), 'frame_005.png');

    const frames = buildExtractFramesArgs('in.mp4', 'f%03d.png', '2', 1, 3, '320x180');
    assert.equal(frames[0], '-y', 'frame extraction must overwrite');
    assert.ok(frames.includes('fps=2'), `no frame rate: ${frames.join(' ')}`);
    // start=1 and end=3 is a two-second window, not a three-second one.
    assert.ok(frames.includes('2'), `the window length is wrong: ${frames.join(' ')}`);
    assert.equal(frames.at(-1), 'f%03d.png', 'the pattern is not last');
  });
});

// ─── Full index exports ──────────────────────────────────────────────────────
describe('index exports - new features', () => {
  let lib: any;
  before(async () => { lib = await import('../../dist/esm/index.js'); });

  const NEW_EXPORTS = [
    'screenshots', 'frameToBuffer',
    'mergeToFile', 'concatFiles', 'buildConcatList',
    'pipeThrough', 'streamOutput', 'streamToFile',
    'getPreset', 'listPresets', 'applyPreset',
    'toGif', 'gifToMp4',
    'normalizeAudio', 'adjustVolume',
    'addWatermark', 'addTextWatermark',
    'burnSubtitles', 'extractSubtitles',
    'writeMetadata', 'stripMetadata',
    'generateWaveform', 'generateSpectrum',
    'renice', 'autoKillOnExit', 'killAllFFmpeg',
  ];

  for (const name of NEW_EXPORTS) {
    it(`exports "${name}"`, async () => {
      assert.ok(lib[name] !== undefined, `Missing export: ${name}`);
    });
  }
});
