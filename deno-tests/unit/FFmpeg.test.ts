import { describe, it } from 'node:test';
import { expect } from '../lib/expect.ts';
import { FFmpegBuilder, VersionError, ffmpeg } from '../../lib/FFmpeg.ts';

describe('ffmpeg() factory', () => {
  it('returns an FFmpegBuilder', () => {
    expect(ffmpeg()).toBeInstanceOf(FFmpegBuilder);
  });

  it('accepts a single input string', () => {
    const args = ffmpeg('input.mp4').output('out.mp4').buildArgs();
    expect(args).toContain('-i');
    expect(args).toContain('input.mp4');
  });

  it('accepts multiple input strings', () => {
    const args = ffmpeg(['a.mp4', 'b.mp4']).output('out.mp4').buildArgs();
    const iIndices = args.reduce<number[]>((acc: number[], a: string, i: number) => (a === '-i' ? [...acc, i] : acc), []);
    expect(iIndices).toHaveLength(2);
  });
});

describe('FFmpegBuilder.buildArgs()', () => {
  it('includes -y by default (overwrite=true)', () => {
    expect(new FFmpegBuilder().output('out.mp4').buildArgs()).toContain('-y');
  });

  it('overwrite(false) adds -n instead', () => {
    const args = new FFmpegBuilder().overwrite(false).output('out.mp4').buildArgs();
    expect(args).toContain('-n');
    expect(args).not.toContain('-y');
  });

  it('logLevel adds -loglevel', () => {
    const args = ffmpeg('i.mp4').logLevel('quiet').output('o.mp4').buildArgs();
    expect(args).toContain('-loglevel');
    expect(args).toContain('quiet');
  });

  it('enableProgress adds -progress pipe:2', () => {
    const args = ffmpeg('i.mp4').enableProgress().output('o.mp4').buildArgs();
    expect(args).toContain('-progress');
    expect(args).toContain('pipe:2');
  });

  it('videoCodec adds -c:v', () => {
    const args = ffmpeg('i.mp4').output('o.mp4').videoCodec('libx264').buildArgs();
    expect(args).toContain('-c:v');
    expect(args).toContain('libx264');
  });

  it('videoBitrate adds -b:v', () => {
    const args = ffmpeg('i.mp4').output('o.mp4').videoBitrate('2M').buildArgs();
    expect(args).toContain('-b:v');
    expect(args).toContain('2M');
  });

  it('fps adds -r', () => {
    expect(ffmpeg('i.mp4').output('o.mp4').fps(30).buildArgs()).toContain('-r');
  });

  it('size adds -s', () => {
    expect(ffmpeg('i.mp4').output('o.mp4').size('1280x720').buildArgs()).toContain('-s');
  });

  it('crf adds -crf', () => {
    expect(ffmpeg('i.mp4').output('o.mp4').crf(23).buildArgs()).toContain('-crf');
  });

  it('pixelFormat adds -pix_fmt', () => {
    expect(ffmpeg('i.mp4').output('o.mp4').pixelFormat('yuv420p').buildArgs()).toContain('-pix_fmt');
  });

  it('noVideo adds -vn', () => {
    expect(ffmpeg('i.mp4').output('o.mp4').noVideo().buildArgs()).toContain('-vn');
  });

  it('audioCodec adds -c:a', () => {
    expect(ffmpeg('i.mp4').output('o.mp4').audioCodec('aac').buildArgs()).toContain('-c:a');
  });

  it('audioBitrate adds -b:a', () => {
    expect(ffmpeg('i.mp4').output('o.mp4').audioBitrate('128k').buildArgs()).toContain('-b:a');
  });

  it('audioSampleRate adds -ar', () => {
    expect(ffmpeg('i.mp4').output('o.mp4').audioSampleRate(44100).buildArgs()).toContain('-ar');
  });

  it('audioChannels adds -ac', () => {
    expect(ffmpeg('i.mp4').output('o.mp4').audioChannels(2).buildArgs()).toContain('-ac');
  });

  it('noAudio adds -an', () => {
    expect(ffmpeg('i.mp4').output('o.mp4').noAudio().buildArgs()).toContain('-an');
  });

  it('subtitleCodec adds -c:s', () => {
    expect(ffmpeg('i.mp4').output('o.mp4').subtitleCodec('srt').buildArgs()).toContain('-c:s');
  });

  it('noSubtitle adds -sn', () => {
    expect(ffmpeg('i.mp4').output('o.mp4').noSubtitle().buildArgs()).toContain('-sn');
  });

  it('outputFormat adds -f', () => {
    expect(ffmpeg('i.mp4').output('o.mp4').outputFormat('matroska').buildArgs()).toContain('-f');
  });

  it('map adds -map', () => {
    const args = ffmpeg('i.mp4').output('o.mp4').map('0:v:0').map('0:a:1').buildArgs();
    const mapCount = args.filter((a: string) => a === '-map').length;
    expect(mapCount).toBe(2);
  });

  it('duration adds -t', () => {
    expect(ffmpeg('i.mp4').output('o.mp4').duration(30).buildArgs()).toContain('-t');
  });

  it('seekOutput adds -ss in output section', () => {
    expect(ffmpeg('i.mp4').output('o.mp4').seekOutput('00:01:00').buildArgs()).toContain('-ss');
  });

  it('videoFilter adds -vf', () => {
    expect(ffmpeg('i.mp4').output('o.mp4').videoFilter('scale=1280:720').buildArgs()).toContain('-vf');
  });

  it('audioFilter adds -af', () => {
    expect(ffmpeg('i.mp4').output('o.mp4').audioFilter('volume=1.5').buildArgs()).toContain('-af');
  });

  it('addOutputOption appends arbitrary args', () => {
    const args = ffmpeg('i.mp4').output('o.mp4').addOutputOption('-movflags', '+faststart').buildArgs();
    expect(args).toContain('-movflags');
  });

  it('addGlobalOption appends arbitrary global args', () => {
    const args = ffmpeg('i.mp4').addGlobalOption('-threads', '4').output('o.mp4').buildArgs();
    expect(args).toContain('-threads');
  });

  it('hwAccel adds -hwaccel', () => {
    const args = ffmpeg('i.mp4').hwAccel('cuda').output('o.mp4').buildArgs();
    expect(args).toContain('-hwaccel');
    expect(args).toContain('cuda');
  });

  it('hwAccel with device adds -hwaccel_device', () => {
    const args = ffmpeg('i.mp4').hwAccel('vaapi', { device: '/dev/dri/renderD128' }).output('o.mp4').buildArgs();
    expect(args).toContain('-hwaccel_device');
  });

  it('complexFilter adds -filter_complex', () => {
    const args = ffmpeg('i.mp4').complexFilter('[0:v]scale=640:360[v]').output('o.mp4').buildArgs();
    expect(args).toContain('-filter_complex');
  });

  it('seekInput adds -ss before -i', () => {
    const args = ffmpeg('i.mp4').seekInput('00:01:00').output('o.mp4').buildArgs();
    const ssIdx = args.indexOf('-ss');
    const iIdx = args.indexOf('-i');
    expect(ssIdx).toBeGreaterThanOrEqual(0);
    expect(ssIdx).toBeLessThan(iIdx);
  });

  it('inputDuration adds -t before -i', () => {
    const args = ffmpeg('i.mp4').inputDuration(30).output('o.mp4').buildArgs();
    const tIdx = args.indexOf('-t');
    const iIdx = args.indexOf('-i');
    expect(tIdx).toBeLessThan(iIdx);
  });

  it('inputFormat adds -f before -i', () => {
    const args = ffmpeg().input('i.yuv').inputFormat('rawvideo').output('o.mp4').buildArgs();
    expect(args).toContain('-f');
  });

  it('output path appears at the end of args', () => {
    const args = ffmpeg('i.mp4').output('final.mp4').buildArgs();
    expect(args[args.length - 1]).toBe('final.mp4');
  });

  it('throws when codec called before output', () => {
    expect(() => new FFmpegBuilder().videoCodec('libx264')).toThrow();
  });
});

describe('VersionError', () => {
  it('has correct name and descriptive message', () => {
    const err = new VersionError('MediaCodec', 8, 7);
    expect(err.name).toBe('VersionError');
    expect(err.message).toContain('MediaCodec');
    expect(err.message).toContain('v8');
    expect(err.message).toContain('v7');
  });
});

describe('FFmpegBuilder.setBinary()', () => {
  it('changes the binary path', () => {
    const b = ffmpeg();
    b.setBinary('/custom/ffmpeg');
    // Can't run it, but the internal state should be set
    // We verify by checking it doesn't throw
    expect(() => b.setBinary('/another/path')).not.toThrow();
  });
});

describe('FFmpegBuilder.seekInput / inputDuration / inputFormat (input mutations)', () => {
  it('seekInput sets seek on last added input', () => {
    const args = ffmpeg('input.mp4').seekInput('00:00:10').output('out.mp4').buildArgs();
    const ssIdx = args.indexOf('-ss');
    expect(ssIdx).toBeGreaterThan(-1);
    expect(args[ssIdx + 1]).toBe('00:00:10');
  });

  it('seekInput with numeric seconds', () => {
    const args = ffmpeg('input.mp4').seekInput(30).output('out.mp4').buildArgs();
    expect(args).toContain('30');
  });

  it('inputDuration sets -t on last added input', () => {
    const args = ffmpeg('input.mp4').inputDuration(60).output('out.mp4').buildArgs();
    const tIdx = args.indexOf('-t');
    expect(tIdx).toBeGreaterThan(-1);
    expect(args[tIdx + 1]).toBe('60');
  });

  it('inputFormat sets -f on last added input', () => {
    const args = ffmpeg('input.mp4').inputFormat('rawvideo').output('out.mp4').buildArgs();
    expect(args).toContain('-f');
    expect(args).toContain('rawvideo');
  });

  it('seekInput on empty input list is a no-op', () => {
    const args = new FFmpegBuilder().seekInput('10').output('out.mp4').buildArgs();
    expect(args).not.toContain('-ss');
  });

  it('inputDuration on empty input list is a no-op', () => {
    const args = new FFmpegBuilder().inputDuration(10).output('out.mp4').buildArgs();
    expect(args).not.toContain('-t');
  });
});

describe('VersionError', () => {
  it('has correct name', () => {
    const e = new VersionError('NVENC', 7, 6);
    expect(e.name).toBe('VersionError');
  });

  it('is an instance of Error', () => {
    expect(new VersionError('X', 8, 7)).toBeInstanceOf(Error);
  });

  it('message mentions the feature and required version', () => {
    const e = new VersionError('MediaCodec', 8, 7);
    expect(e.message).toContain('MediaCodec');
    expect(e.message).toContain('8');
  });

  it('message mentions the current version', () => {
    const e = new VersionError('Vulkan', 8, 6);
    expect(e.message).toContain('6');
  });
});
