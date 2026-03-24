import { describe, it } from 'node:test';
import { expect } from '../../lib/expect.ts';
import {
  FilterGraph,
  VideoFilterChain,
  AudioFilterChain,
  videoFilterChain,
  audioFilterChain,
  filterGraph,
  resetLabelCounter,
} from '../../../lib/filters/complex.ts';

describe('VideoFilterChain', () => {
  it('creates via factory', () => {
    const vf = videoFilterChain();
    expect(vf).toBeInstanceOf(VideoFilterChain);
  });

  it('scale produces correct output', () => {
    expect(videoFilterChain().scale(1280, 720).toString()).toBe('scale=1280:720');
  });

  it('scale with flags', () => {
    const s = videoFilterChain().scale(1280, 720, 'lanczos').toString();
    expect(s).toContain('flags=lanczos');
  });

  it('chain multiple filters', () => {
    const s = videoFilterChain().scale(1280, 720).fps(30).vflip().toString();
    expect(s).toBe('scale=1280:720,fps=30,vflip');
  });

  it('crop with offsets', () => {
    const s = videoFilterChain().crop(640, 360, 10, 20).toString();
    expect(s).toContain('crop=640:360');
    expect(s).toContain('x=10');
    expect(s).toContain('y=20');
  });

  it('pad with color', () => {
    const s = videoFilterChain().pad(1920, 1080, '(ow-iw)/2', '(oh-ih)/2', 'black').toString();
    expect(s).toContain('pad=1920:1080');
    expect(s).toContain('color=black');
  });

  it('setpts', () => {
    expect(videoFilterChain().setpts('PTS-STARTPTS').toString()).toBe('setpts=PTS-STARTPTS');
  });

  it('hflip', () => {
    expect(videoFilterChain().hflip().toString()).toBe('hflip');
  });

  it('format', () => {
    expect(videoFilterChain().format('yuv420p').toString()).toBe('format=yuv420p');
  });

  it('unsharp with defaults', () => {
    const s = videoFilterChain().unsharp().toString();
    expect(s).toContain('unsharp=');
  });

  it('eq with brightness and contrast', () => {
    const s = videoFilterChain().eq(0.1, 1.2).toString();
    expect(s).toContain('brightness=0.1');
    expect(s).toContain('contrast=1.2');
  });

  it('drawtext', () => {
    const s = videoFilterChain().drawtext('Hello', 10, 10, 48, 'white').toString();
    expect(s).toContain('text=Hello');
    expect(s).toContain('fontsize=48');
    expect(s).toContain('fontcolor=white');
  });

  it('yadif', () => {
    const s = videoFilterChain().yadif(1).toString();
    expect(s).toContain('mode=1');
  });

  it('transpose', () => {
    const s = videoFilterChain().transpose(1).toString();
    expect(s).toBe('transpose=1');
  });

  it('fade', () => {
    const s = videoFilterChain().fade('in', 0, 30).toString();
    expect(s).toContain('type=in');
    expect(s).toContain('nb_frames=30');
  });

  it('thumbnail', () => {
    const s = videoFilterChain().thumbnail(150).toString();
    expect(s).toBe('thumbnail=150');
  });

  it('raw passthrough', () => {
    const s = videoFilterChain().raw('scale=1280:720').raw('fps=30').toString();
    expect(s).toBe('scale=1280:720,fps=30');
  });

  it('full pipeline: scale → deinterlace → denoise → drawtext', () => {
    const s = videoFilterChain()
      .scale(1920, 1080)
      .yadif()
      .unsharp(3, 3, 0.5)
      .drawtext('Test', 'w/2', 'h/2', 32, 'yellow')
      .toString();
    expect(s).toContain('scale=1920:1080');
    expect(s).toContain('yadif=');
    expect(s).toContain('unsharp=');
    expect(s).toContain('text=Test');
    expect(s.split(',').length).toBe(4);
  });
});

describe('AudioFilterChain', () => {
  it('creates via factory', () => {
    expect(audioFilterChain()).toBeInstanceOf(AudioFilterChain);
  });

  it('volume', () => {
    expect(audioFilterChain().volume(1.5).toString()).toBe('volume=1.5');
  });

  it('loudnorm', () => {
    const s = audioFilterChain().loudnorm(-23, 7, -2).toString();
    expect(s).toContain('i=-23');
    expect(s).toContain('lra=7');
    expect(s).toContain('tp=-2');
  });

  it('highpass and lowpass', () => {
    const s = audioFilterChain().highpass(80).lowpass(16000).toString();
    expect(s).toContain('highpass=');
    expect(s).toContain('lowpass=');
    expect(s).toContain('f=80');
    expect(s).toContain('f=16000');
  });

  it('equalizer', () => {
    const s = audioFilterChain().equalizer(1000, 1.0, 6, 'o').toString();
    expect(s).toContain('f=1000');
    expect(s).toContain('g=6');
  });

  it('afade in', () => {
    const s = audioFilterChain().afade('in', 0, 2).toString();
    expect(s).toContain('type=in');
    expect(s).toContain('duration=2');
  });

  it('atempo', () => {
    expect(audioFilterChain().atempo(1.25).toString()).toBe('atempo=1.25');
  });

  it('asetpts', () => {
    expect(audioFilterChain().asetpts('PTS-STARTPTS').toString()).toBe('asetpts=PTS-STARTPTS');
  });

  it('dynaudnorm', () => {
    const s = audioFilterChain().dynaudnorm(500, 0.95).toString();
    expect(s).toContain('dynaudnorm=');
    expect(s).toContain('f=500');
  });

  it('silencedetect', () => {
    const s = audioFilterChain().silencedetect('-60dB', 2).toString();
    expect(s).toContain('noise=-60dB');
    expect(s).toContain('duration=2');
  });

  it('aecho', () => {
    const s = audioFilterChain().aecho(0.6, 0.3, '1000', '0.5').toString();
    expect(s).toContain('aecho=');
    expect(s).toContain('in_gain=0.6');
  });

  it('rubberband', () => {
    const s = audioFilterChain().rubberband(1.25, 1.0).toString();
    expect(s).toContain('tempo=1.25');
    expect(s).toContain('pitch=1');
  });

  it('raw passthrough', () => {
    const s = audioFilterChain().raw('volume=2dB').toString();
    expect(s).toBe('volume=2dB');
  });

  it('full pipeline: loudnorm → highpass → afade → volume', () => {
    const s = audioFilterChain()
      .loudnorm(-23, 7, -2)
      .highpass(80)
      .afade('in', 0, 1)
      .volume('1.0')
      .toString();
    expect(s.split(',').length).toBe(4);
  });
});

describe('FilterGraph', () => {
  it('creates via factory', () => {
    resetLabelCounter();
    expect(filterGraph()).toBeInstanceOf(FilterGraph);
  });

  it('starts empty', () => {
    const g = filterGraph();
    expect(g.size).toBe(0);
    expect(g.toString()).toBe('');
  });

  it('from() returns a GraphNode', () => {
    const g = filterGraph();
    const node = g.from('[0:v]');
    expect(node).toBeDefined();
  });

  it('scale adds a link', () => {
    const g = filterGraph();
    g.from('[0:v]').scale(1280, 720).out('scaled');
    expect(g.size).toBe(1);
  });

  it('serializes a scale link correctly', () => {
    const g = filterGraph();
    g.from('[0:v]').scale(1280, 720).out('scaled');
    expect(g.toString()).toContain('[0:v]scale=1280:720[scaled]');
  });

  it('serializes multiple links with semicolon separator', () => {
    const g = filterGraph();
    g.from('[0:v]').scale(1280, 720).out('v');
    g.from('[0:a]').volume(1.5).out('a');
    const s = g.toString();
    expect(s).toContain(';');
    expect(s).toContain('[0:v]scale=1280:720[v]');
    expect(s).toContain('[0:a]volume=1.5[a]');
  });

  it('supports chained filters via GraphNode.filter()', () => {
    const g = filterGraph();
    g.from('[0:v]').scale(640, 360).fps(30).out('out');
    const s = g.toString();
    expect(s).toContain('scale=640:360');
    expect(s).toContain('fps=30');
  });

  it('vflip and hflip work on GraphNode', () => {
    const g = filterGraph();
    g.from('[0:v]').vflip().hflip().out('flipped');
    const s = g.toString();
    expect(s).toContain('vflip');
    expect(s).toContain('hflip');
  });

  it('colorkey on GraphNode', () => {
    const g = filterGraph();
    g.from('[1:v]').colorkey('#00ff00', 0.1, 0.0).out('logo');
    expect(g.toString()).toContain('colorkey=#00ff00');
  });

  it('merge() creates MultiInputNode for overlay', () => {
    const g = filterGraph();
    const [v] = g.from('[0:v]').scale(640, 360).out('v');
    const [logo] = g.from('[1:v]').colorkey('#00ff00', 0.1, 0).out('logo');
    g.merge(v!, logo!).overlay(10, 20).out('final');
    const s = g.toString();
    expect(s).toContain('overlay=10:20');
    expect(s).toContain('[final]');
    expect(g.size).toBe(3);
  });

  it('merge() hstack', () => {
    const g = filterGraph();
    const [v1] = g.from('[0:v]').scale(640, 360).out('v1');
    const [v2] = g.from('[1:v]').scale(640, 360).out('v2');
    g.merge(v1!, v2!).hstack(2).out('stacked');
    const s = g.toString();
    expect(s).toContain('hstack=');
    expect(s).toContain('[stacked]');
  });

  it('merge() amerge for audio', () => {
    const g = filterGraph();
    const [a1] = g.from('[0:a]').volume(1.0).out('a1');
    const [a2] = g.from('[1:a]').volume(1.0).out('a2');
    g.merge(a1!, a2!).amerge(2).out('mixed');
    const s = g.toString();
    expect(s).toContain('amerge=');
    expect(s).toContain('[mixed]');
  });

  it('merge() amix with duration', () => {
    const g = filterGraph();
    const [a1] = g.from('[0:a]').out('a1');
    const [a2] = g.from('[1:a]').out('a2');
    g.merge(a1!, a2!).amix(2, 'shortest').out('mix');
    const s = g.toString();
    expect(s).toContain('amix=');
    expect(s).toContain('duration=shortest');
  });

  it('merge() concat for segments', () => {
    const g = filterGraph();
    const [v1] = g.from('[0:v]').out('v1');
    const [a1] = g.from('[0:a]').out('a1');
    const [v2] = g.from('[1:v]').out('v2');
    const [a2] = g.from('[1:a]').out('a2');
    g.merge(v1!, a1!, v2!, a2!).concat(2, 1, 1).out('vout', 'aout');
    const s = g.toString();
    expect(s).toContain('concat=');
    expect(s).toContain('n=2');
    expect(s).toContain('[vout][aout]');
  });

  it('mapOut() assigns a named output label', () => {
    const g = filterGraph();
    const out = g.from('[0:v]').scale(1280, 720).mapOut('final');
    expect(out.toString()).toBe('[final]');
    expect(g.toString()).toContain('[final]');
  });

  it('outAuto() generates a unique label', () => {
    const g = filterGraph();
    const a = g.from('[0:v]').scale(640, 360).outAuto('video');
    const b = g.from('[0:v]').scale(320, 180).outAuto('video');
    expect(a.label).not.toBe(b.label);
  });

  it('supports string refs in from()', () => {
    const g = filterGraph();
    g.from('[0:v]', '[1:v]').filter('hstack', [], { inputs: 2 }).out('side');
    const s = g.toString();
    expect(s).toContain('[0:v][1:v]hstack=inputs=2[side]');
  });

  it('supports GraphStream refs in from()', () => {
    const g = filterGraph();
    const [scaled] = g.from('[0:v]').scale(640, 360).out('scaled');
    g.from(scaled!).fps(30).out('final');
    const s = g.toString();
    expect(s).toContain('[scaled]fps=30[final]');
  });
});
