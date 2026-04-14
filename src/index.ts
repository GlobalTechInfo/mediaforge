/**
 * mediaforge — Fully typed TypeScript wrapper for FFmpeg
 * Supports FFmpeg v6, v7, v8+
 * Zero native bindings — spawns the system ffmpeg binary.
 */

// Primary entry point
export { ffmpeg, FFmpegBuilder, VersionError } from './FFmpeg.js';

// Process management
export { spawnFFmpeg, runFFmpeg, FFmpegSpawnError } from './process/spawn.js';
export { FFmpegEmitter } from './process/events.js';
export { ProgressParser, parseAllProgress } from './process/progress.js';

// Utilities
export { resolveBinary, resolveProbe, validateBinary, isBinaryAvailable, BinaryNotFoundError, BinaryNotExecutableError } from './utils/binary.js';
export { probeVersion, parseVersionOutput, satisfiesVersion, formatVersion } from './utils/version.js';
export { flattenArgs, buildGlobalArgs, buildInputArgs, buildOutputArgs, toDuration, toBitrate } from './utils/args.js';

// Phase 2 — Codec & Format Layer
export { CapabilityRegistry, getDefaultRegistry } from './codecs/registry.js';
export { x264ToArgs, x265ToArgs, svtav1ToArgs, vp9ToArgs } from './codecs/video.js';
export { svtav1ToArgs as svtAv1ToArgs } from './codecs/video.js';
export { proResToArgs, dnxhdToArgs, mjpegToArgs, mpeg2ToArgs, mpeg4ToArgs, vp8ToArgs, theoraToArgs, ffv1ToArgs } from './codecs/video.js';
export { aacToArgs, opusToArgs, mp3ToArgs, flacToArgs, ac3ToArgs } from './codecs/audio.js';
export { opusToArgs as libOpusToArgs, mp3ToArgs as libMp3LameToArgs } from './codecs/audio.js';
export { alacToArgs, eac3ToArgs, truehdToArgs, vorbisToArgs, wavpackToArgs, pcmToArgs, mp2ToArgs } from './codecs/audio.js';
export { nvencToArgs, vaapiToArgs, mediacodecToArgs, vulkanToArgs, qsvToArgs } from './codecs/hardware.js';
export { mediacodecVideoToArgs, vulkanVideoToArgs } from './codecs/hardware.js';
export { isFeatureExpected, availableFeatures, unavailableFeatures, FEATURE_GATES } from './compat/features.js';

// Phase 3 — Filter System
export { FilterChain, serializeNode, serializeLink, pad } from './types/filters.js';
export { FilterGraph, GraphNode, GraphStream, VideoFilterChain, AudioFilterChain, videoFilterChain, audioFilterChain, filterGraph, resetLabelCounter } from './filters/complex.js';
// Video filters
export { scale, crop, pad as videoPad, overlay, drawtext, fps, setpts, trim, format, setsar, setdar, vflip, hflip, rotate, transpose, unsharp, gblur, boxblur, eq, hue, colorbalance, yadif, hqdn3d, nlmeans, thumbnail, select, concat, split, tile, colorkey, chromakey, subtitles, avgblurVulkan, nlmeansVulkan, fade, zoompan } from './filters/video/index.js';
// Audio filters
export { volume, loudnorm, equalizer, bass, treble, afade, asetpts, atrim, amerge, amix, pan, channelmap, channelsplit, aresample, dynaudnorm, compand, aecho, highpass, lowpass, asplit, silencedetect, rubberband, atempo, agate } from './filters/audio/index.js';
export type { FilterNode, GraphPad, GraphLink } from './types/filters.js';

// Phase 4 — Compat & Advanced
export { probe, probeAsync, ProbeError, parseFrameRate, parseDuration, parseBitrate, getVideoStreams, getAudioStreams, getSubtitleStreams, getDefaultVideoStream, getDefaultAudioStream, getMediaDuration, durationToMicroseconds, summarizeVideoStream, summarizeAudioStream, getStreamLanguage, findStreamByLanguage, formatDuration, isHdr, isInterlaced, getChapterList } from './probe/ffprobe.js';
export { twoPassEncode, buildTwoPassArgs } from './helpers/twopass.js';
export { hlsPackage, adaptiveHls, dashPackage } from './helpers/hls.js';
export { mapStream, mapAll, mapAllVideo, mapAllAudio, mapAllSubtitles, mapVideo, mapAudio, mapSubtitle, mapLabel, negateMap, setStreamMetadata, setMetadata, setDisposition, streamCodec, copyStream, remuxAll, mapDefaultStreams, mapAVS, copyAudioAndSubs, serializeSpecifier, ss } from './helpers/mapping.js';
export { guardVersion, guardFeatureVersion, guardCodec, guardFilter, guardHwaccel, guardCodecFull, assertCodec, assertHwaccel, assertFeatureVersion, GuardError, selectBestCodec, selectBestHwaccel } from './compat/guards.js';
export type { ProbeResult, ProbeStream, ProbeFormat, ProbeChapter, ParsedFrameRate, VideoStreamSummary, AudioStreamSummary, StreamCodecType, StreamDisposition } from './types/probe.js';
export type { TwoPassOptions } from './helpers/twopass.js';
export type { HlsOptions, HlsVariant, AdaptiveHlsOptions, DashOptions } from './helpers/hls.js';
export type { StreamSpecifier, MediaTypeChar } from './helpers/mapping.js';
export type { GuardResult, CodecCandidate } from './compat/guards.js';

export type { VersionInfo, VersionRequirement } from './types/version.js';
export type { ProgressInfo } from './types/progress.js';
export type { GlobalOptions, InputOptions, OutputOptions, LogLevel, SeekMode } from './types/options.js';
export type { FFmpegEvents } from './process/events.js';
export type { SpawnOptions, FFmpegProcess } from './process/spawn.js';
export type { PixelFormat, SampleFormat, ChannelLayout, CodecFlags, CodecInfo, FilterInfo, FormatInfo } from './types/codecs.js';
export type { X264Options, X265Options, SvtAv1Options, Vp9Options } from './codecs/video.js';
export type { ProResOptions, DnxhdOptions, MjpegOptions, Mpeg2Options, Mpeg4Options, Vp8Options, TheoraOptions, Ffv1Options } from './codecs/video.js';
export type { AacOptions, LibOpusOptions, LibMp3LameOptions, LibVorbisOptions, FlacOptions, Ac3Options } from './codecs/audio.js';
export type { AlacOptions, Eac3Options, TruehdOptions, VorbisOptions, WavpackOptions, PcmOptions, PcmFormat, Mp2Options } from './codecs/audio.js';
export type { NvencOptions, NvencVideoCodec, VaapiOptions, VaapiVideoCodec, VaapiDeviceOptions, MediaCodecOptions, MediaCodecCodec, MediaCodecVideoCodec, MediaCodecAudioCodec, VulkanOptions, VulkanVideoCodec, QsvOptions, QsvVideoCodec } from './codecs/hardware.js';
export type { MediaCodecVideoOptions, VulkanVideoOptions } from './codecs/hardware.js';
export type { FeatureGate } from './compat/features.js';

// Screenshots & frame extraction
export { screenshots, frameToBuffer } from './helpers/screenshots.js';
export type { ScreenshotOptions, ScreenshotResult, FrameToBufferOptions } from './helpers/screenshots.js';

// Concat / merge
export { mergeToFile, concatFiles, buildConcatList } from './helpers/concat.js';
export type { MergeOptions, ConcatOptions } from './helpers/concat.js';

// Pipe / stream I/O
export { pipeThrough, streamOutput, streamToFile } from './helpers/streams.js';
export type { PipeOptions, PipeProcess, StreamOutputOptions, StreamToFileOptions } from './helpers/streams.js';

// Named presets
export { getPreset, listPresets, applyPreset } from './helpers/presets.js';
export type { PresetName, PresetResult } from './helpers/presets.js';

// Animated GIF
export { toGif, gifToMp4 } from './helpers/gif.js';
export type { GifOptions, GifToMp4Options } from './helpers/gif.js';

// Audio normalization
export { normalizeAudio, adjustVolume } from './helpers/normalize.js';
export type { NormalizeOptions, NormalizeResult, AdjustVolumeOptions } from './helpers/normalize.js';

// Watermark
export { addWatermark, addTextWatermark } from './helpers/watermark.js';
export type { WatermarkOptions, WatermarkPosition, TextWatermarkOptions } from './helpers/watermark.js';

// Subtitle burn/extract
export { burnSubtitles, extractSubtitles } from './helpers/subtitles.js';
export type { BurnSubtitlesOptions, ExtractSubtitlesOptions } from './helpers/subtitles.js';

// Metadata write/strip
export { writeMetadata, stripMetadata } from './helpers/metadata.js';
export type { WriteMetadataOptions, StripMetadataOptions, ChapterMeta } from './helpers/metadata.js';

// Waveform / spectrum
export { generateWaveform, generateSpectrum } from './helpers/waveform.js';
export type { WaveformOptions, SpectrumOptions } from './helpers/waveform.js';

// Process management
export { renice, autoKillOnExit, killAllFFmpeg } from './helpers/process.js';

// Arg builders (testable without ffmpeg)
export { buildHlsArgs, buildDashArgs } from './helpers/hls.js';
export { buildWatermarkFilter, buildTextWatermarkFilter } from './helpers/watermark.js';
export { buildBurnSubtitlesFilter } from './helpers/subtitles.js';
export { buildWaveformFilter, buildSpectrumFilter } from './helpers/waveform.js';
export { buildMetadataArgs, buildChapterContent } from './helpers/metadata.js';
export { buildLoudnormFilter } from './helpers/normalize.js';
export { buildGifArgs, buildGifPalettegenFilter, buildGifPaletteuseFilter } from './helpers/gif.js';
export { buildScreenshotArgs, buildFrameBufferArgs, buildTimestampFilename } from './helpers/screenshots.js';
export { buildPipeThroughArgs, buildStreamOutputArgs } from './helpers/streams.js';
