import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { buildHlsArgs, buildDashArgs } = await import('../../../lib/helpers/hls.ts');
const { buildWatermarkFilter, buildTextWatermarkFilter } = await import('../../../lib/helpers/watermark.ts');
const { buildBurnSubtitlesFilter } = await import('../../../lib/helpers/subtitles.ts');
const { buildWaveformFilter, buildSpectrumFilter } = await import('../../../lib/helpers/waveform.ts');
const { buildMetadataArgs, buildChapterContent } = await import('../../../lib/helpers/metadata.ts');
const { buildLoudnormFilter } = await import('../../../lib/helpers/normalize.ts');
const { buildGifArgs, buildGifPalettegenFilter } = await import('../../../lib/helpers/gif.ts');
const { buildScreenshotArgs, buildFrameBufferArgs, buildTimestampFilename } = await import('../../../lib/helpers/screenshots.ts');
const { buildPipeThroughArgs, buildStreamOutputArgs } = await import('../../../lib/helpers/streams.ts');
const { FilterGraph, videoFilterChain, audioFilterChain, filterGraph, GraphNode, GraphStream } = await import('../../../lib/filters/complex.ts');
const _GraphNode = GraphNode;
const _GraphStream = GraphStream;
const { killAllFFmpeg } = await import('../../../lib/helpers/process.ts');
const { buildTwoPassArgs } = await import('../../../lib/helpers/twopass.ts');

// ─── hls builders ────────────────────────────────────────────────────────────
describe('hls builders', () => {

  it('buildHlsArgs includes input and output', () => {
    const args = buildHlsArgs('in.mp4', '/out', {} as any);
    assert.ok(args.includes('in.mp4'));
    assert.ok(args.some((a: string) => a.includes('/out')));
  });

  it('buildHlsArgs includes hls_time', () => {
    const args = buildHlsArgs('in.mp4', '/out', { segmentDuration: 4 } as any);
    assert.ok(args.includes('-hls_time'));
    assert.ok(args.includes('4'));
  });

  it('buildHlsArgs with videoCodec', () => {
    const args = buildHlsArgs('in.mp4', '/out', { videoCodec: 'libx264' } as any);
    assert.ok(args.includes('-c:v'));
    assert.ok(args.includes('libx264'));
  });

  it('buildHlsArgs with hlsFlags', () => {
    const args = buildHlsArgs('in.mp4', '/out', { hlsFlags: 'delete_segments' } as any);
    assert.ok(args.includes('-hls_flags'));
    assert.ok(args.includes('delete_segments'));
  });

  it('buildHlsArgs default hls_list_size is 0', () => {
    const args = buildHlsArgs('in.mp4', '/out', {} as any);
    const idx = args.indexOf('-hls_list_size');
    assert.ok(idx >= 0);
    assert.strictEqual(args[idx + 1], '0');
  });

  it('buildDashArgs includes -f dash', () => {
    const args = buildDashArgs('in.mp4', '/out/manifest.mpd', {} as any);
    assert.ok(args.includes('-f'));
    assert.ok(args.includes('dash'));
  });

  it('buildDashArgs with videoCodec and bitrate', () => {
    const args = buildDashArgs('in.mp4', '/out/manifest.mpd', { videoCodec: 'libx264', videoBitrate: '2M' } as any);
    assert.ok(args.includes('libx264'));
    assert.ok(args.includes('2M'));
  });

  it('buildDashArgs with segmentDuration', () => {
    const args = buildDashArgs('in.mp4', '/out/manifest.mpd', { segmentDuration: 4 } as any);
    assert.ok(args.includes('-seg_duration'));
    assert.ok(args.includes('4'));
  });
});

// ─── watermark builders ───────────────────────────────────────────────────────
describe('watermark builders', () => {

  it('buildWatermarkFilter bottom-right contains overlay expr', () => {
    const f = buildWatermarkFilter('bottom-right', 10, 1.0);
    assert.ok(f.includes('overlay='));
    assert.ok(f.includes('[wm]'));
    assert.ok(f.includes('[out]'));
  });

  it('buildWatermarkFilter with opacity < 1 adds colorchannelmixer', () => {
    const f = buildWatermarkFilter('center', 10, 0.5);
    assert.ok(f.includes('colorchannelmixer'));
    assert.ok(f.includes('0.5'));
  });

  it('buildWatermarkFilter with scaleWidth adds scale', () => {
    const f = buildWatermarkFilter('top-left', 10, 1.0, 200);
    assert.ok(f.includes('scale=200'));
  });

  it('buildWatermarkFilter top-left position', () => {
    const f = buildWatermarkFilter('top-left', 5, 1.0);
    assert.ok(f.includes('overlay=5:5'));
  });

  it('buildWatermarkFilter top-right position', () => {
    const f = buildWatermarkFilter('top-right', 10, 1.0);
    assert.ok(f.includes('W-w-10:10'));
  });

  it('buildWatermarkFilter center position', () => {
    const f = buildWatermarkFilter('center', 0, 1.0);
    assert.ok(f.includes('(W-w)/2:(H-h)/2'));
  });

  it('buildWatermarkFilter bottom-left position', () => {
    const f = buildWatermarkFilter('bottom-left', 10, 1.0);
    assert.ok(f.includes('10:H-h-10'));
  });

  it('buildWatermarkFilter bottom-center position', () => {
    const f = buildWatermarkFilter('bottom-center', 10, 1.0);
    assert.ok(f.includes('(W-w)/2:H-h-10'));
  });

  it('buildWatermarkFilter top-center position', () => {
    const f = buildWatermarkFilter('top-center', 10, 1.0);
    assert.ok(f.includes('(W-w)/2:10'));
  });

  it('buildWatermarkFilter custom position string', () => {
    const f = buildWatermarkFilter('100:200', 0, 1.0);
    assert.ok(f.includes('overlay=100:200'));
  });

  it('buildTextWatermarkFilter bottom-right has correct expr', () => {
    const f = buildTextWatermarkFilter('Hello', 'bottom-right', 10, 24, 'white');
    assert.ok(f.includes('drawtext='));
    assert.ok(f.includes('Hello'));
    assert.ok(f.includes('w-tw-10'));
  });

  it('buildTextWatermarkFilter center position', () => {
    const f = buildTextWatermarkFilter('Test', 'center', 0, 24, 'white');
    assert.ok(f.includes('(w-tw)/2'));
    assert.ok(f.includes('(h-th)/2'));
  });

  it('buildTextWatermarkFilter with fontFile', () => {
    const f = buildTextWatermarkFilter('Hi', 'top-left', 5, 20, 'red', '/fonts/font.ttf');
    assert.ok(f.includes('fontfile='));
  });

  it('buildTextWatermarkFilter top-right position', () => {
    const f = buildTextWatermarkFilter('TL', 'top-right', 10, 24, 'white');
    assert.ok(f.includes('x=w-tw-10'));
    assert.ok(f.includes('y=10'));
  });

  it('buildTextWatermarkFilter bottom-left position', () => {
    const f = buildTextWatermarkFilter('BL', 'bottom-left', 10, 24, 'white');
    assert.ok(f.includes('10'));
    assert.ok(f.includes('h-th-10'));
  });

  it('buildTextWatermarkFilter bottom-center position', () => {
    const f = buildTextWatermarkFilter('BC', 'bottom-center', 10, 24, 'white');
    assert.ok(f.includes('(w-tw)/2'));
    assert.ok(f.includes('h-th-10'));
  });

  it('buildTextWatermarkFilter top-center position', () => {
    const f = buildTextWatermarkFilter('TC', 'top-center', 10, 24, 'white');
    assert.ok(f.includes('x=(w-tw)/2'));
    assert.ok(f.includes('y=10'));
  });
});

// ─── subtitle builders ────────────────────────────────────────────────────────
describe('subtitle builders', () => {

  it('basic filter contains subtitles path', () => {
    const f = buildBurnSubtitlesFilter('/tmp/subs.srt');
    assert.ok(f.includes('subtitles='));
    assert.ok(f.includes('subs.srt'));
  });

  it('with fontSize adds force_style', () => {
    const f = buildBurnSubtitlesFilter('/tmp/subs.srt', 24);
    assert.ok(f.includes('FontSize=24'));
    assert.ok(f.includes('force_style'));
  });

  it('with fontName adds FontName', () => {
    const f = buildBurnSubtitlesFilter('/tmp/subs.srt', undefined, 'Arial');
    assert.ok(f.includes('FontName=Arial'));
  });

  it('with primaryColor adds PrimaryColour', () => {
    const f = buildBurnSubtitlesFilter('/tmp/subs.srt', undefined, undefined, '&H00FFFFFF&');
    assert.ok(f.includes('PrimaryColour='));
  });

  it('with all style options combines them', () => {
    const f = buildBurnSubtitlesFilter('/tmp/subs.srt', 24, 'Arial', '&H00FFFFFF&');
    assert.ok(f.includes('FontSize=24'));
    assert.ok(f.includes('FontName=Arial'));
    assert.ok(f.includes('PrimaryColour='));
  });
});

// ─── waveform builders ────────────────────────────────────────────────────────
describe('waveform builders', () => {

  it('buildWaveformFilter includes dimensions', () => {
    const f = buildWaveformFilter(1920, 240, '#00ff00', 'lin', 'line', 0);
    assert.ok(f.includes('1920x240'));
    assert.ok(f.includes('showwavespic'));
  });

  it('buildWaveformFilter includes color', () => {
    const f = buildWaveformFilter(1920, 240, '#ff0000', 'lin', 'line', 0);
    assert.ok(f.includes('#ff0000'));
  });

  it('buildWaveformFilter includes scale', () => {
    const f = buildWaveformFilter(1920, 240, '#00ff00', 'log', 'line', 0);
    assert.ok(f.includes('scale=log'));
  });

  it('buildWaveformFilter includes draw mode', () => {
    const f = buildWaveformFilter(1920, 240, '#00ff00', 'lin', 'p2p', 0);
    assert.ok(f.includes('draw=p2p'));
  });

  it('buildWaveformFilter stream index non-zero', () => {
    const f = buildWaveformFilter(1920, 240, '#00ff00', 'lin', 'line', 2);
    assert.ok(f.includes('[0:a:2]'));
  });

  it('buildSpectrumFilter includes dimensions', () => {
    const f = buildSpectrumFilter(1280, 720, 'fire', 25);
    assert.ok(f.includes('1280x720'));
    assert.ok(f.includes('showspectrum'));
  });

  it('buildSpectrumFilter includes fps', () => {
    const f = buildSpectrumFilter(1280, 720, 'fire', 30);
    assert.ok(f.includes('fps=30'));
  });
});

// ─── metadata builders ────────────────────────────────────────────────────────
describe('metadata builders', () => {

  it('buildMetadataArgs adds -metadata flags', () => {
    const args = buildMetadataArgs({ title: 'My Film', artist: 'Director' });
    assert.ok(args.includes('-metadata'));
    assert.ok(args.includes('title=My Film'));
    assert.ok(args.includes('artist=Director'));
  });

  it('buildMetadataArgs includes -c copy', () => {
    const args = buildMetadataArgs({});
    assert.ok(args.includes('-c'));
    assert.ok(args.includes('copy'));
  });

  it('buildMetadataArgs with stream metadata', () => {
    const args = buildMetadataArgs({}, { 'a:0': { language: 'eng' } });
    assert.ok(args.some((a: string) => a.includes('-metadata:s:a:0')));
    assert.ok(args.includes('language=eng'));
  });

  it('buildChapterContent creates FFMETADATA1 header', () => {
    const content = buildChapterContent([
      { title: 'Intro', startSec: 0, endSec: 30 },
      { title: 'Main', startSec: 30, endSec: 120 },
    ]);
    assert.ok(content.includes(';FFMETADATA1'));
    assert.ok(content.includes('[CHAPTER]'));
    assert.ok(content.includes('Intro'));
    assert.ok(content.includes('Main'));
  });

  it('buildChapterContent has correct millisecond timestamps', () => {
    const content = buildChapterContent([{ title: 'Ch1', startSec: 1, endSec: 2 }]);
    assert.ok(content.includes('START=1000'));
    assert.ok(content.includes('END=2000'));
  });
});

// ─── normalize builders ───────────────────────────────────────────────────────
describe('normalize builders', () => {

  it('basic filter has loudnorm', () => {
    const f = buildLoudnormFilter(-23, 7, -2);
    assert.ok(f.includes('loudnorm'));
    assert.ok(f.includes('i=-23'));
    assert.ok(f.includes('lra=7'));
    assert.ok(f.includes('tp=-2'));
  });

  it('with measured values adds linear mode', () => {
    const f = buildLoudnormFilter(-23, 7, -2, { inputI: -24, inputLra: 8, inputTp: -3, inputThresh: -34, targetOffset: 1 });
    assert.ok(f.includes('linear=true'));
    assert.ok(f.includes('measured_i=-24'));
  });

  it('without measured does not include linear', () => {
    const f = buildLoudnormFilter(-16, 11, -1);
    assert.ok(!f.includes('linear'));
  });

  it('custom targets reflected in filter', () => {
    const f = buildLoudnormFilter(-16, 11, -1.5);
    assert.ok(f.includes('i=-16'));
    assert.ok(f.includes('lra=11'));
    assert.ok(f.includes('tp=-1.5'));
  });
});

// ─── gif builders ─────────────────────────────────────────────────────────────
describe('gif builders', () => {

  it('buildGifArgs pass1 includes palettegen', () => {
    const { pass1 } = buildGifArgs('in.mp4', '/tmp/p.png', 'out.gif', 15, 480, 'bayer');
    assert.ok(pass1.some((a: string) => a.includes('palettegen')));
    assert.ok(pass1.includes('/tmp/p.png'));
  });

  it('buildGifArgs pass2 includes paletteuse', () => {
    const { pass2 } = buildGifArgs('in.mp4', '/tmp/p.png', 'out.gif', 15, 480, 'bayer');
    assert.ok(pass2.some((a: string) => a.includes('paletteuse')));
    assert.ok(pass2.includes('out.gif'));
  });

  it('buildGifArgs with startTime adds -ss', () => {
    const { pass1 } = buildGifArgs('in.mp4', '/tmp/p.png', 'out.gif', 15, 480, 'bayer', 5);
    assert.ok(pass1.includes('-ss'));
    assert.ok(pass1.includes('5'));
  });

  it('buildGifArgs with duration adds -t', () => {
    const { pass2 } = buildGifArgs('in.mp4', '/tmp/p.png', 'out.gif', 15, 480, 'bayer', undefined, 10);
    assert.ok(pass2.includes('-t'));
    assert.ok(pass2.includes('10'));
  });

  it('buildGifPalettegenFilter has fps and scale', () => {
    const f = buildGifPalettegenFilter(15, 480, 256);
    assert.ok(f.includes('fps=15'));
    assert.ok(f.includes('scale=480'));
    assert.ok(f.includes('palettegen'));
  });

  it('buildGifPalettegenFilter custom colors', () => {
    const f = buildGifPalettegenFilter(10, 320, 128);
    assert.ok(f.includes('128'));
  });
});

// ─── screenshot builders ──────────────────────────────────────────────────────
describe('screenshot builders', () => {

  it('buildScreenshotArgs has -vframes 1', () => {
    const args = buildScreenshotArgs('in.mp4', '/tmp/out.png', 10);
    assert.ok(args.includes('-vframes'));
    assert.ok(args.includes('1'));
    assert.ok(args.includes('10'));
  });

  it('buildScreenshotArgs with size adds -s', () => {
    const args = buildScreenshotArgs('in.mp4', '/tmp/out.png', 10, '1280x720');
    assert.ok(args.includes('-s'));
    assert.ok(args.includes('1280x720'));
  });

  it('buildFrameBufferArgs has pipe:1 output', () => {
    const args = buildFrameBufferArgs('in.mp4', 5, 'png');
    assert.ok(args.includes('pipe:1'));
    assert.ok(args.includes('-f'));
    assert.ok(args.includes('image2pipe'));
  });

  it('buildFrameBufferArgs mjpeg format', () => {
    const args = buildFrameBufferArgs('in.mp4', 5, 'mjpeg');
    assert.ok(args.includes('mjpeg'));
  });

  it('buildTimestampFilename replaces %04d with padded index', () => {
    const name = buildTimestampFilename('screenshot_%04d.png', 0, '.png');
    assert.strictEqual(name, 'screenshot_0001.png');
  });

  it('buildTimestampFilename index 9 pads to 0010', () => {
    const name = buildTimestampFilename('thumb_%04d.png', 9, '.png');
    assert.strictEqual(name, 'thumb_0010.png');
  });
});

// ─── stream builders ──────────────────────────────────────────────────────────
describe('stream builders', () => {

  it('buildPipeThroughArgs has pipe:0 input and pipe:1 output', () => {
    const args = buildPipeThroughArgs(undefined, [], undefined);
    assert.ok(args.includes('pipe:0'));
    assert.ok(args.includes('pipe:1'));
  });

  it('buildPipeThroughArgs with inputFormat adds -f before input', () => {
    const args = buildPipeThroughArgs('mp4', [], undefined);
    const fIdx = args.indexOf('-f');
    assert.ok(fIdx >= 0);
    assert.strictEqual(args[fIdx + 1], 'mp4');
  });

  it('buildPipeThroughArgs with outputFormat adds -f before pipe:1', () => {
    const args = buildPipeThroughArgs(undefined, [], 'ogg');
    const lastF = args.lastIndexOf('-f');
    assert.ok(lastF >= 0);
    assert.strictEqual(args[lastF + 1], 'ogg');
  });

  it('buildPipeThroughArgs passes outputArgs through', () => {
    const args = buildPipeThroughArgs(undefined, ['-c:v', 'libx264'], undefined);
    assert.ok(args.includes('-c:v'));
    assert.ok(args.includes('libx264'));
  });

  it('buildStreamOutputArgs has input file and pipe:1', () => {
    const args = buildStreamOutputArgs('input.mp4', [], 'mp4');
    assert.ok(args.includes('input.mp4'));
    assert.ok(args.includes('pipe:1'));
  });

  it('buildStreamOutputArgs with seekInput adds -ss', () => {
    const args = buildStreamOutputArgs('input.mp4', [], 'mp4', 30);
    assert.ok(args.includes('-ss'));
    assert.ok(args.includes('30'));
  });

  it('buildStreamOutputArgs without seekInput no -ss', () => {
    const args = buildStreamOutputArgs('input.mp4', [], 'mp4');
    assert.ok(!args.includes('-ss'));
  });
});

// ─── complex.ts builders coverage ────────────────────────────────────────────
describe('filter complex coverage', () => {

  it('FilterGraph toString with no nodes returns empty string', () => {
    const g = new FilterGraph();
    assert.strictEqual(g.toString(), '');
  });

  it('filterGraph factory returns FilterGraph', () => {
    const g = filterGraph();
    assert.ok(g instanceof FilterGraph);
  });

  it('videoFilterChain creates chain', () => {
    const chain = videoFilterChain();
    assert.ok(chain !== null);
  });

  it('audioFilterChain creates chain', () => {
    const chain = audioFilterChain();
    assert.ok(chain !== null);
  });

  it('FilterGraph size starts at 0', () => {
    const g = new FilterGraph();
    assert.strictEqual(g.size, 0);
  });

  it('videoFilterChain toString works', () => {
    const chain = videoFilterChain();
    assert.ok(typeof chain.toString() === 'string');
  });
});

// ─── process.ts helper coverage ───────────────────────────────────────────────
describe('process helper renice/killAll', () => {

  it('killAllFFmpeg does not throw when no ffmpeg running', () => {
    assert.doesNotThrow(() => killAllFFmpeg('SIGTERM'));
  });
});

// ─── twopass builders ─────────────────────────────────────────────────────────
describe('twopass buildTwoPassArgs', () => {

  it('pass1 has -pass 1 and -an', () => {
    const r = buildTwoPassArgs({ input: 'in.mp4', output: 'out.mp4', videoCodec: 'libx264', videoBitrate: '2M' });
    assert.ok(r.pass1.includes('-pass'));
    assert.ok(r.pass1.includes('1'));
    assert.ok(r.pass1.includes('-an'));
  });

  it('pass2 has -pass 2 and output path', () => {
    const r = buildTwoPassArgs({ input: 'in.mp4', output: 'out.mp4', videoCodec: 'libx264', videoBitrate: '2M' });
    assert.ok(r.pass2.includes('2'));
    assert.ok(r.pass2.includes('out.mp4'));
  });

  it('with audioCodec=none omits audio in pass2', () => {
    const r = buildTwoPassArgs({ input: 'in.mp4', output: 'out.mp4', videoCodec: 'libx264', videoBitrate: '2M', audioCodec: 'none' });
    assert.ok(!r.pass2.includes('-c:a'));
  });

  it('with audioCodec adds -c:a in pass2', () => {
    const r = buildTwoPassArgs({ input: 'in.mp4', output: 'out.mp4', videoCodec: 'libx264', videoBitrate: '2M', audioCodec: 'aac', audioBitrate: '128k' });
    assert.ok(r.pass2.includes('aac'));
    assert.ok(r.pass2.includes('128k'));
  });

  it('without audioCodec defaults to copy in pass2', () => {
    const r = buildTwoPassArgs({ input: 'in.mp4', output: 'out.mp4', videoCodec: 'libx264', videoBitrate: '2M' });
    assert.ok(r.pass2.includes('copy'));
  });

  it('with overwrite=false uses -n', () => {
    const r = buildTwoPassArgs({ input: 'in.mp4', output: 'out.mp4', videoCodec: 'libx264', videoBitrate: '2M', overwrite: false });
    assert.ok(r.pass2.includes('-n'));
    assert.ok(!r.pass2.includes('-y'));
  });

  it('passlog is included in both passes', () => {
    const r = buildTwoPassArgs({ input: 'in.mp4', output: 'out.mp4', videoCodec: 'libx264', videoBitrate: '2M', passlogfile: '/tmp/mylog' });
    assert.ok(r.pass1.includes('/tmp/mylog'));
    assert.ok(r.pass2.includes('/tmp/mylog'));
    assert.strictEqual(r.passlog, '/tmp/mylog');
  });

  it('extraInputArgs included', () => {
    const r = buildTwoPassArgs({ input: 'in.mp4', output: 'out.mp4', videoCodec: 'libx264', videoBitrate: '2M', extraInputArgs: ['-ss', '10'] });
    assert.ok(r.pass1.includes('-ss'));
  });

  it('extraOutputArgs included in both passes', () => {
    const r = buildTwoPassArgs({ input: 'in.mp4', output: 'out.mp4', videoCodec: 'libx264', videoBitrate: '2M', extraOutputArgs: ['-pix_fmt', 'yuv420p'] });
    assert.ok(r.pass1.includes('-pix_fmt'));
    assert.ok(r.pass2.includes('-pix_fmt'));
  });
});
