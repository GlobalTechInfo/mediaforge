import { describe, it } from 'node:test';
import { expect } from '../../lib/expect.ts';
import { FilterChain } from '../../../lib/types/filters.ts';
import {
  volume, loudnorm, equalizer, bass, treble,
  afade, asetpts, atrim, amerge, amix, pan,
  channelmap, channelsplit, aresample, dynaudnorm,
  compand, aecho, highpass, lowpass, asplit,
  silencedetect, rubberband, atempo, agate,
} from '../../../lib/filters/audio/index.ts';

function chain(): FilterChain {
  return new FilterChain();
}

describe('volume', () => {
  it('accepts a number directly', () => {
    expect(volume(chain(), 1.5).toString()).toBe('volume=1.5');
  });

  it('accepts a string directly', () => {
    expect(volume(chain(), '6dB').toString()).toBe('volume=6dB');
  });

  it('accepts options object', () => {
    const s = volume(chain(), { volume: 2.0, eval: 'frame' }).toString();
    expect(s).toContain('volume=2');
    expect(s).toContain('eval=frame');
  });
});

describe('loudnorm', () => {
  it('serializes EBU R128 targets', () => {
    const s = loudnorm(chain(), { i: -23, lra: 7, tp: -2 }).toString();
    expect(s).toContain('i=-23');
    expect(s).toContain('lra=7');
    expect(s).toContain('tp=-2');
  });

  it('includes two-pass parameters', () => {
    const s = loudnorm(chain(), {
      i: -23, lra: 7, tp: -2,
      measured_i: -24.5, measured_tp: -1.3, measured_lra: 8.0,
      linear: true, print_format: 'json',
    }).toString();
    expect(s).toContain('measured_i=-24.5');
    expect(s).toContain('linear=true');
    expect(s).toContain('print_format=json');
  });

  it('handles dual_mono', () => {
    const s = loudnorm(chain(), { dual_mono: true }).toString();
    expect(s).toContain('dual_mono=true');
  });
});

describe('equalizer', () => {
  it('serializes frequency, width, and gain', () => {
    const s = equalizer(chain(), { frequency: 1000, width: 1.0, gain: 6 }).toString();
    expect(s).toContain('f=1000');
    expect(s).toContain('width=1');
    expect(s).toContain('g=6');
  });

  it('includes width_type', () => {
    const s = equalizer(chain(), { frequency: 200, width: 0.7, gain: -3, width_type: 'q' }).toString();
    expect(s).toContain('width_type=q');
  });
});

describe('bass / treble', () => {
  it('bass serializes gain', () => {
    const s = bass(chain(), { gain: 6, frequency: 100 }).toString();
    expect(s).toContain('g=6');
    expect(s).toContain('f=100');
  });

  it('treble serializes gain', () => {
    const s = treble(chain(), { gain: 3 }).toString();
    expect(s).toContain('treble=');
    expect(s).toContain('g=3');
  });
});

describe('afade', () => {
  it('serializes fade-in with start_time and duration', () => {
    const s = afade(chain(), { type: 'in', start_time: 0, duration: 2 }).toString();
    expect(s).toContain('type=in');
    expect(s).toContain('start_time=0');
    expect(s).toContain('duration=2');
  });

  it('serializes fade-out', () => {
    const s = afade(chain(), { type: 'out', start_time: 58, duration: 2 }).toString();
    expect(s).toContain('type=out');
  });

  it('supports curve type', () => {
    const s = afade(chain(), { type: 'in', duration: 3, curve: 'qsin' }).toString();
    expect(s).toContain('curve=qsin');
  });
});

describe('asetpts', () => {
  it('serializes expression', () => {
    expect(asetpts(chain(), 'PTS-STARTPTS').toString()).toBe('asetpts=PTS-STARTPTS');
  });
});

describe('atrim', () => {
  it('serializes start and end', () => {
    const s = atrim(chain(), { start: 10, end: 30 }).toString();
    expect(s).toContain('start=10');
    expect(s).toContain('end=30');
  });
});

describe('amerge', () => {
  it('serializes input count', () => {
    expect(amerge(chain(), 2).toString()).toContain('inputs=2');
  });
});

describe('amix', () => {
  it('serializes inputs and duration mode', () => {
    const s = amix(chain(), { inputs: 3, duration: 'shortest' }).toString();
    expect(s).toContain('inputs=3');
    expect(s).toContain('duration=shortest');
  });

  it('supports normalize', () => {
    const s = amix(chain(), { inputs: 2, normalize: true }).toString();
    expect(s).toContain('normalize=1');
  });
});

describe('pan', () => {
  it('serializes layout expression', () => {
    expect(pan(chain(), 'stereo|c0=FL|c1=FR').toString()).toBe('pan=stereo|c0=FL|c1=FR');
  });

  it('supports downmix expression', () => {
    const s = pan(chain(), 'stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1').toString();
    expect(s).toContain('pan=stereo');
  });
});

describe('channelmap', () => {
  it('serializes map string', () => {
    const s = channelmap(chain(), 'FL-FL|FR-FR', 'stereo').toString();
    expect(s).toContain('map=FL-FL|FR-FR');
    expect(s).toContain('channel_layout=stereo');
  });
});

describe('channelsplit', () => {
  it('serializes with channel layout', () => {
    const s = channelsplit(chain(), 'stereo').toString();
    expect(s).toContain('channelsplit=');
    expect(s).toContain('channel_layout=stereo');
  });
});

describe('aresample', () => {
  it('accepts a number directly', () => {
    expect(aresample(chain(), 44100).toString()).toBe('aresample=44100');
  });

  it('accepts options object', () => {
    const s = aresample(chain(), { sampleRate: 48000, resampler: 'soxr' }).toString();
    expect(s).toContain('sample_rate=48000');
    expect(s).toContain('resampler=soxr');
  });
});

describe('dynaudnorm', () => {
  it('serializes frame length and peak', () => {
    const s = dynaudnorm(chain(), { framelen: 500, peak: 0.95 }).toString();
    expect(s).toContain('f=500');
    expect(s).toContain('p=0.95');
  });

  it('serializes compression factor', () => {
    const s = dynaudnorm(chain(), { compress: 10.0 }).toString();
    expect(s).toContain('s=10');
  });
});

describe('compand', () => {
  it('serializes attacks and decays', () => {
    const s = compand(chain(), { attacks: '0', decays: '0.3', points: '-90/-900:-70/-70:-30/-9:0/-3:20/-3' }).toString();
    expect(s).toContain('attacks=0');
    expect(s).toContain('decays=0.3');
    expect(s).toContain('points=');
  });
});

describe('aecho', () => {
  it('serializes echo parameters', () => {
    const s = aecho(chain(), { in_gain: 0.6, out_gain: 0.3, delays: '1000', decays: '0.5' }).toString();
    expect(s).toContain('in_gain=0.6');
    expect(s).toContain('out_gain=0.3');
    expect(s).toContain('delays=1000');
    expect(s).toContain('decays=0.5');
  });
});

describe('highpass / lowpass', () => {
  it('highpass accepts a number directly', () => {
    const s = highpass(chain(), 80).toString();
    expect(s).toContain('highpass=');
    expect(s).toContain('f=80');
  });

  it('highpass accepts options object', () => {
    const s = highpass(chain(), { frequency: 100, width: 0.7, width_type: 'q' }).toString();
    expect(s).toContain('f=100');
    expect(s).toContain('t=q');
  });

  it('lowpass accepts a number directly', () => {
    const s = lowpass(chain(), 16000).toString();
    expect(s).toContain('lowpass=');
    expect(s).toContain('f=16000');
  });
});

describe('asplit', () => {
  it('serializes split count', () => {
    expect(asplit(chain(), 3).toString()).toBe('asplit=3');
  });

  it('defaults to 2', () => {
    expect(asplit(chain()).toString()).toBe('asplit=2');
  });
});

describe('silencedetect', () => {
  it('serializes noise and duration', () => {
    const s = silencedetect(chain(), { noise: '-60dB', duration: 2 }).toString();
    expect(s).toContain('noise=-60dB');
    expect(s).toContain('duration=2');
  });
});

describe('rubberband', () => {
  it('serializes tempo and pitch', () => {
    const s = rubberband(chain(), { tempo: 1.25, pitch: 0.9 }).toString();
    expect(s).toContain('tempo=1.25');
    expect(s).toContain('pitch=0.9');
  });

  it('supports formant preservation', () => {
    const s = rubberband(chain(), { tempo: 1.5, formant: 'preserved' }).toString();
    expect(s).toContain('formant=preserved');
  });

  it('supports engine selection', () => {
    const s = rubberband(chain(), { engine: 'finer' }).toString();
    expect(s).toContain('engine=finer');
  });
});

describe('atempo', () => {
  it('serializes speed factor', () => {
    expect(atempo(chain(), 1.5).toString()).toBe('atempo=1.5');
    expect(atempo(chain(), 0.75).toString()).toBe('atempo=0.75');
  });
});

describe('agate', () => {
  it('serializes threshold', () => {
    const s = agate(chain(), { threshold: -30, attack: 10, release: 100 }).toString();
    expect(s).toContain('threshold=-30');
    expect(s).toContain('attack=10');
    expect(s).toContain('release=100');
  });
});

describe('audio chain chaining', () => {
  it('chains multiple audio filters', () => {
    const c = chain();
    loudnorm(c, { i: -23, lra: 7, tp: -2 });
    highpass(c, 80);
    lowpass(c, 16000);
    volume(c, 1.2);

    const s = c.toString();
    expect(s).toContain('loudnorm=');
    expect(s).toContain('highpass=');
    expect(s).toContain('lowpass=');
    expect(s).toContain('volume=1.2');
    const parts = s.split(',');
    expect(parts).toHaveLength(4);
  });
});

// ─── Coverage gap tests ───────────────────────────────────────────────────────

describe('loudnorm — optional args', () => {
  it('dual_mono', () => {
    const s = loudnorm(chain(), { dual_mono: true }).toString();
    expect(s).toContain('dual_mono=true');
  });
  it('measured params', () => {
    const s = loudnorm(chain(), { measured_i: -23, measured_lra: 7, measured_tp: -2, measured_thresh: -33 }).toString();
    expect(s).toContain('measured_i=-23');
    expect(s).toContain('measured_lra=7');
  });
  it('offset, linear, print_format', () => {
    const s = loudnorm(chain(), { offset: 0, linear: true, print_format: 'json' }).toString();
    expect(s).toContain('linear=true');
    expect(s).toContain('print_format=json');
  });
});

describe('equalizer — optional args', () => {
  it('channels, poles, mix', () => {
    const s = equalizer(chain(), { frequency: 1000, width_type: 'o', width: 2, gain: 3, channels: 'FL+FR', poles: 2, mix: 1 }).toString();
    expect(s).toContain('c=FL+FR');
    expect(s).toContain('p=2');
    expect(s).toContain('mix=1');
  });
});

describe('asetpts', () => {
  it('produces asetpts filter', () => {
    expect(asetpts(chain(), 'PTS-STARTPTS').toString()).toContain('asetpts=PTS-STARTPTS');
  });
});

describe('atrim — end_pts', () => {
  it('includes end_pts', () => {
    const s = atrim(chain(), { end_pts: 90000 }).toString();
    expect(s).toContain('end_pts=90000');
  });
});
