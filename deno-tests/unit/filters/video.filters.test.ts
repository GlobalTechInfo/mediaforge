import { describe, it } from 'node:test';
import { expect } from '../../lib/expect.ts';
import { FilterChain } from '../../../lib/types/filters.ts';
import {
  scale, crop, pad as padFilter, overlay, drawtext,
  fps, setpts, trim, format, setsar, setdar,
  vflip, hflip, rotate, transpose, unsharp, gblur, boxblur,
  eq, hue, colorbalance, yadif, hqdn3d, nlmeans, thumbnail,
  select, concat, split, tile, colorkey, chromakey,
  subtitles, fade, zoompan,
} from '../../../lib/filters/video/index.ts';

function chain(): FilterChain {
  return new FilterChain();
}

describe('scale', () => {
  it('serializes width and height as positional args', () => {
    const s = scale(chain(), { width: 1280, height: 720 }).toString();
    expect(s).toBe('scale=1280:720');
  });

  it('supports expression strings', () => {
    const s = scale(chain(), { width: 'iw/2', height: '-2' }).toString();
    expect(s).toBe('scale=iw/2:-2');
  });

  it('includes flags as named arg', () => {
    const s = scale(chain(), { width: 1280, height: 720, flags: 'lanczos' }).toString();
    expect(s).toContain('flags=lanczos');
  });

  it('includes force_original_aspect_ratio', () => {
    const s = scale(chain(), { width: 1280, height: 720, force_original_aspect_ratio: 'decrease' }).toString();
    expect(s).toContain('force_original_aspect_ratio=decrease');
  });

  it('omits optional args when not provided', () => {
    const s = scale(chain(), { width: 640, height: 480 }).toString();
    expect(s).toBe('scale=640:480');
  });
});

describe('crop', () => {
  it('serializes width and height', () => {
    const s = crop(chain(), { width: 1280, height: 720 }).toString();
    expect(s).toBe('crop=1280:720');
  });

  it('includes x and y offsets', () => {
    const s = crop(chain(), { width: 640, height: 360, x: 10, y: 20 }).toString();
    expect(s).toContain('x=10');
    expect(s).toContain('y=20');
  });
});

describe('overlay', () => {
  it('serializes x/y positions', () => {
    const s = overlay(chain(), { x: 10, y: 20 }).toString();
    expect(s).toContain('overlay=10:20');
  });

  it('supports expression strings', () => {
    const s = overlay(chain(), { x: 'W-w-10', y: 'H-h-10' }).toString();
    expect(s).toContain('overlay=W-w-10:H-h-10');
  });

  it('includes shortest flag', () => {
    const s = overlay(chain(), { x: 0, y: 0, shortest: true }).toString();
    expect(s).toContain('shortest=1');
  });
});

describe('drawtext', () => {
  it('serializes text and position', () => {
    const s = drawtext(chain(), { text: 'Hello', x: 10, y: 10 }).toString();
    expect(s).toContain('text=Hello');
    expect(s).toContain('x=10');
    expect(s).toContain('y=10');
  });

  it('includes fontsize and fontcolor', () => {
    const s = drawtext(chain(), { text: 'Hi', x: 0, y: 0, fontsize: 48, fontcolor: 'white' }).toString();
    expect(s).toContain('fontsize=48');
    expect(s).toContain('fontcolor=white');
  });

  it('supports box with background', () => {
    const s = drawtext(chain(), {
      text: 'Hi', x: 0, y: 0,
      box: true, boxcolor: 'black@0.5', boxborderw: 5,
    }).toString();
    expect(s).toContain('box=1');
    expect(s).toContain('boxcolor=black@0.5');
    expect(s).toContain('boxborderw=5');
  });

  it('supports shadow', () => {
    const s = drawtext(chain(), { text: 'Hi', x: 0, y: 0, shadowx: 2, shadowy: 2 }).toString();
    expect(s).toContain('shadowx=2');
    expect(s).toContain('shadowy=2');
  });

  it('supports enable expression', () => {
    const s = drawtext(chain(), { text: 'Hi', x: 0, y: 0, enable: 'between(t,0,5)' }).toString();
    expect(s).toContain('enable=between(t,0,5)');
  });
});

describe('fps', () => {
  it('serializes frame rate as positional', () => {
    expect(fps(chain(), { fps: 30 }).toString()).toBe('fps=30');
    expect(fps(chain(), { fps: '24000/1001' }).toString()).toBe('fps=24000/1001');
  });
});

describe('setpts', () => {
  it('serializes expression', () => {
    expect(setpts(chain(), 'PTS-STARTPTS').toString()).toBe('setpts=PTS-STARTPTS');
    expect(setpts(chain(), '2*PTS').toString()).toBe('setpts=2*PTS');
  });
});

describe('trim', () => {
  it('serializes start time', () => {
    const s = trim(chain(), { start: 10, end: 30 }).toString();
    expect(s).toContain('start=10');
    expect(s).toContain('end=30');
  });

  it('supports duration', () => {
    const s = trim(chain(), { start: '00:01:00', duration: 60 }).toString();
    expect(s).toContain('duration=60');
  });
});

describe('format', () => {
  it('serializes pixel format', () => {
    expect(format(chain(), 'yuv420p').toString()).toBe('format=yuv420p');
  });

  it('joins multiple formats with pipe', () => {
    expect(format(chain(), ['yuv420p', 'nv12']).toString()).toBe('format=yuv420p|nv12');
  });
});

describe('setsar / setdar', () => {
  it('setsar serializes ratio', () => {
    expect(setsar(chain(), '1:1').toString()).toBe('setsar=1:1');
  });

  it('setsar includes max', () => {
    expect(setsar(chain(), '1:1', 100).toString()).toContain('max=100');
  });

  it('setdar serializes ratio', () => {
    expect(setdar(chain(), '16:9').toString()).toBe('setdar=16:9');
  });
});

describe('flip / transpose', () => {
  it('vflip has no args', () => {
    expect(vflip(chain()).toString()).toBe('vflip');
  });

  it('hflip has no args', () => {
    expect(hflip(chain()).toString()).toBe('hflip');
  });

  it('transpose takes direction', () => {
    expect(transpose(chain(), 1).toString()).toBe('transpose=1');
  });
});

describe('rotate', () => {
  it('serializes angle', () => {
    const s = rotate(chain(), { angle: 'PI/2' }).toString();
    expect(s).toContain('a=PI/2');
  });

  it('includes fill color', () => {
    const s = rotate(chain(), { angle: 0.5, fillcolor: 'black' }).toString();
    expect(s).toContain('fillcolor=black');
  });
});

describe('unsharp', () => {
  it('serializes luma args', () => {
    const s = unsharp(chain(), { lx: 5, ly: 5, la: 1.5 }).toString();
    expect(s).toContain('lx=5');
    expect(s).toContain('la=1.5');
  });

  it('accepts empty options', () => {
    const s = unsharp(chain()).toString();
    expect(s).toBe('unsharp');
  });
});

describe('gblur', () => {
  it('serializes sigma', () => {
    const s = gblur(chain(), { sigma: 2 }).toString();
    expect(s).toContain('sigma=2');
  });
});

describe('boxblur', () => {
  it('serializes luma radius', () => {
    const s = boxblur(chain(), { luma_radius: 3, luma_power: 2 }).toString();
    expect(s).toContain('luma_radius=3');
    expect(s).toContain('luma_power=2');
  });
});

describe('eq', () => {
  it('serializes brightness and contrast', () => {
    const s = eq(chain(), { brightness: 0.1, contrast: 1.2 }).toString();
    expect(s).toContain('brightness=0.1');
    expect(s).toContain('contrast=1.2');
  });

  it('serializes saturation and gamma', () => {
    const s = eq(chain(), { saturation: 1.5, gamma: 0.9 }).toString();
    expect(s).toContain('saturation=1.5');
    expect(s).toContain('gamma=0.9');
  });
});

describe('hue', () => {
  it('serializes hue angle', () => {
    const s = hue(chain(), { h: 30 }).toString();
    expect(s).toContain('h=30');
  });

  it('serializes saturation', () => {
    const s = hue(chain(), { s: 1.5 }).toString();
    expect(s).toContain('s=1.5');
  });
});

describe('colorbalance', () => {
  it('serializes shadow/midtone/highlight adjustments', () => {
    const s = colorbalance(chain(), { rs: 0.1, gm: -0.1, bh: 0.05 }).toString();
    expect(s).toContain('rs=0.1');
    expect(s).toContain('gm=-0.1');
    expect(s).toContain('bh=0.05');
  });
});

describe('yadif', () => {
  it('defaults to empty (mode 0)', () => {
    const s = yadif(chain()).toString();
    expect(s).toBe('yadif');
  });

  it('includes mode and parity', () => {
    const s = yadif(chain(), { mode: 1, parity: 0, deint: 1 }).toString();
    expect(s).toContain('mode=1');
    expect(s).toContain('parity=0');
    expect(s).toContain('deint=1');
  });
});

describe('hqdn3d', () => {
  it('serializes positional strengths', () => {
    const s = hqdn3d(chain(), { s0: 4, s1: 3, s2: 6 }).toString();
    expect(s).toBe('hqdn3d=4:3:6');
  });

  it('accepts empty options', () => {
    const s = hqdn3d(chain()).toString();
    expect(s).toBe('hqdn3d');
  });
});

describe('nlmeans', () => {
  it('serializes denoising strength', () => {
    const s = nlmeans(chain(), { h: 8, r: 7, p: 3 }).toString();
    expect(s).toContain('h=8');
    expect(s).toContain('r=7');
    expect(s).toContain('p=3');
  });
});

describe('thumbnail', () => {
  it('serializes group size', () => {
    expect(thumbnail(chain(), 100).toString()).toBe('thumbnail=100');
  });
  it('uses default of 100', () => {
    expect(thumbnail(chain()).toString()).toBe('thumbnail=100');
  });
});

describe('select', () => {
  it('serializes expression', () => {
    expect(select(chain(), 'not(mod(n,10))').toString()).toBe('select=not(mod(n,10))');
  });
});

describe('concat', () => {
  it('serializes segment count', () => {
    const s = concat(chain(), { n: 2, v: 1, a: 1 }).toString();
    expect(s).toContain('n=2');
    expect(s).toContain('v=1');
    expect(s).toContain('a=1');
  });
});

describe('split', () => {
  it('serializes split count', () => {
    expect(split(chain(), 3).toString()).toBe('split=3');
  });

  it('defaults to 2', () => {
    expect(split(chain()).toString()).toBe('split=2');
  });
});

describe('tile', () => {
  it('serializes grid layout', () => {
    const s = tile(chain(), { layout: '4x3' }).toString();
    expect(s).toContain('tile=4x3');
  });

  it('includes margin and padding', () => {
    const s = tile(chain(), { layout: '3x2', margin: 2, padding: 4, color: 'black' }).toString();
    expect(s).toContain('margin=2');
    expect(s).toContain('padding=4');
    expect(s).toContain('color=black');
  });
});

describe('colorkey / chromakey', () => {
  it('colorkey serializes color', () => {
    const s = colorkey(chain(), { color: '#00ff00', similarity: 0.1, blend: 0 }).toString();
    expect(s).toContain('colorkey=#00ff00');
    expect(s).toContain('similarity=0.1');
  });

  it('chromakey serializes color', () => {
    const s = chromakey(chain(), { color: 'green', similarity: 0.15 }).toString();
    expect(s).toContain('chromakey=green');
  });
});

describe('subtitles', () => {
  it('serializes filename', () => {
    const s = subtitles(chain(), { filename: 'subs.srt' }).toString();
    expect(s).toContain('filename=subs.srt');
  });

  it('includes force_style', () => {
    const s = subtitles(chain(), { filename: 'subs.ass', force_style: 'Bold=1' }).toString();
    expect(s).toContain('force_style=Bold=1');
  });
});

describe('fade', () => {
  it('serializes fade-in with frame numbers', () => {
    const s = fade(chain(), { type: 'in', start_frame: 0, nb_frames: 30 }).toString();
    expect(s).toContain('type=in');
    expect(s).toContain('start_frame=0');
    expect(s).toContain('nb_frames=30');
  });

  it('serializes fade-out with time', () => {
    const s = fade(chain(), { type: 'out', start_time: 5, duration: 2 }).toString();
    expect(s).toContain('type=out');
    expect(s).toContain('start_time=5');
    expect(s).toContain('duration=2');
  });
});

describe('zoompan', () => {
  it('serializes zoom expression', () => {
    const s = zoompan(chain(), { zoom: 'min(zoom+0.0015,1.5)', d: 125, fps: 25 }).toString();
    expect(s).toContain('zoom=min(zoom+0.0015,1.5)');
    expect(s).toContain('d=125');
    expect(s).toContain('fps=25');
  });
});

describe('padFilter', () => {
  it('serializes width and height', () => {
    const s = padFilter(chain(), { width: 1920, height: 1080 }).toString();
    expect(s).toContain('pad=1920:1080');
  });

  it('includes x, y, and color', () => {
    const s = padFilter(chain(), { width: 1920, height: 1080, x: '(ow-iw)/2', y: '(oh-ih)/2', color: 'black' }).toString();
    expect(s).toContain('color=black');
    expect(s).toContain('x=(ow-iw)/2');
  });
});

describe('chain chaining', () => {
  it('can chain multiple video filters together', () => {
    const c = chain();
    scale(c, { width: 1280, height: 720 });
    fps(c, { fps: 30 });
    unsharp(c, { lx: 5, ly: 5, la: 1.0 });
    vflip(c);

    const s = c.toString();
    expect(s).toContain('scale=1280:720');
    expect(s).toContain('fps=30');
    expect(s).toContain('unsharp=');
    expect(s).toContain('vflip');
    // comma-separated
    const parts = s.split(',');
    expect(parts).toHaveLength(4);
  });
});

// ─── Coverage gap tests ───────────────────────────────────────────────────────

describe('scale — optional args', () => {
  it('force_divisible_by', () => {
    expect(scale(chain(), { width: 1280, height: 720, force_divisible_by: 2 }).toString())
      .toContain('force_divisible_by=2');
  });
  it('eval', () => {
    expect(scale(chain(), { width: 640, height: 360, eval: 'frame' }).toString())
      .toContain('eval=frame');
  });
  it('force_original_aspect_ratio', () => {
    expect(scale(chain(), { width: 1280, height: 720, force_original_aspect_ratio: 'decrease' }).toString())
      .toContain('force_original_aspect_ratio=decrease');
  });
});

describe('crop — optional args', () => {
  it('x and y offsets', () => {
    expect(crop(chain(), { width: 640, height: 360, x: 100, y: 50 }).toString())
      .toContain('x=100');
  });
  it('keep_aspect', () => {
    expect(crop(chain(), { width: 640, height: 360, keep_aspect: true }).toString())
      .toContain('keep_aspect=1');
  });
  it('exact', () => {
    expect(crop(chain(), { width: 640, height: 360, exact: true }).toString())
      .toContain('exact=1');
  });
});

describe('pad — optional args', () => {
  it('x, y, color, aspect', () => {
    const s = padFilter(chain(), { width: 1920, height: 1080, x: 240, y: 0, color: 'black', aspect: '16/9' }).toString();
    expect(s).toContain('x=240');
    expect(s).toContain('color=black');
    expect(s).toContain('aspect=16/9');
  });
});

describe('overlay — optional args', () => {
  it('eval, shortest, format, alpha', () => {
    const s = overlay(chain(), { x: 10, y: 10, eval: 'init', shortest: true, format: 'yuv420', alpha: 'straight' }).toString();
    expect(s).toContain('eval=init');
    expect(s).toContain('shortest=1');
    expect(s).toContain('format=yuv420');
    expect(s).toContain('alpha=straight');
  });
});

describe('drawtext — optional args', () => {
  it('textfile, fontfile, font', () => {
    const s = drawtext(chain(), { textfile: '/tmp/text.txt', fontfile: '/tmp/font.ttf', font: 'Arial' }).toString();
    expect(s).toContain('textfile=/tmp/text.txt');
    expect(s).toContain('fontfile=/tmp/font.ttf');
    expect(s).toContain('font=Arial');
  });
  it('box, boxcolor, boxborderw, shadowcolor, shadowx, shadowy', () => {
    const s = drawtext(chain(), { text: 'hi', box: true, boxcolor: 'black', boxborderw: 5, shadowcolor: 'gray', shadowx: 2 }).toString();
    expect(s).toContain('box=1');
    expect(s).toContain('boxcolor=black');
    expect(s).toContain('shadowcolor=gray');
  });
});

describe('setsar/setdar — optional max', () => {
  it('setsar with max', () => {
    expect(setsar(chain(), '1/1', 100).toString()).toContain('max=100');
  });
  it('setdar with max', () => {
    expect(setdar(chain(), '16/9', 100).toString()).toContain('max=100');
  });
});

describe('hflip', () => {
  it('produces hflip filter', () => {
    expect(hflip(chain()).toString()).toBe('hflip');
  });
});

// ─── Standalone overloads ─────────────────────────────────────────────────────

describe('scale — standalone', () => {
  it('scale({w, h}) returns string', () => {
    const s = scale({ w: 640, h: 360 });
    expect(typeof s).toBe('string');
    expect(s).toContain('scale=');
  });
  it('scale({width, height}) also works', () => {
    expect(scale({ width: 1280, height: 720 })).toContain('1280');
  });
  it('scale with flags', () => {
    expect(scale({ w: 320, h: 180, flags: 'lanczos' })).toContain('flags=lanczos');
  });
});

describe('crop — standalone', () => {
  it('crop({w, h, x, y}) returns string', () => {
    expect(typeof crop({ w: 320, h: 180, x: 10, y: 10 })).toBe('string');
    expect(crop({ w: 320, h: 180, x: 0, y: 0 })).toContain('crop=');
  });
});

describe('overlay — standalone', () => {
  it('overlay({x, y}) returns string', () => {
    const s = overlay({ x: 10, y: 20 });
    expect(typeof s).toBe('string');
    expect(s).toContain('overlay=');
  });
});

describe('drawtext — standalone', () => {
  it('drawtext({text}) returns string', () => {
    const s = drawtext({ text: 'hello', x: 10, y: 10 });
    expect(typeof s).toBe('string');
    expect(s).toContain('drawtext=');
  });
});

describe('fade — standalone', () => {
  it('fade({type, duration}) returns string', () => {
    const s = fade({ type: 'in', start_time: 0, duration: 1 });
    expect(typeof s).toBe('string');
    expect(s).toContain('type=in');
  });
});
