import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { buildExtractFramesArgs } = await import('../../../lib/helpers/screenshots.ts');
const { buildConcatTransitionArgs } = await import('../../../lib/helpers/concat.ts');
const { buildSilenceDetectFilter, buildSceneSelectFilter, buildBurnTimecodeFilter } = await import('../../../lib/helpers/normalize.ts');
const { FFmpegBuilder } = await import('../../../lib/FFmpeg.ts');

// ─── extractFrames helpers ──────────────────────────────────────────────────
describe('extractFrames helpers', () => {

  it('buildExtractFramesArgs includes fps', () => {
    const args = buildExtractFramesArgs('in.mp4', 'out_%05d.png', '30');
    assert.ok(args.includes('-vf'));
    assert.ok(args.includes('fps=30'));
  });

  it('buildExtractFramesArgs includes input and output', () => {
    const args = buildExtractFramesArgs('in.mp4', 'frame_%05d.png', '1');
    assert.ok(args.includes('-i'));
    assert.ok(args.includes('in.mp4'));
    assert.ok(args.includes('frame_%05d.png'));
  });

  it('buildExtractFramesArgs with startTime', () => {
    const args = buildExtractFramesArgs('in.mp4', 'frame_%05d.png', '1', 10);
    assert.ok(args.includes('-ss'));
    assert.ok(args.includes('10'));
  });

  it('buildExtractFramesArgs with endTime', () => {
    const args = buildExtractFramesArgs('in.mp4', 'frame_%05d.png', '1', 0, 30);
    assert.ok(args.includes('-t'));
    assert.ok(args.includes('30'));
  });

  it('buildExtractFramesArgs with size', () => {
    const args = buildExtractFramesArgs('in.mp4', 'frame_%05d.png', '1', undefined, undefined, '1920x1080');
    assert.ok(args.includes('-s'));
    assert.ok(args.includes('1920x1080'));
  });

  it('buildExtractFramesArgs with jpg quality', () => {
    const args = buildExtractFramesArgs('in.mp4', 'frame.jpg', '1', undefined, undefined, undefined, 'jpg');
    assert.ok(args.includes('-q:v'));
    assert.ok(args.includes('2'));
  });
});

// ─── concatWithTransitions helpers ─────────────────────────────────────────────
describe('concatWithTransitions helpers', () => {

  it('buildConcatTransitionArgs returns args array', () => {
    const args = buildConcatTransitionArgs(['a.mp4', 'b.mp4'], 'out.mp4', 'crossfade', 1);
    assert.ok(Array.isArray(args));
  });

  it('buildConcatTransitionArgs inputs two files', () => {
    const args = buildConcatTransitionArgs(['a.mp4', 'b.mp4'], 'out.mp4', 'crossfade', 1);
    const inputCount = args.filter(a => a === '-i').length;
    assert.strictEqual(inputCount, 2);
  });

  it('buildConcatTransitionArgs includes xfade filter', () => {
    const args = buildConcatTransitionArgs(['a.mp4', 'b.mp4'], 'out.mp4', 'xfade', 1);
    assert.ok(args.some(a => a.includes('xfade=transition')));
  });

  it('buildConcatTransitionArgs includes output', () => {
    const args = buildConcatTransitionArgs(['a.mp4', 'b.mp4'], 'out.mp4', 'crossfade', 1);
    assert.ok(args.includes('out.mp4'));
  });

  it('buildConcatTransitionArgs uses custom transition', () => {
    const args = buildConcatTransitionArgs(['a.mp4', 'b.mp4'], 'out.mp4', 'fadewhite', 0.5);
    assert.ok(args.some(a => a.includes('transition=fadewhite')));
  });

  it('buildConcatTransitionArgs with resolution', () => {
    const args = buildConcatTransitionArgs(['a.mp4', 'b.mp4'], 'out.mp4', 'crossfade', 1, 'libx264', 'aac', '30', '1920x1080');
    assert.ok(args.some(a => a.includes('scale=1920x1080')));
  });
});

// ─── detectSilence helpers ───────────────���─────────────────────────────
describe('detectSilence helpers', () => {

  it('buildSilenceDetectFilter returns filter string', () => {
    const filter = buildSilenceDetectFilter();
    assert.ok(typeof filter === 'string');
    assert.ok(filter.includes('silencedetect'));
  });

  it('buildSilenceDetectFilter with default threshold', () => {
    const filter = buildSilenceDetectFilter();
    assert.ok(filter.includes('noise=-50dB'));
  });

  it('buildSilenceDetectFilter with custom threshold', () => {
    const filter = buildSilenceDetectFilter(-40);
    assert.ok(filter.includes('noise=-40dB'));
  });

  it('buildSilenceDetectFilter with custom duration', () => {
    const filter = buildSilenceDetectFilter(-50, 2);
    assert.ok(filter.includes('d=2'));
  });
});

// ─── detectScenes helpers ─────────────────────────────────────────────
describe('detectScenes helpers', () => {

  it('buildSceneSelectFilter returns filter string', () => {
    const filter = buildSceneSelectFilter();
    assert.ok(typeof filter === 'string');
    assert.ok(filter.includes('select'));
  });

  it('buildSceneSelectFilter with default threshold', () => {
    const filter = buildSceneSelectFilter();
    assert.ok(filter.includes('gt(scene,0.4)'));
  });

  it('buildSceneSelectFilter with custom threshold', () => {
    const filter = buildSceneSelectFilter(0.3);
    assert.ok(filter.includes('gt(scene,0.3)'));
  });

  it('buildSceneSelectFilter includes showinfo', () => {
    const filter = buildSceneSelectFilter();
    assert.ok(filter.includes('showinfo'));
  });
});

// ─── burnTimecode helpers ─────────────────────────────────────────────
describe('burnTimecode helpers', () => {

  it('buildBurnTimecodeFilter returns drawtext filter', () => {
    const filter = buildBurnTimecodeFilter();
    assert.ok(filter.includes('drawtext'));
  });

  it('buildBurnTimecodeFilter with default time format', () => {
    const filter = buildBurnTimecodeFilter();
    assert.ok(filter.includes('%{pts_hms}'));
  });

  it('buildBurnTimecodeFilter with custom format', () => {
    const filter = buildBurnTimecodeFilter('%{pts}');
    assert.ok(filter.includes('%{pts}'));
  });

  it('buildBurnTimecodeFilter with fontsize', () => {
    const filter = buildBurnTimecodeFilter('%{pts_hms}', 32);
    assert.ok(filter.includes('fontsize=32'));
  });

  it('buildBurnTimecodeFilter with fontcolor', () => {
    const filter = buildBurnTimecodeFilter('%{pts_hms}', 48, 'red');
    assert.ok(filter.includes('fontcolor=red'));
  });

  it('buildBurnTimecodeFilter with position', () => {
    const filter = buildBurnTimecodeFilter('%{pts_hms}', 48, 'white', undefined, '10', 'h-th-10');
    assert.ok(filter.includes('x=10'));
    assert.ok(filter.includes('y=h-th-10'));
  });
});

// ─── FFmpegBuilder.dry ─────────────────────────────────────────────────
describe('FFmpegBuilder.dry()', () => {

  it('dry() returns args array', () => {
    const builder = new FFmpegBuilder('in.mp4');
    builder.output('out.mp4');
    const args = builder.dry();
    assert.ok(Array.isArray(args));
    assert.ok(args.length > 0);
  });

  it('dry() includes input file', () => {
    const builder = new FFmpegBuilder('in.mp4');
    builder.output('out.mp4');
    const args = builder.dry();
    assert.ok(args.includes('-i'));
    assert.ok(args.includes('in.mp4'));
  });

  it('dry() includes output file', () => {
    const builder = new FFmpegBuilder('in.mp4');
    builder.output('out.mp4');
    const args = builder.dry();
    assert.ok(args.includes('out.mp4'));
  });

  it('dry() includes video codec args', () => {
    const builder = new FFmpegBuilder('in.mp4');
    builder.output('out.mp4');
    builder.videoCodec('libx264');
    const args = builder.dry();
    assert.ok(args.includes('-c:v'));
    assert.ok(args.includes('libx264'));
  });

  it('dryCommand() returns command string', () => {
    const builder = new FFmpegBuilder('in.mp4');
    builder.output('out.mp4');
    const cmd = builder.dryCommand();
    assert.ok(typeof cmd === 'string');
    assert.ok(cmd.includes('ffmpeg'));
  });

  it('dry() without output includes input only', () => {
    const builder = new FFmpegBuilder('in.mp4');
    const args = builder.dry();
    assert.ok(args.includes('-i'));
    assert.ok(args.includes('in.mp4'));
  });
});