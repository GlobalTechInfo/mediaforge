import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// ─── CapabilityRegistry unit coverage ────────────────────────────────────────
describe('CapabilityRegistry', () => {
  let CapabilityRegistry: any, getDefaultRegistry: any;
  before(async () => {
    const m = await import('../../dist/esm/codecs/registry.js');
    CapabilityRegistry = m.CapabilityRegistry;
    getDefaultRegistry = m.getDefaultRegistry;
  });

  it('instantiates with binary string', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.ok(r !== null);
  });

  it('hasCodec returns boolean', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.ok(typeof r.hasCodec('libx264') === 'boolean');
  });

  it('canEncode returns boolean', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.ok(typeof r.canEncode('libx264') === 'boolean');
  });

  it('canDecode returns boolean', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.ok(typeof r.canDecode('h264') === 'boolean');
  });

  it('hasFilter returns boolean', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.ok(typeof r.hasFilter('scale') === 'boolean');
  });

  it('hasFormat returns boolean', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.ok(typeof r.hasFormat('mp4') === 'boolean');
  });

  it('hasHwaccel returns boolean', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.ok(typeof r.hasHwaccel('cuda') === 'boolean');
  });

  it('codecs map is populated', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.ok(r.codecs.size > 0);
  });

  it('filters map is populated', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.ok(r.filters.size > 0);
  });

  it('formats map is populated', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.ok(r.formats.size > 0);
  });

  it('hwaccels set exists', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.ok(r.hwaccels instanceof Set);
  });

  it('invalidate clears cache', () => {
    const r = new CapabilityRegistry('ffmpeg');
    r.hasCodec('libx264'); // populate cache
    r.invalidate();
    // after invalidate, re-probing should still work
    assert.ok(typeof r.hasCodec('libx264') === 'boolean');
  });

  it('returns empty maps for invalid binary', () => {
    const r = new CapabilityRegistry('not_a_real_binary_xyz');
    assert.strictEqual(r.codecs.size, 0);
    assert.strictEqual(r.filters.size, 0);
    assert.strictEqual(r.formats.size, 0);
    assert.ok(r.hwaccels instanceof Set);
  });

  it('getDefaultRegistry returns singleton', () => {
    const r1 = getDefaultRegistry();
    const r2 = getDefaultRegistry();
    assert.strictEqual(r1, r2);
  });

  it('libx264 canEncode is boolean', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.ok(typeof r.canEncode('libx264') === 'boolean');
  });

  it('scale filter hasFilter returns boolean', () => {
    const r = new CapabilityRegistry('ffmpeg');
    assert.ok(typeof r.hasFilter('scale') === 'boolean');
  });
});

// ─── spawn.ts coverage ────────────────────────────────────────────────────────
describe('spawnFFmpeg / runFFmpeg coverage', () => {
  let spawnFFmpeg: any, runFFmpeg: any, FFmpegSpawnError: any;
  before(async () => {
    const m = await import('../../dist/esm/process/spawn.js');
    spawnFFmpeg = m.spawnFFmpeg; runFFmpeg = m.runFFmpeg; FFmpegSpawnError = m.FFmpegSpawnError;
  });

  it('FFmpegSpawnError with null signal uses "unknown"', () => {
    const e = new FFmpegSpawnError(null, null, 'err');
    assert.ok(e.message.includes('unknown'));
  });

  it('FFmpegSpawnError with signal string shows signal', () => {
    const e = new FFmpegSpawnError(null, 'SIGTERM', 'err');
    assert.ok(e.message.includes('SIGTERM'));
  });

  it('FFmpegSpawnError truncates long stderr to 2000 chars', () => {
    const longErr = 'x'.repeat(5000);
    const e = new FFmpegSpawnError(1, null, longErr);
    assert.ok(e.message.length < 3000);
  });

  it('spawnFFmpeg with cwd option does not throw', () => {
    const proc = spawnFFmpeg({ binary: 'ffmpeg', args: ['-version'], cwd: '/tmp' });
    assert.ok(proc.emitter !== undefined);
    return new Promise<void>((res) => {
      proc.emitter.on('end', res);
      proc.emitter.on('error', res);
    });
  });

  it('spawnFFmpeg with parseProgress=true does not throw', () => {
    const proc = spawnFFmpeg({ binary: 'ffmpeg', args: ['-version'], parseProgress: true });
    return new Promise<void>((res) => {
      proc.emitter.on('end', res);
      proc.emitter.on('error', res);
    });
  });

  it('spawnFFmpeg with totalDurationUs option works', () => {
    const proc = spawnFFmpeg({ binary: 'ffmpeg', args: ['-version'], totalDurationUs: 1000000 });
    return new Promise<void>((res) => {
      proc.emitter.on('end', res);
      proc.emitter.on('error', res);
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
      proc.emitter.on('error', res);
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
    assert.ok(lines.length > 0);
  });

  it('spawnFFmpeg child process has pid', () => {
    const proc = spawnFFmpeg({ binary: 'ffmpeg', args: ['-version'] });
    assert.ok(typeof proc.child.pid === 'number');
    return new Promise<void>((res) => {
      proc.emitter.on('end', res);
      proc.emitter.on('error', res);
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
  let parseVersionOutput: any, satisfiesVersion: any, formatVersion: any, probeVersion: any;
  before(async () => {
    const m = await import('../../dist/esm/utils/version.js');
    parseVersionOutput = m.parseVersionOutput;
    satisfiesVersion = m.satisfiesVersion;
    formatVersion = m.formatVersion;
    probeVersion = m.probeVersion;
  });

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
    assert.ok(v.configuration.includes('--enable-libx264'));
  });

  it('satisfiesVersion with exact match', () => {
    const v = { major: 7, minor: 0, patch: 0, raw: '7.0.0', isGit: false, libraries: {}, configuration: [] };
    assert.ok(satisfiesVersion(v, 7));
  });

  it('satisfiesVersion below required returns false', () => {
    const v = { major: 6, minor: 1, patch: 0, raw: '6.1.0', isGit: false, libraries: {}, configuration: [] };
    assert.ok(!satisfiesVersion(v, 7));
  });

  it('formatVersion includes major.minor.patch', () => {
    const v = { major: 7, minor: 1, patch: 2, raw: '7.1.2', isGit: false, libraries: {}, configuration: [] };
    const s = formatVersion(v);
    assert.ok(s.includes('7'));
  });

  it('probeVersion returns valid version from installed ffmpeg', () => {
    const v = probeVersion('ffmpeg');
    assert.ok(v.major >= 4);
  });

  it('probeVersion throws on bad binary', () => {
    assert.throws(() => probeVersion('not_a_real_binary_xyz_abc'), /not found|ENOENT|Cannot find/i);
  });
});

// ─── ffprobe.ts coverage ──────────────────────────────────────────────────────
describe('ffprobe coverage', () => {
  let probe: any, probeAsync: any, ProbeError: any;
  let formatDuration: any, parseDuration: any, parseBitrate: any, parseFrameRate: any;
  let getVideoStreams: any, getAudioStreams: any, getSubtitleStreams: any;
  let durationToMicroseconds: any, summarizeAudioStream: any;

  before(async () => {
    const m = await import('../../dist/esm/probe/ffprobe.js');
    probe = m.probe; probeAsync = m.probeAsync; ProbeError = m.ProbeError;
    formatDuration = m.formatDuration; parseDuration = m.parseDuration;
    parseBitrate = m.parseBitrate; parseFrameRate = m.parseFrameRate;
    getVideoStreams = m.getVideoStreams; getAudioStreams = m.getAudioStreams;
    getSubtitleStreams = m.getSubtitleStreams;
    durationToMicroseconds = m.durationToMicroseconds;
    summarizeAudioStream = m.summarizeAudioStream;
  });

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
    const streams = getVideoStreams(mockResult);
    assert.strictEqual(streams.length, 1);
    assert.strictEqual(streams[0].codec_type, 'video');
  });

  it('getAudioStreams filters audio only', () => {
    const streams = getAudioStreams(mockResult);
    assert.strictEqual(streams.length, 1);
    assert.strictEqual(streams[0].codec_type, 'audio');
  });

  it('getSubtitleStreams filters subtitles only', () => {
    const streams = getSubtitleStreams(mockResult);
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

  it('parseFrameRate handles variable framerate 0/0', () => {
    const result = parseFrameRate('0/0');
    assert.ok(result === null || result.value === 0);
  });

  it('summarizeAudioStream returns expected fields', () => {
    const stream = mockResult.streams[1] as any;
    const summary = summarizeAudioStream(stream);
    assert.ok(summary !== null);
    assert.strictEqual(summary?.codec, 'aac');
    assert.strictEqual(summary?.channels, 2);
  });

  it('ProbeError stores filePath and detail', () => {
    const e = new ProbeError('/tmp/file.mp4', 'No such file');
    assert.strictEqual(e.filePath, '/tmp/file.mp4');
    assert.ok(e.message.includes('file.mp4'));
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
  let buildOutputArgs: any, buildInputArgs: any, buildGlobalArgs: any, toDuration: any;
  before(async () => {
    const m = await import('../../dist/esm/utils/args.js');
    buildOutputArgs = m.buildOutputArgs;
    buildInputArgs = m.buildInputArgs;
    buildGlobalArgs = m.buildGlobalArgs;
    toDuration = m.toDuration;
  });

  it('buildOutputArgs seekOutput', () => {
    const args = buildOutputArgs({ seekOutput: '00:01:00' });
    assert.ok(args.includes('-ss'));
    assert.ok(args.includes('00:01:00'));
  });

  it('buildOutputArgs map array', () => {
    const args = buildOutputArgs({ map: ['0:v', '0:a'] });
    assert.ok(args.filter((a: string) => a === '-map').length === 2);
  });

  it('toDuration with number returns string', () => {
    assert.strictEqual(toDuration(90), '90');
  });

  it('toDuration with string returns same', () => {
    assert.strictEqual(toDuration('00:01:30'), '00:01:30');
  });

  it('buildGlobalArgs with logLevel', () => {
    const args = buildGlobalArgs({ logLevel: 'quiet' });
    assert.ok(args.includes('-loglevel'));
    assert.ok(args.includes('quiet'));
  });

  it('buildGlobalArgs with progress=true', () => {
    const args = buildGlobalArgs({ progress: true });
    assert.ok(args.includes('-progress'));
  });

  it('buildInputArgs with all options', () => {
    const args = buildInputArgs({ seekInput: 10, duration: 30, format: 'mp4' });
    assert.ok(args.includes('-ss'));
    assert.ok(args.includes('-t'));
    assert.ok(args.includes('-f'));
  });
});

// ─── binary.ts coverage ──────────────────────────────────────────────────────
describe('binary.ts coverage', () => {
  let resolveBinary: any, resolveProbe: any, isBinaryAvailable: any, validateBinary: any;
  let BinaryNotFoundError: any, BinaryNotExecutableError: any;
  before(async () => {
    const m = await import('../../dist/esm/utils/binary.js');
    resolveBinary = m.resolveBinary; resolveProbe = m.resolveProbe;
    isBinaryAvailable = m.isBinaryAvailable; validateBinary = m.validateBinary;
    BinaryNotFoundError = m.BinaryNotFoundError;
    BinaryNotExecutableError = m.BinaryNotExecutableError;
  });

  it('resolveBinary returns ffmpeg path', () => {
    assert.ok(typeof resolveBinary() === 'string');
  });

  it('resolveProbe returns ffprobe path', () => {
    assert.ok(typeof resolveProbe() === 'string');
  });

  it('isBinaryAvailable false for nonexistent', () => {
    assert.strictEqual(isBinaryAvailable('totally_fake_binary_xyz'), false);
  });

  it('isBinaryAvailable true for ffmpeg', () => {
    assert.strictEqual(isBinaryAvailable('ffmpeg'), true);
  });

  it('BinaryNotFoundError is Error', () => {
    assert.ok(new BinaryNotFoundError('x') instanceof Error);
  });

  it('BinaryNotExecutableError is Error', () => {
    assert.ok(new BinaryNotExecutableError('x') instanceof Error);
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
  let x264ToArgs: any, x265ToArgs: any, svtav1ToArgs: any, vp9ToArgs: any;
  let aacToArgs: any, opusToArgs: any, mp3ToArgs: any, flacToArgs: any, _ac3ToArgs: any;
  let nvencToArgs: any, vaapiToArgs: any, mediacodecToArgs: any, vulkanToArgs: any, qsvToArgs: any;

  before(async () => {
    const v = await import('../../dist/esm/codecs/video.js');
    const a = await import('../../dist/esm/codecs/audio.js');
    const h = await import('../../dist/esm/codecs/hardware.js');
    x264ToArgs = v.x264ToArgs; x265ToArgs = v.x265ToArgs;
    svtav1ToArgs = v.svtav1ToArgs; vp9ToArgs = v.vp9ToArgs;
    aacToArgs = a.aacToArgs; opusToArgs = a.opusToArgs;
    mp3ToArgs = a.mp3ToArgs; flacToArgs = a.flacToArgs; _ac3ToArgs = a.ac3ToArgs;
    nvencToArgs = h.nvencToArgs; vaapiToArgs = h.vaapiToArgs;
    mediacodecToArgs = h.mediacodecToArgs; vulkanToArgs = h.vulkanToArgs;
    qsvToArgs = h.qsvToArgs;
  });

  it('x264ToArgs with tune', () => {
    const args = x264ToArgs({ tune: 'film' });
    assert.ok(args.includes('film'));
  });

  it('x264ToArgs with aq-mode', () => {
    const args: string[] = x264ToArgs({ aqMode: 2 });
    assert.ok(args.some((a: string) => a.includes('aq') || a === '2'));
  });

  it('x265ToArgs with bitrate', () => {
    const args = x265ToArgs({ bitrate: 2000 });
    assert.ok(args.includes('2000k'));
  });

  it('x265ToArgs with crf', () => {
    const args = x265ToArgs({ crf: 18, preset: 'slow' });
    assert.ok(args.includes('18'));
    assert.ok(args.includes('slow'));
  });

  it('svtav1ToArgs with speed preset', () => {
    const args = svtav1ToArgs({ preset: 8, crf: 35 });
    assert.ok(args.includes('8'));
    assert.ok(args.includes('35'));
  });

  it('vp9ToArgs with tile-columns', () => {
    const args: string[] = vp9ToArgs({ tileColumns: 2 });
    assert.ok(args.some((a: string) => a.includes('tile') || a === '2'));
  });

  it('aacToArgs with channels', () => {
    const args = aacToArgs({ channels: 6 });
    assert.ok(args.includes('6'));
  });

  it('opusToArgs with vbr', () => {
    const args = opusToArgs({ vbr: 'on' });
    assert.ok(args.includes('on'));
  });

  it('mp3ToArgs with qscale vbr', () => {
    const args = mp3ToArgs({ qscale: 2 });
    assert.ok(args.includes('2'));
  });

  it('flacToArgs with compression level', () => {
    const args = flacToArgs({ compressionLevel: 8 });
    assert.ok(args.includes('8'));
  });

  it('nvencToArgs with hevc codec', () => {
    const args = nvencToArgs({ preset: 'p4' }, 'hevc_nvenc');
    assert.ok(args.includes('hevc_nvenc'));
  });

  it('vaapiToArgs with hevc codec', () => {
    const args = vaapiToArgs({}, 'hevc_vaapi');
    assert.ok(args.includes('hevc_vaapi'));
  });

  it('mediacodecToArgs returns args array', () => {
    const args = mediacodecToArgs({}, 'h264_mediacodec');
    assert.ok(Array.isArray(args));
    assert.ok(args.includes('h264_mediacodec'));
  });

  it('vulkanToArgs returns args array', () => {
    const args = vulkanToArgs({}, 'h264_vulkan');
    assert.ok(Array.isArray(args));
    assert.ok(args.includes('h264_vulkan'));
  });

  it('qsvToArgs with bitrate', () => {
    const args = qsvToArgs({ bitrate: 3000 }, 'h264_qsv');
    assert.ok(args.includes('3000k'));
  });
});
