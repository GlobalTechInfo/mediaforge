import { describe, it } from 'node:test';
import { expect } from '../../lib/expect.js';
import { x264ToArgs, x265ToArgs, svtAv1ToArgs, vp9ToArgs } from '../../../dist/esm/codecs/video.js';
import { aacToArgs, libOpusToArgs, libMp3LameToArgs, flacToArgs, ac3ToArgs } from '../../../dist/esm/codecs/audio.js';
import { nvencToArgs, vaapiToArgs, qsvToArgs } from '../../../dist/esm/codecs/hardware.js';

describe('x264ToArgs', () => {
  it('sets codec to libx264', () => {
    expect(x264ToArgs({})).toContain('libx264');
  });

  it('includes preset', () => {
    const args = x264ToArgs({ preset: 'slow' });
    expect(args).toContain('-preset');
    expect(args).toContain('slow');
  });

  it('includes tune', () => {
    const args = x264ToArgs({ tune: 'film' });
    expect(args).toContain('-tune');
    expect(args).toContain('film');
  });

  it('includes profile', () => {
    const args = x264ToArgs({ profile: 'high' });
    expect(args).toContain('-profile:v');
    expect(args).toContain('high');
  });

  it('includes crf', () => {
    const args = x264ToArgs({ crf: 23 });
    expect(args).toContain('-crf');
    expect(args).toContain('23');
  });

  it('includes bitrate', () => {
    const args = x264ToArgs({ bitrate: 2000 });
    expect(args).toContain('-b:v');
    expect(args).toContain('2000k');
  });

  it('includes maxrate and bufsize', () => {
    const args = x264ToArgs({ maxrate: 4000, bufsize: 8000 });
    expect(args).toContain('-maxrate');
    expect(args).toContain('4000k');
    expect(args).toContain('-bufsize');
    expect(args).toContain('8000k');
  });

  it('includes pixel format', () => {
    const args = x264ToArgs({ pixFmt: 'yuv420p' });
    expect(args).toContain('-pix_fmt');
    expect(args).toContain('yuv420p');
  });

  it('includes x264-params', () => {
    const args = x264ToArgs({ x264Params: 'nal-hrd=cbr:force-cfr=1' });
    expect(args).toContain('-x264-params');
    expect(args).toContain('nal-hrd=cbr:force-cfr=1');
  });

  it('includes keyint', () => {
    const args = x264ToArgs({ keyintMax: 250, keyintMin: 25 });
    expect(args).toContain('-g');
    expect(args).toContain('250');
    expect(args).toContain('-keyint_min');
    expect(args).toContain('25');
  });
});

describe('x265ToArgs', () => {
  it('sets codec to libx265', () => {
    expect(x265ToArgs({})).toContain('libx265');
  });

  it('includes crf', () => {
    const args = x265ToArgs({ crf: 28 });
    expect(args).toContain('-crf');
    expect(args).toContain('28');
  });

  it('includes preset', () => {
    const args = x265ToArgs({ preset: 'medium' });
    expect(args).toContain('-preset');
    expect(args).toContain('medium');
  });

  it('includes x265-params', () => {
    const args = x265ToArgs({ x265Params: 'hdr-opt=1:repeat-headers=1' });
    expect(args).toContain('-x265-params');
  });
});

describe('svtAv1ToArgs', () => {
  it('sets codec to libsvtav1', () => {
    expect(svtAv1ToArgs({})).toContain('libsvtav1');
  });

  it('includes preset', () => {
    const args = svtAv1ToArgs({ preset: 8 });
    expect(args).toContain('-preset');
    expect(args).toContain('8');
  });

  it('includes crf', () => {
    const args = svtAv1ToArgs({ crf: 35 });
    expect(args).toContain('-crf');
  });

  it('includes svtav1-params', () => {
    const args = svtAv1ToArgs({ svtav1Params: 'fast-decode=1' });
    expect(args).toContain('-svtav1-params');
  });
});

describe('vp9ToArgs', () => {
  it('sets codec to libvpx-vp9', () => {
    expect(vp9ToArgs({})).toContain('libvpx-vp9');
  });

  it('includes bitrate', () => {
    const args = vp9ToArgs({ bitrate: 1000 });
    expect(args).toContain('-b:v');
    expect(args).toContain('1000k');
  });

  it('includes crf and quality', () => {
    const args = vp9ToArgs({ crf: 33, quality: 'good' });
    expect(args).toContain('-crf');
    expect(args).toContain('33');
    expect(args).toContain('-quality');
    expect(args).toContain('good');
  });
});

describe('aacToArgs', () => {
  it('sets codec to aac', () => {
    expect(aacToArgs({})).toContain('aac');
  });

  it('includes bitrate', () => {
    const args = aacToArgs({ bitrate: 192 });
    expect(args).toContain('-b:a');
    expect(args).toContain('192k');
  });

  it('includes sample rate', () => {
    const args = aacToArgs({ sampleRate: 48000 });
    expect(args).toContain('-ar');
    expect(args).toContain('48000');
  });

  it('includes channels', () => {
    const args = aacToArgs({ channels: 2 });
    expect(args).toContain('-ac');
    expect(args).toContain('2');
  });

  it('includes vbr', () => {
    const args = aacToArgs({ vbr: 4 });
    expect(args).toContain('-vbr');
    expect(args).toContain('4');
  });
});

describe('libOpusToArgs', () => {
  it('sets codec to libopus', () => {
    expect(libOpusToArgs({})).toContain('libopus');
  });

  it('includes bitrate', () => {
    const args = libOpusToArgs({ bitrate: 128 });
    expect(args).toContain('-b:a');
    expect(args).toContain('128k');
  });

  it('includes vbr mode', () => {
    const args = libOpusToArgs({ vbr: 'constrained' });
    expect(args).toContain('-vbr');
    expect(args).toContain('constrained');
  });

  it('includes application type', () => {
    const args = libOpusToArgs({ application: 'audio' });
    expect(args).toContain('-application');
    expect(args).toContain('audio');
  });
});

describe('libMp3LameToArgs', () => {
  it('sets codec to libmp3lame', () => {
    expect(libMp3LameToArgs({})).toContain('libmp3lame');
  });

  it('includes quality scale', () => {
    const args = libMp3LameToArgs({ qscale: 2 });
    expect(args).toContain('-q:a');
    expect(args).toContain('2');
  });

  it('includes bitrate', () => {
    const args = libMp3LameToArgs({ bitrate: 320 });
    expect(args).toContain('-b:a');
    expect(args).toContain('320k');
  });
});

describe('flacToArgs', () => {
  it('sets codec to flac', () => {
    expect(flacToArgs({})).toContain('flac');
  });

  it('includes compression level', () => {
    const args = flacToArgs({ compressionLevel: 8 });
    expect(args).toContain('-compression_level');
    expect(args).toContain('8');
  });
});

describe('ac3ToArgs', () => {
  it('sets codec to ac3', () => {
    expect(ac3ToArgs({})).toContain('ac3');
  });

  it('includes bitrate', () => {
    const args = ac3ToArgs({ bitrate: 640 });
    expect(args).toContain('-b:a');
    expect(args).toContain('640k');
  });
});

describe('nvencToArgs', () => {
  it('sets codec to h264_nvenc by default', () => {
    const args = nvencToArgs({}, 'h264_nvenc');
    expect(args).toContain('h264_nvenc');
  });

  it('sets codec to hevc_nvenc', () => {
    expect(nvencToArgs({}, 'hevc_nvenc')).toContain('hevc_nvenc');
  });

  it('includes preset', () => {
    const args = nvencToArgs({ preset: 'p5' }, 'h264_nvenc');
    expect(args).toContain('-preset');
    expect(args).toContain('p5');
  });

  it('includes cq (quality)', () => {
    const args = nvencToArgs({ cq: 23 }, 'h264_nvenc');
    expect(args).toContain('-cq');
    expect(args).toContain('23');
  });

  it('includes rc mode', () => {
    const args = nvencToArgs({ rcMode: 'cbr' }, 'h264_nvenc');
    expect(args).toContain('-rc');
    expect(args).toContain('cbr');
  });

  it('includes bitrate', () => {
    const args = nvencToArgs({ bitrate: 4000 }, 'h264_nvenc');
    expect(args).toContain('-b:v');
    expect(args).toContain('4000k');
  });
});

describe('vaapiToArgs', () => {
  it('sets codec to h264_vaapi by default', () => {
    expect(vaapiToArgs({}, 'h264_vaapi')).toContain('h264_vaapi');
  });

  it('includes qp', () => {
    const args = vaapiToArgs({ qp: 25 }, 'h264_vaapi');
    expect(args).toContain('-qp');
    expect(args).toContain('25');
  });

  it('includes bitrate', () => {
    const args = vaapiToArgs({ bitrate: 2000 }, 'h264_vaapi');
    expect(args).toContain('-b:v');
    expect(args).toContain('2000k');
  });
});

describe('qsvToArgs', () => {
  it('sets codec correctly', () => {
    expect(qsvToArgs({}, 'h264_qsv')).toContain('h264_qsv');
  });

  it('includes preset', () => {
    const args = qsvToArgs({ preset: 'slow' }, 'h264_qsv');
    expect(args).toContain('-preset');
    expect(args).toContain('slow');
  });

  it('includes global quality', () => {
    const args = qsvToArgs({ globalQuality: 25 }, 'h264_qsv');
    expect(args).toContain('-global_quality');
    expect(args).toContain('25');
  });
});

// ─── Additional coverage: optional branches ───────────────────────────────────

describe('x264ToArgs — extended options', () => {
  it('includes qp', () => {
    const args = x264ToArgs({ qp: 20 });
    expect(args).toContain('-qp');
    expect(args).toContain('20');
  });

  it('includes bFrames', () => {
    expect(x264ToArgs({ bFrames: 3 })).toContain('-bf');
  });

  it('includes bPyramid none → 0', () => {
    const args = x264ToArgs({ bPyramid: 'none' });
    expect(args).toContain('-b_strategy');
    expect(args).toContain('0');
  });

  it('includes bPyramid normal → 1', () => {
    const args = x264ToArgs({ bPyramid: 'normal' });
    expect(args).toContain('1');
  });

  it('includes aqMode and aqStrength', () => {
    const args = x264ToArgs({ aqMode: 2, aqStrength: 1.5 });
    expect(args).toContain('-aq-mode');
    expect(args).toContain('-aq-strength');
  });

  it('includes weightp, refs, subq', () => {
    const args = x264ToArgs({ weightp: 2, refs: 4, subq: 7 });
    expect(args).toContain('-weightp');
    expect(args).toContain('-refs');
    expect(args).toContain('-subq');
  });

  it('includes me and meRange', () => {
    const args = x264ToArgs({ me: 'umh', meRange: 32 });
    expect(args).toContain('-me_method');
    expect(args).toContain('umh');
    expect(args).toContain('-me_range');
  });

  it('includes trellis and deblock', () => {
    const args = x264ToArgs({ trellis: 2, deblock: '0:0' });
    expect(args).toContain('-trellis');
    expect(args).toContain('-deblock');
  });

  it('includes nalHrd', () => {
    expect(x264ToArgs({ nalHrd: 'cbr' })).toContain('-nal-hrd');
  });

  it('includes qpMin, qpMax, keyintMax, keyintMin', () => {
    const args = x264ToArgs({ qpMin: 10, qpMax: 51, keyintMax: 250, keyintMin: 25 });
    expect(args).toContain('-qmin');
    expect(args).toContain('-qmax');
    expect(args).toContain('-g');
    expect(args).toContain('-keyint_min');
  });

  it('includes scenecutThreshold and x264Params', () => {
    const args = x264ToArgs({ scenecutThreshold: 40, x264Params: 'rc-lookahead=40' });
    expect(args).toContain('-sc_threshold');
    expect(args).toContain('-x264-params');
  });

  it('includes pixFmt', () => {
    expect(x264ToArgs({ pixFmt: 'yuv420p' })).toContain('-pix_fmt');
  });
});

describe('x265ToArgs — extended options', () => {
  it('includes qp', () => {
    expect(x265ToArgs({ qp: 28 })).toContain('-qp');
  });

  it('includes bitrate, maxrate, bufsize', () => {
    const args = x265ToArgs({ bitrate: 2000, maxrate: 4000, bufsize: 8000 });
    expect(args).toContain('-b:v');
    expect(args).toContain('-maxrate');
    expect(args).toContain('-bufsize');
  });

  it('includes keyintMax, bFrames, refs', () => {
    const args = x265ToArgs({ keyintMax: 250, bFrames: 4, refs: 3 });
    expect(args).toContain('-g');
    expect(args).toContain('-bf');
    expect(args).toContain('-refs');
  });

  it('includes dolbyVision', () => {
    expect(x265ToArgs({ dolbyVision: true })).toContain('-dolbyvision');
  });

  it('includes x265Params', () => {
    expect(x265ToArgs({ x265Params: 'psy-rd=1.0' })).toContain('-x265-params');
  });
});

describe('svtAv1ToArgs — extended options', () => {
  it('includes bitrate, bFrames, keyintMax', () => {
    const args = svtAv1ToArgs({ bitrate: 2000, bFrames: 3, keyintMax: 240 });
    expect(args).toContain('-b:v');
    expect(args).toContain('-bf');
    expect(args).toContain('-g');
  });

  it('includes enableSceneDetect and dolbyVision', () => {
    const args = svtAv1ToArgs({ enableSceneDetect: true, dolbyVision: true });
    expect(args).toContain('-svtav1-params');
    expect(args).toContain('-dolbyvision');
  });

  it('includes svtav1Params and pixFmt', () => {
    const args = svtAv1ToArgs({ svtav1Params: 'tune=0', pixFmt: 'yuv420p10le' });
    expect(args).toContain('-svtav1-params');
    expect(args).toContain('-pix_fmt');
  });
});

describe('aacToArgs — extended options', () => {
  it('includes aacCoder', () => {
    expect(aacToArgs({ aacCoder: 'twoloop' })).toContain('-aac_coder');
  });

  it('includes vbr', () => {
    expect(aacToArgs({ vbr: 4 })).toContain('-vbr');
  });

  it('includes sampleRate and channels', () => {
    const args = aacToArgs({ sampleRate: 44100, channels: 2 });
    expect(args).toContain('-ar');
    expect(args).toContain('-ac');
  });

  it('includes channelLayout', () => {
    expect(aacToArgs({ channelLayout: 'stereo' })).toContain('-channel_layout');
  });
});

describe('libOpusToArgs — extended options', () => {
  it('includes vbr and frameDuration', () => {
    const args = libOpusToArgs({ vbr: 'constrained', frameDuration: 20 });
    expect(args).toContain('-vbr');
    expect(args).toContain('-frame_duration');
  });

  it('includes compressionLevel, packetLoss, fec, dtx', () => {
    const args = libOpusToArgs({ compressionLevel: 10, packetLoss: 5, fec: true, dtx: false });
    expect(args).toContain('-compression_level');
    expect(args).toContain('-packet_loss');
    expect(args).toContain('-fec');
    expect(args).toContain('-dtx');
  });

  it('includes channels and sampleRate', () => {
    const args = libOpusToArgs({ channels: 2, sampleRate: 48000 });
    expect(args).toContain('-ac');
    expect(args).toContain('-ar');
  });
});

describe('libMp3LameToArgs — extended options', () => {
  it('includes qscale', () => {
    expect(libMp3LameToArgs({ qscale: 2 })).toContain('-q:a');
  });

  it('includes compressionLevel and jointStereo', () => {
    const args = libMp3LameToArgs({ compressionLevel: 5, jointStereo: true });
    expect(args).toContain('-compression_level');
    expect(args).toContain('-joint_stereo');
  });

  it('includes abr flag', () => {
    expect(libMp3LameToArgs({ abr: true })).toContain('-abr');
  });

  it('includes sampleRate and channels', () => {
    const args = libMp3LameToArgs({ sampleRate: 44100, channels: 2 });
    expect(args).toContain('-ar');
    expect(args).toContain('-ac');
  });
});

describe('nvencToArgs — extended options', () => {
  it('includes tune', () => {
    expect(nvencToArgs({ tune: 'hq' }, 'h264_nvenc')).toContain('-tune');
  });

  it('includes constqp, maxrate, bufsize', () => {
    const args = nvencToArgs({ constqp: 20, maxrate: 6000, bufsize: 12000 }, 'hevc_nvenc');
    expect(args).toContain('-constqp');
    expect(args).toContain('-maxrate');
    expect(args).toContain('-bufsize');
  });

  it('includes qpI, bFrames, refs, gopSize', () => {
    const args = nvencToArgs({ qpI: 20, bFrames: 2, refs: 3, gopSize: 250 }, 'h264_nvenc');
    expect(args).toContain('-qp:v');
    expect(args).toContain('-bf');
    expect(args).toContain('-refs');
    expect(args).toContain('-g');
  });

  it('includes aqStrength, temporalAq, weightedPred', () => {
    const args = nvencToArgs({ aqStrength: 8, temporalAq: true, weightedPred: false }, 'h264_nvenc');
    expect(args).toContain('-aq-strength');
    expect(args).toContain('-temporal-aq');
    expect(args).toContain('-weighted_pred');
  });

  it('includes level, profile, rcLookahead, gpuDevice', () => {
    const args = nvencToArgs({ level: 'auto', profile: 'main', rcLookahead: 32, gpuDevice: 0 }, 'h264_nvenc');
    expect(args).toContain('-level');
    expect(args).toContain('-profile:v');
    expect(args).toContain('-rc-lookahead');
    expect(args).toContain('-gpu');
  });
});

describe('vaapiToArgs — extended options', () => {
  it('includes maxrate, keyintMax, bFrames, refs', () => {
    const args = vaapiToArgs({ maxrate: 4000, keyintMax: 250, bFrames: 2, refs: 3 }, 'h264_vaapi');
    expect(args).toContain('-maxrate');
    expect(args).toContain('-g');
    expect(args).toContain('-bf');
    expect(args).toContain('-refs');
  });

  it('includes profile, level, rcMode', () => {
    const args = vaapiToArgs({ profile: 'main', level: 41, rcMode: 'CBR' }, 'h264_vaapi');
    expect(args).toContain('-profile:v');
    expect(args).toContain('-level');
    expect(args).toContain('-rc_mode');
  });
});


// ─── New Video Codec Helpers ────────────────────────────────────────────────
// Use top-level imports matching the pattern of this file (imported at file top)

import {
  proResToArgs, dnxhdToArgs, mjpegToArgs, mpeg2ToArgs,
  mpeg4ToArgs, vp8ToArgs, theoraToArgs, ffv1ToArgs,
} from '../../../dist/esm/codecs/video.js';
import {
  alacToArgs, eac3ToArgs, truehdToArgs, vorbisToArgs,
  wavpackToArgs, pcmToArgs, mp2ToArgs,
} from '../../../dist/esm/codecs/audio.js';
import { mediacodecVideoToArgs, vulkanVideoToArgs } from '../../../dist/esm/codecs/hardware.js';

describe('proResToArgs', () => {
  it('defaults to prores_ks', () => { expect(proResToArgs()).toContain('prores_ks'); });
  it('sets profile:v', () => {
    const args = proResToArgs({ profile: 3 });
    expect(args).toContain('-profile:v');
    expect(args).toContain('3');
  });
  it('accepts prores_aw encoder', () => { expect(proResToArgs({}, 'prores_aw')).toContain('prores_aw'); });
});

describe('dnxhdToArgs', () => {
  it('emits dnxhd codec', () => { expect(dnxhdToArgs()).toContain('dnxhd'); });
  it('sets bitrate', () => { expect(dnxhdToArgs({ bitrate: 145 })).toContain('145k'); });
  it('sets pixFmt', () => { expect(dnxhdToArgs({ pixFmt: 'yuv422p10le' })).toContain('yuv422p10le'); });
});

describe('mjpegToArgs', () => {
  it('emits mjpeg codec', () => { expect(mjpegToArgs()).toContain('mjpeg'); });
  it('sets qscale', () => {
    const args = mjpegToArgs({ qscale: 3 });
    expect(args).toContain('-q:v');
    expect(args).toContain('3');
  });
});

describe('mpeg2ToArgs', () => {
  it('emits mpeg2video codec', () => { expect(mpeg2ToArgs()).toContain('mpeg2video'); });
  it('sets bitrate', () => { expect(mpeg2ToArgs({ bitrate: 8000 })).toContain('8000k'); });
  it('sets interlaced flags', () => { expect(mpeg2ToArgs({ interlaced: true })).toContain('+ildct+ilme'); });
});

describe('mpeg4ToArgs', () => {
  it('emits mpeg4 codec by default', () => { expect(mpeg4ToArgs()).toContain('mpeg4'); });
  it('accepts libxvid', () => { expect(mpeg4ToArgs({}, 'libxvid')).toContain('libxvid'); });
});

describe('vp8ToArgs', () => {
  it('emits libvpx codec', () => { expect(vp8ToArgs()).toContain('libvpx'); });
  it('sets bitrate', () => { expect(vp8ToArgs({ bitrate: 800 })).toContain('800k'); });
});

describe('theoraToArgs', () => {
  it('emits libtheora codec', () => { expect(theoraToArgs()).toContain('libtheora'); });
  it('sets quality', () => {
    const args = theoraToArgs({ qscale: 7 });
    expect(args).toContain('-q:v');
    expect(args).toContain('7');
  });
});

describe('ffv1ToArgs', () => {
  it('emits ffv1 codec', () => { expect(ffv1ToArgs()).toContain('ffv1'); });
  it('sets sliceCrc', () => { expect(ffv1ToArgs({ sliceCrc: true })).toContain('1'); });
});

describe('alacToArgs', () => {
  it('emits alac codec', () => { expect(alacToArgs()).toContain('alac'); });
});

describe('eac3ToArgs', () => {
  it('emits eac3 codec', () => { expect(eac3ToArgs()).toContain('eac3'); });
  it('sets bitrate', () => { expect(eac3ToArgs({ bitrate: 640 })).toContain('640k'); });
  it('sets dialnorm', () => {
    const args = eac3ToArgs({ dialNorm: -24 });
    expect(args).toContain('-dialnorm');
    expect(args).toContain('-24');
  });
});

describe('truehdToArgs', () => {
  it('emits truehd codec', () => { expect(truehdToArgs()).toContain('truehd'); });
});

describe('vorbisToArgs', () => {
  it('emits libvorbis codec', () => { expect(vorbisToArgs()).toContain('libvorbis'); });
  it('sets quality mode', () => {
    const args = vorbisToArgs({ qscale: 5 });
    expect(args).toContain('-q:a');
    expect(args).toContain('5');
  });
});

describe('wavpackToArgs', () => {
  it('emits wavpack codec', () => { expect(wavpackToArgs()).toContain('wavpack'); });
});

describe('pcmToArgs', () => {
  it('emits pcm_s16le', () => { expect(pcmToArgs('pcm_s16le')).toContain('pcm_s16le'); });
  it('emits pcm_s24le', () => { expect(pcmToArgs('pcm_s24le')).toContain('pcm_s24le'); });
  it('emits pcm_f32le', () => { expect(pcmToArgs('pcm_f32le')).toContain('pcm_f32le'); });
  it('sets sampleRate', () => {
    const args = pcmToArgs('pcm_s16le', { sampleRate: 48000 });
    expect(args).toContain('-ar');
    expect(args).toContain('48000');
  });
  it('sets channels', () => { expect(pcmToArgs('pcm_s24le', { channels: 2 })).toContain('2'); });
});

describe('mp2ToArgs', () => {
  it('emits mp2 codec', () => { expect(mp2ToArgs()).toContain('mp2'); });
  it('sets bitrate', () => { expect(mp2ToArgs({ bitrate: 192 })).toContain('192k'); });
});

describe('mediacodecVideoToArgs', () => {
  it('defaults to h264_mediacodec', () => { expect(mediacodecVideoToArgs({})).toContain('h264_mediacodec'); });
  it('accepts hevc_mediacodec', () => { expect(mediacodecVideoToArgs({}, 'hevc_mediacodec')).toContain('hevc_mediacodec'); });
  it('sets bitrate', () => { expect(mediacodecVideoToArgs({ bitrate: 4000 })).toContain('4000k'); });
  it('accepts av1_mediacodec', () => { expect(mediacodecVideoToArgs({}, 'av1_mediacodec')).toContain('av1_mediacodec'); });
});

describe('vulkanVideoToArgs', () => {
  it('defaults to h264_vulkan', () => { expect(vulkanVideoToArgs({})).toContain('h264_vulkan'); });
  it('accepts hevc_vulkan', () => { expect(vulkanVideoToArgs({}, 'hevc_vulkan')).toContain('hevc_vulkan'); });
  it('sets crf', () => { expect(vulkanVideoToArgs({ crf: 22 })).toContain('22'); });
  it('accepts av1_vulkan', () => { expect(vulkanVideoToArgs({}, 'av1_vulkan')).toContain('av1_vulkan'); });
});
