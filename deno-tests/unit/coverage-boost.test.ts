import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ProbeResult } from '../../lib/types/probe.ts';

const { probe, probeAsync, ProbeError, formatDuration, parseDuration, parseBitrate, parseFrameRate, getVideoStreams, getAudioStreams, getSubtitleStreams, durationToMicroseconds, summarizeAudioStream } = await import('../../lib/probe/ffprobe.ts');
const { x264ToArgs, x265ToArgs, svtav1ToArgs, vp9ToArgs } = await import('../../lib/codecs/video.ts');
const { aacToArgs, opusToArgs, mp3ToArgs, flacToArgs, ac3ToArgs } = await import('../../lib/codecs/audio.ts');
const _ac3ToArgs = ac3ToArgs;
const { nvencToArgs, vaapiToArgs, mediacodecToArgs, vulkanToArgs, qsvToArgs } = await import('../../lib/codecs/hardware.ts');

const { CapabilityRegistry, getDefaultRegistry } = await import('../../lib/codecs/registry.ts');
const { spawnFFmpeg, runFFmpeg, FFmpegSpawnError } = await import('../../lib/process/spawn.ts');
const { parseVersionOutput, satisfiesVersion, formatVersion, probeVersion } = await import('../../lib/utils/version.ts');
const { buildOutputArgs, buildInputArgs, buildGlobalArgs, toDuration } = await import('../../lib/utils/args.ts');
const { resolveBinary, resolveProbe, isBinaryAvailable, validateBinary, BinaryNotFoundError, BinaryNotExecutableError } = await import('../../lib/utils/binary.ts');

// ─── CapabilityRegistry unit coverage ────────────────────────────────────────
describe('CapabilityRegistry', () => {

  it('instantiates with binary string', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.notStrictEqual(r, null);
  });

  it('hasCodec returns boolean', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.strictEqual(typeof r.hasCodec('libx264'), 'boolean');
  });

  it('canEncode returns boolean', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.strictEqual(typeof r.canEncode('libx264'), 'boolean');
  });

  it('canDecode returns boolean', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.strictEqual(typeof r.canDecode('h264'), 'boolean');
  });

  it('hasFilter returns boolean', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.strictEqual(typeof r.hasFilter('scale'), 'boolean');
  });

  it('hasFormat returns boolean', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.strictEqual(typeof r.hasFormat('mp4'), 'boolean');
  });

  it('hasHwaccel returns boolean', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.strictEqual(typeof r.hasHwaccel('cuda'), 'boolean');
  });

  it('codecs map holds every codec ffmpeg reports', () => {
    // `ffmpeg -codecs` is the source, so the parsed map must be large and must
    // contain the handful of codecs every build ships.
    const r = new CapabilityRegistry('ffmpeg');
    assert.ok(r.codecs.size > 100, `only ${r.codecs.size} codecs parsed from ffmpeg -codecs`);
    // `h265` is an alias, not a row: `ffmpeg -codecs` lists it as `hevc`.
    for (const name of ['h264', 'hevc', 'aac', 'mp3', 'flac', 'png', 'mjpeg']) {
      assert.ok(r.codecs.has(name), `ffmpeg -codecs did not report ${name}`);
    }
    assert.ok(!r.codecs.has('h265'), 'h265 is an alias, not a listed codec');
    // The flag columns have to land in the right field, or a decoder-only
    // codec would look like an encoder.
    assert.strictEqual(r.codecs.get('h264')?.flags.decode, true);
    assert.strictEqual(r.codecs.get('png')?.flags.type, 'video');
    assert.strictEqual(r.codecs.get('aac')?.flags.type, 'audio');
    assert.strictEqual(r.codecs.get('h264')?.flags.lossy, true);
    assert.strictEqual(r.codecs.get('flac')?.flags.lossless, true);
  });

  it('filters map holds every filter ffmpeg reports', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.ok(r.filters.size > 100, `only ${r.filters.size} filters parsed from ffmpeg -filters`);
    for (const name of ['scale', 'crop', 'overlay', 'drawtext', 'fps', 'volume', 'amix']) {
      assert.ok(r.filters.has(name), `ffmpeg -filters did not report ${name}`);
    }
  });

  it('formats map holds both the muxer and the demuxer for mp4', () => {
    // A demux-only or mux-only row used to be dropped by the flag parser, so
    // `hasFormat('mp4')` answered false for a format ffmpeg can plainly read.
    const r = new CapabilityRegistry('ffmpeg');
    assert.ok(r.formats.size > 10, `only ${r.formats.size} formats parsed`);
    assert.strictEqual(r.hasFormat('mp4'), true, 'mp4 must be reported as a demuxer');
    assert.strictEqual(r.hasFormat('matroska'), true);
    assert.strictEqual(r.hasFormat('not_a_real_format_xyz'), false);
  });

  it('hwaccels set is a Set of the names ffmpeg lists', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.ok(r.hwaccels instanceof Set);
    for (const accel of r.hwaccels) assert.strictEqual(typeof accel, 'string');
    // A clean ffmpeg -hwaccels lists no device, but never a placeholder.
    assert.ok(!r.hwaccels.has(''), 'the accelerator list has an empty entry');
  });

  it('encoders set is populated with real encoder names', () => {
    // `encoders` is the full `ffmpeg -encoders` list, not just the subset
    // `ffmpeg -codecs` names in a parenthesised list.
    const r = new CapabilityRegistry('ffmpeg');
    assert.ok(r.encoders.size > 100, `only ${r.encoders.size} encoders parsed`);
    for (const name of ['libx264', 'aac', 'libmp3lame', 'flac', 'mjpeg', 'libopus']) {
      assert.ok(r.encoders.has(name), `${name} missing from the encoder list`);
      assert.ok(r.hasCodec(name), `hasCodec(${name}) should be true`);
    }
    assert.ok(!r.encoders.has(''), 'the encoder list has an empty entry');
  });

  it('invalidate clears cache', () => {
    const r = new CapabilityRegistry('ffmpeg');
    r.hasCodec('libx264'); // populate cache
    r.invalidate();
    // after invalidate, re-probing should still work
    assert.strictEqual(typeof r.hasCodec('libx264'), 'boolean');
  });

  it('returns empty maps for invalid binary', () => {
    const r = new CapabilityRegistry('not_a_real_binary_xyz');
    assert.strictEqual(r.codecs.size, 0);
    assert.strictEqual(r.filters.size, 0);
    assert.strictEqual(r.formats.size, 0);
    assert.ok(r.hwaccels instanceof Set, `assertion failed: ${r.hwaccels instanceof Set}`);
  });

  it('getDefaultRegistry returns singleton', () => {
    const r1 = getDefaultRegistry();
    const r2 = getDefaultRegistry();
    assert.strictEqual(r1, r2);
  });

  it('libx264 canEncode is boolean', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.strictEqual(typeof r.canEncode('libx264'), 'boolean');
  });

  it('scale filter hasFilter returns boolean', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.strictEqual(typeof r.hasFilter('scale'), 'boolean');
  });
});

// ─── spawn.ts coverage ────────────────────────────────────────────────────────
describe('spawnFFmpeg / runFFmpeg coverage', () => {

  it('FFmpegSpawnError with null signal uses "unknown"', () => {
    const e = new FFmpegSpawnError(null, null, 'err');
    assert.ok(e.message.includes('unknown'), `expected ${e.message} to include ${'unknown'}; got ${e.message}`);
  });

  it('FFmpegSpawnError with signal string shows signal', () => {
    const e = new FFmpegSpawnError(null, 'SIGTERM', 'err');
    assert.ok(e.message.includes('SIGTERM'), `expected ${e.message} to include ${'SIGTERM'}; got ${e.message}`);
  });

  it('FFmpegSpawnError truncates long stderr to 2000 chars', () => {
    const longErr = 'x'.repeat(5000);
    const e = new FFmpegSpawnError(1, null, longErr);
    assert.ok(e.message.length < 3000, `expected ${e.message.length} to be less than ${3000}; got ${e.message.length}`);
  });

  it('spawnFFmpeg with cwd option does not throw', () => {
    const proc = spawnFFmpeg({ binary: 'ffmpeg', args: ['-version'], cwd: '/tmp' });
    assert.notStrictEqual(proc.emitter, undefined);
    return new Promise<void>((res) => {
      proc.emitter.on('end', res);
      proc.emitter.on('error', () => res());
    });
  });

  it('spawnFFmpeg with parseProgress=true does not throw', () => {
    const proc = spawnFFmpeg({ binary: 'ffmpeg', args: ['-version'], parseProgress: true });
    return new Promise<void>((res) => {
      proc.emitter.on('end', res);
      proc.emitter.on('error', () => res());
    });
  });

  it('spawnFFmpeg with totalDurationUs option works', () => {
    const proc = spawnFFmpeg({ binary: 'ffmpeg', args: ['-version'], totalDurationUs: 1000000 });
    return new Promise<void>((res) => {
      proc.emitter.on('end', res);
      proc.emitter.on('error', () => res());
    });
  });

  it('spawnFFmpeg emits start event with args', () => {
    return new Promise<void>((res) => {
      const args = ['-version'];
      const proc = spawnFFmpeg({ binary: 'ffmpeg', args });
      proc.emitter.on('start', (a: string[]) => {
        assert.deepStrictEqual(a, args);
      });
      proc.emitter.on('end', res);
      proc.emitter.on('error', () => res());
    });
  });

  it('spawnFFmpeg stderr event fires on error', async () => {
    // stderr captured when ffmpeg fails - guaranteed stderr output
    const lines: string[] = [];
    await new Promise<void>((res) => {
      const proc = spawnFFmpeg({ binary: 'ffmpeg', args: ['-i', 'no_file_xyz.mp4', '-f', 'null', '-'] });
      proc.emitter.on('stderr', (l: string) => lines.push(l));
      proc.emitter.on('end', res);
      proc.emitter.on('error', () => res());
    });
    assert.ok(lines.length > 0, `expected ${lines.length} to be greater than ${0}; got ${lines.length}`);
  });

  it('spawnFFmpeg child process has pid', () => {
    const proc = spawnFFmpeg({ binary: 'ffmpeg', args: ['-version'] });
    assert.strictEqual(typeof proc.child.pid, 'number');
    return new Promise<void>((res) => {
      proc.emitter.on('end', res);
      proc.emitter.on('error', () => res());
    });
  });

  it('runFFmpeg resolves on success', async () => {
    await assert.doesNotReject(runFFmpeg({ binary: 'ffmpeg', args: ['-version'] }));
  });

  it('runFFmpeg rejects with FFmpegSpawnError on failure', async () => {
    await assert.rejects(
      runFFmpeg({ binary: 'ffmpeg', args: ['-i', 'nonexistent_xyz.mp4', '-f', 'null', '-'] }),
      (e: any) => e instanceof FFmpegSpawnError,
    );
  });
});

// ─── version.ts coverage ─────────────────────────────────────────────────────
describe('version utils coverage', () => {

  it('parseVersionOutput with patch version', () => {
    const v = parseVersionOutput('ffmpeg version 7.1.2-static');
    assert.strictEqual(v.major, 7);
    assert.strictEqual(v.minor, 1);
    assert.strictEqual(v.patch, 2);
  });

  it('parseVersionOutput N-git format sets isGit=true', () => {
    const v = parseVersionOutput('ffmpeg version N-115469-gabcdef1234');
    assert.strictEqual(v.isGit, true);
  });

  it('parseVersionOutput extracts configuration flags', () => {
    const output = 'ffmpeg version 7.0.1\nconfiguration: --enable-libx264 --enable-libopus\n';
    const v = parseVersionOutput(output);
    assert.ok(v.configuration.includes('--enable-libx264'), `expected ${v.configuration} to include ${'--enable-libx264'}; got ${v.configuration}`);
  });

  it('satisfiesVersion with exact match', () => {
    const v = { major: 7, minor: 0, patch: 0, raw: '7.0.0', isGit: false, libraries: {}, configuration: [] };
    assert.ok(satisfiesVersion(v, 7), `assertion failed: ${satisfiesVersion(v, 7)}`);
  });

  it('satisfiesVersion below required returns false', () => {
    const v = { major: 6, minor: 1, patch: 0, raw: '6.1.0', isGit: false, libraries: {}, configuration: [] };
    assert.ok(!satisfiesVersion(v, 7), `assertion failed: ${!satisfiesVersion(v, 7)}`);
  });

  it('formatVersion includes major.minor.patch', () => {
    const v = { major: 7, minor: 1, patch: 2, raw: '7.1.2', isGit: false, libraries: {}, configuration: [] };
    const s = formatVersion(v);
    assert.ok(s.includes('7'), `expected ${s} to include ${'7'}; got ${s}`);
  });

  it('probeVersion returns valid version from installed ffmpeg', () => {
    const v = probeVersion('ffmpeg');
    assert.ok(v.major >= 4, `expected ${v.major} to be at least ${4}; got ${v.major}`);
  });

  it('probeVersion throws on bad binary', () => {
    assert.throws(() => probeVersion('not_a_real_binary_xyz_abc'), /not found|ENOENT|Cannot find/i);
  });
});

// ─── ffprobe.ts coverage ──────────────────────────────────────────────────────
describe('ffprobe coverage', () => {
  const mockResult = {
    streams: [
      { index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080,
        r_frame_rate: '30/1', avg_frame_rate: '30/1', pix_fmt: 'yuv420p',
        color_space: 'bt709', color_transfer: 'bt709', field_order: 'progressive',
        duration: '120.0', bit_rate: '4000000', profile: 'High',
        disposition: { default: 1 } },
      { index: 1, codec_type: 'audio', codec_name: 'aac', sample_rate: '48000',
        channels: 2, channel_layout: 'stereo', duration: '120.0', bit_rate: '128000',
        tags: { language: 'eng' }, disposition: { default: 1 } },
      { index: 2, codec_type: 'subtitle', codec_name: 'subrip',
        tags: { language: 'fra' }, disposition: { default: 0 } },
    ],
    format: { filename: 'test.mp4', duration: '120.042', size: '62914560', bit_rate: '4128000' },
    chapters: [],
  };

  it('getVideoStreams filters video only', () => {
    const streams = getVideoStreams(mockResult as ProbeResult);
    assert.strictEqual(streams.length, 1);
    assert.strictEqual(streams[0].codec_type, 'video');
  });

  it('getAudioStreams filters audio only', () => {
    const streams = getAudioStreams(mockResult as ProbeResult);
    assert.strictEqual(streams.length, 1);
    assert.strictEqual(streams[0].codec_type, 'audio');
  });

  it('getSubtitleStreams filters subtitles only', () => {
    const streams = getSubtitleStreams(mockResult as ProbeResult);
    assert.strictEqual(streams.length, 1);
    assert.strictEqual(streams[0].codec_type, 'subtitle');
  });

  it('durationToMicroseconds converts seconds', () => {
    assert.strictEqual(durationToMicroseconds(1), 1000000);
    assert.strictEqual(durationToMicroseconds(0.5), 500000);
  });

  it('formatDuration 0 is 00:00:00.000', () => {
    assert.strictEqual(formatDuration(0), '00:00:00.000');
  });

  it('formatDuration handles fractional seconds', () => {
    assert.strictEqual(formatDuration(90.5), '00:01:30.500');
  });

  it('parseDuration handles undefined', () => {
    assert.strictEqual(parseDuration(undefined), null);
  });

  it('parseBitrate returns null for undefined', () => {
    assert.strictEqual(parseBitrate(undefined), null);
  });

  it('parseBitrate returns null for N/A', () => {
    assert.strictEqual(parseBitrate('N/A'), null);
  });

  it('parseFrameRate returns null for every unparseable rate', () => {
    // ffmpeg reports 0/0 for a stream with no fixed frame rate, so there is
    // no meaningful fps to derive rather than a zero fps. `1/abc` and `30/0`
    // used to slip through as NaN/Infinity.
    assert.strictEqual(parseFrameRate('0/0'), null);
    assert.strictEqual(parseFrameRate('N/A'), null);
    assert.strictEqual(parseFrameRate(undefined), null);
    assert.strictEqual(parseFrameRate(''), null);
    assert.strictEqual(parseFrameRate('25'), null);
    assert.strictEqual(parseFrameRate('1/abc'), null);
    assert.strictEqual(parseFrameRate('30/0'), null);
    assert.strictEqual(parseFrameRate('-30/1'), null);
  });

  it('parseFrameRate keeps the exact ratio alongside the reduced value', () => {
    assert.deepStrictEqual(parseFrameRate('30000/1001'), { num: 30000, den: 1001, value: 30000 / 1001 });
    assert.deepStrictEqual(parseFrameRate('25/1'), { num: 25, den: 1, value: 25 });
  });

  it('summarizeAudioStream returns expected fields', () => {
    const stream = mockResult.streams[1] as any;
    const summary = summarizeAudioStream(stream);
    assert.notStrictEqual(summary, null);
    assert.strictEqual(summary?.codec, 'aac');
    assert.strictEqual(summary?.channels, 2);
  });

  it('ProbeError stores filePath and detail', () => {
    const e = new ProbeError('/tmp/file.mp4', 'No such file');
    assert.strictEqual(e.filePath, '/tmp/file.mp4');
    assert.ok(e.message.includes('file.mp4'), `expected ${e.message} to include ${'file.mp4'}; got ${e.message}`);
  });

  it('probe throws ProbeError for nonexistent file', () => {
    assert.throws(() => probe('nonexistent_xyz_abc.mp4'), (e: any) => e instanceof ProbeError);
  });

  it('probeAsync rejects with ProbeError for nonexistent file', async () => {
    await assert.rejects(probeAsync('nonexistent_xyz_abc.mp4'), (e: any) => e instanceof ProbeError);
  });
});

// ─── args.ts uncovered line ───────────────────────────────────────────────────
describe('args.ts full coverage', () => {

  it('buildOutputArgs seekOutput', () => {
    const args = buildOutputArgs({ seekOutput: '00:01:00' });
    assert.ok(args.includes('-ss'), `expected ${args} to include ${'-ss'}; got ${args}`);
    assert.ok(args.includes('00:01:00'), `expected ${args} to include ${'00:01:00'}; got ${args}`);
  });

  it('buildOutputArgs map array', () => {
    const args = buildOutputArgs({ map: ['0:v', '0:a'] });
    assert.strictEqual(args.filter((a: string) => a === '-map').length, 2);
  });

  it('toDuration with number returns string', () => {
    assert.strictEqual(toDuration(90), '90');
  });

  it('toDuration with string returns same', () => {
    assert.strictEqual(toDuration('00:01:30'), '00:01:30');
  });

  it('buildGlobalArgs with logLevel', () => {
    const args = buildGlobalArgs({ logLevel: 'quiet' });
    assert.ok(args.includes('-loglevel'), `expected ${args} to include ${'-loglevel'}; got ${args}`);
    assert.ok(args.includes('quiet'), `expected ${args} to include ${'quiet'}; got ${args}`);
  });

  it('buildGlobalArgs with progress=true', () => {
    const args = buildGlobalArgs({ progress: true });
    assert.ok(args.includes('-progress'), `expected ${args} to include ${'-progress'}; got ${args}`);
  });

  it('buildInputArgs with all options', () => {
    const args = buildInputArgs({ seekInput: 10, duration: 30, format: 'mp4' });
    assert.ok(args.includes('-ss'), `expected ${args} to include ${'-ss'}; got ${args}`);
    assert.ok(args.includes('-t'), `expected ${args} to include ${'-t'}; got ${args}`);
    assert.ok(args.includes('-f'), `expected ${args} to include ${'-f'}; got ${args}`);
  });
});

// ─── binary.ts coverage ──────────────────────────────────────────────────────
describe('binary.ts coverage', () => {

  it('resolveBinary returns ffmpeg path', () => {
    assert.strictEqual(typeof resolveBinary(), 'string');
  });

  it('resolveProbe returns ffprobe path', () => {
    assert.strictEqual(typeof resolveProbe(), 'string');
  });

  it('isBinaryAvailable false for nonexistent', () => {
    assert.strictEqual(isBinaryAvailable('totally_fake_binary_xyz'), false);
  });

  it('isBinaryAvailable true for ffmpeg', () => {
    assert.strictEqual(isBinaryAvailable('ffmpeg'), true);
  });

  it('BinaryNotFoundError is Error', () => {
    assert.ok(new BinaryNotFoundError('x') instanceof Error, `assertion failed: ${new BinaryNotFoundError('x') instanceof Error}`);
  });

  it('BinaryNotExecutableError is Error', () => {
    assert.ok(new BinaryNotExecutableError('x') instanceof Error, `assertion failed: ${new BinaryNotExecutableError('x') instanceof Error}`);
  });

  it('validateBinary passes for ffmpeg', () => {
    assert.doesNotThrow(() => validateBinary('ffmpeg'));
  });

  it('validateBinary throws BinaryNotFoundError for fake binary', () => {
    assert.throws(() => validateBinary('totally_fake_xyz'), (e: any) => e instanceof BinaryNotFoundError);
  });
});

// ─── codec serializers uncovered lines ───────────────────────────────────────
describe('codec serializers full coverage', () => {
  it('x264ToArgs with tune', () => {
    const args = x264ToArgs({ tune: 'film' });
    assert.ok(args.includes('film'), `expected ${args} to include ${'film'}; got ${args}`);
  });

  it('x264ToArgs with aq-mode', () => {
    const args: string[] = x264ToArgs({ aqMode: 2 });
    assert.ok(args.some((a: string) => a.includes('aq') || a === '2'), `assertion failed: ${args.some((a: string) => a.includes('aq') || a === '2')}`);
  });

  it('x265ToArgs with bitrate', () => {
    const args = x265ToArgs({ bitrate: 2000 });
    assert.ok(args.includes('2000k'), `expected ${args} to include ${'2000k'}; got ${args}`);
  });

  it('x265ToArgs with crf', () => {
    const args = x265ToArgs({ crf: 18, preset: 'slow' });
    assert.ok(args.includes('18'), `expected ${args} to include ${'18'}; got ${args}`);
    assert.ok(args.includes('slow'), `expected ${args} to include ${'slow'}; got ${args}`);
  });

  it('svtav1ToArgs with speed preset', () => {
    const args = svtav1ToArgs({ preset: 8, crf: 35 });
    assert.ok(args.includes('8'), `expected ${args} to include ${'8'}; got ${args}`);
    assert.ok(args.includes('35'), `expected ${args} to include ${'35'}; got ${args}`);
  });

  it('vp9ToArgs with tile-columns', () => {
    const args: string[] = vp9ToArgs({ tileColumns: 2 });
    assert.ok(args.some((a: string) => a.includes('tile') || a === '2'), `assertion failed: ${args.some((a: string) => a.includes('tile') || a === '2')}`);
  });

  it('aacToArgs with channels', () => {
    const args = aacToArgs({ channels: 6 });
    assert.ok(args.includes('6'), `expected ${args} to include ${'6'}; got ${args}`);
  });

  it('opusToArgs with vbr', () => {
    const args = opusToArgs({ vbr: 'on' });
    assert.ok(args.includes('on'), `expected ${args} to include ${'on'}; got ${args}`);
  });

  it('mp3ToArgs with qscale vbr', () => {
    const args = mp3ToArgs({ qscale: 2 });
    assert.ok(args.includes('2'), `expected ${args} to include ${'2'}; got ${args}`);
  });

  it('flacToArgs with compression level', () => {
    const args = flacToArgs({ compressionLevel: 8 });
    assert.ok(args.includes('8'), `expected ${args} to include ${'8'}; got ${args}`);
  });

  it('nvencToArgs with hevc codec', () => {
    const args = nvencToArgs({ preset: 'p4' }, 'hevc_nvenc');
    assert.ok(args.includes('hevc_nvenc'), `expected ${args} to include ${'hevc_nvenc'}; got ${args}`);
  });

  it('vaapiToArgs with hevc codec', () => {
    const args = vaapiToArgs({}, 'hevc_vaapi');
    assert.ok(args.includes('hevc_vaapi'), `expected ${args} to include ${'hevc_vaapi'}; got ${args}`);
  });

  it('mediacodecToArgs returns args array', () => {
    const args = mediacodecToArgs({}, 'h264_mediacodec');
    assert.ok(Array.isArray(args), `assertion failed: ${Array.isArray(args)}`);
    assert.ok(args.includes('h264_mediacodec'), `expected ${args} to include ${'h264_mediacodec'}; got ${args}`);
  });

  it('vulkanToArgs returns args array', () => {
    const args = vulkanToArgs({}, 'h264_vulkan');
    assert.ok(Array.isArray(args), `assertion failed: ${Array.isArray(args)}`);
    assert.ok(args.includes('h264_vulkan'), `expected ${args} to include ${'h264_vulkan'}; got ${args}`);
  });

  it('qsvToArgs with bitrate', () => {
    const args = qsvToArgs({ bitrate: 3000 }, 'h264_qsv');
    assert.ok(args.includes('3000k'), `expected ${args} to include ${'3000k'}; got ${args}`);
  });
});
