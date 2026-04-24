/**
 * mediaforge — Fully typed TypeScript wrapper for FFmpeg.
 *
 * Fluent builder API, FFmpeg v6/v7/v8 compatible, zero native bindings.
 * Spawns the system `ffmpeg` binary — works on Node.js, Deno, and Bun.
 *
 * @example
 * ```ts
 * import { ffmpeg } from "mediaforge";
 *
 * await ffmpeg("input.mp4")
 *   .output("output.mp4")
 *   .videoCodec("libx264")
 *   .audioBitrate("128k")
 *   .run();
 * ```
 *
 * @module
 */

// Primary entry point
export { ffmpeg, FFmpegBuilder, VersionError } from './FFmpeg.ts';
export type { FFmpegBuilderDryOptions } from './FFmpeg.ts';

// Process management
export { spawnFFmpeg, runFFmpeg, FFmpegSpawnError } from './process/spawn.ts';
export { FFmpegEmitter } from './process/events.ts';
export { ProgressParser, parseAllProgress } from './process/progress.ts';

// Utilities
export { resolveBinary, resolveProbe, validateBinary, isBinaryAvailable, BinaryNotFoundError, BinaryNotExecutableError } from './utils/binary.ts';
export { probeVersion, parseVersionOutput, satisfiesVersion, formatVersion } from './utils/version.ts';
export { flattenArgs, buildGlobalArgs, buildInputArgs, buildOutputArgs, toDuration, toBitrate } from './utils/args.ts';

// Phase 2 — Codec & Format Layer
export { CapabilityRegistry, getDefaultRegistry } from './codecs/registry.ts';
export { x264ToArgs, x265ToArgs, svtav1ToArgs, vp9ToArgs } from './codecs/video.ts';
export { svtav1ToArgs as svtAv1ToArgs } from './codecs/video.ts';
export { proResToArgs, dnxhdToArgs, mjpegToArgs, mpeg2ToArgs, mpeg4ToArgs, vp8ToArgs, theoraToArgs, ffv1ToArgs } from './codecs/video.ts';
export { aacToArgs, opusToArgs, mp3ToArgs, flacToArgs, ac3ToArgs } from './codecs/audio.ts';
export { opusToArgs as libOpusToArgs, mp3ToArgs as libMp3LameToArgs } from './codecs/audio.ts';
export { alacToArgs, eac3ToArgs, truehdToArgs, vorbisToArgs, wavpackToArgs, pcmToArgs, mp2ToArgs } from './codecs/audio.ts';
export { nvencToArgs, vaapiToArgs, mediacodecToArgs, vulkanToArgs, qsvToArgs } from './codecs/hardware.ts';
export { mediacodecVideoToArgs, vulkanVideoToArgs, amfToArgs, videotoolboxToArgs } from './codecs/hardware.ts';
export { isFeatureExpected, availableFeatures, unavailableFeatures, FEATURE_GATES } from './compat/features.ts';

// Phase 3 — Filter System
export { FilterChain, serializeNode, serializeLink, pad } from './types/filters.ts';
export { FilterGraph, GraphNode, GraphStream, VideoFilterChain, AudioFilterChain, videoFilterChain, audioFilterChain, filterGraph, resetLabelCounter } from './filters/complex.ts';
// Video filters
export { scale, crop, pad as videoPad, overlay, drawtext, fps, setpts, trim, format, setsar, setdar, vflip, hflip, rotate, transpose, unsharp, gblur, boxblur, eq, hue, colorbalance, yadif, hqdn3d, nlmeans, thumbnail, select, concat, split, tile, colorkey, chromakey, subtitles, avgblurVulkan, nlmeansVulkan, fade, zoompan, curves, levels, deband, deshake, deflicker, smartblur, hstack, vstack, xstack, colorSource, drawbox, drawgrid, vignette, vaguedenoiser } from './filters/video/index.ts';
// Audio filters
export { volume, loudnorm, equalizer, bass, treble, afade, asetpts, atrim, amerge, amix, pan, channelmap, channelsplit, aresample, dynaudnorm, compand, aecho, highpass, lowpass, asplit, silencedetect, rubberband, atempo, agate, headphones, sofalizer } from './filters/audio/index.ts';
export type { FilterNode, GraphPad, GraphLink } from './types/filters.ts';
export type { CurvesOptions, LevelsOptions, XstackOptions } from './filters/video/index.ts';

// Phase 4 — Compat & Advanced
export { probe, probeAsync, ProbeError, parseFrameRate, parseDuration, parseBitrate, getVideoStreams, getAudioStreams, getSubtitleStreams, getDefaultVideoStream, getDefaultAudioStream, getMediaDuration, durationToMicroseconds, summarizeVideoStream, summarizeAudioStream, getStreamLanguage, findStreamByLanguage, formatDuration, isHdr, isInterlaced, getChapterList } from './probe/ffprobe.ts';
export { twoPassEncode, buildTwoPassArgs } from './helpers/twopass.ts';
export { hlsPackage, adaptiveHls, dashPackage } from './helpers/hls.ts';
export { mapStream, mapAll, mapAllVideo, mapAllAudio, mapAllSubtitles, mapVideo, mapAudio, mapSubtitle, mapLabel, negateMap, setStreamMetadata, setMetadata, setDisposition, streamCodec, copyStream, remuxAll, mapDefaultStreams, mapAVS, copyAudioAndSubs, serializeSpecifier, ss } from './helpers/mapping.ts';
export { guardVersion, guardFeatureVersion, guardCodec, guardFilter, guardHwaccel, guardCodecFull, assertCodec, assertHwaccel, assertFeatureVersion, GuardError, selectBestCodec, selectBestHwaccel } from './compat/guards.ts';
export type { ProbeResult, ProbeStream, ProbeFormat, ProbeChapter, ParsedFrameRate, VideoStreamSummary, AudioStreamSummary, StreamCodecType, StreamDisposition } from './types/probe.ts';
export type { TwoPassOptions } from './helpers/twopass.ts';
export type { HlsOptions, HlsVariant, AdaptiveHlsOptions, DashOptions } from './helpers/hls.ts';
export type { StreamSpecifier, MediaTypeChar } from './helpers/mapping.ts';
export type { GuardResult, CodecCandidate } from './compat/guards.ts';

export type { VersionInfo, VersionRequirement } from './types/version.ts';
export type { ProgressInfo } from './types/progress.ts';
export type { GlobalOptions, InputOptions, OutputOptions, LogLevel, SeekMode } from './types/options.ts';
export type { FFmpegEvents } from './process/events.ts';
export type { SpawnOptions, FFmpegProcess } from './process/spawn.ts';
export type { PixelFormat, SampleFormat, ChannelLayout, CodecFlags, CodecInfo, FilterInfo, FormatInfo } from './types/codecs.ts';
export type { X264Options, X265Options, SvtAv1Options, Vp9Options } from './codecs/video.ts';
export type { ProResOptions, DnxhdOptions, MjpegOptions, Mpeg2Options, Mpeg4Options, Vp8Options, TheoraOptions, Ffv1Options } from './codecs/video.ts';
export type { AacOptions, LibOpusOptions, LibMp3LameOptions, LibVorbisOptions, FlacOptions, Ac3Options } from './codecs/audio.ts';
export type { AlacOptions, Eac3Options, TruehdOptions, VorbisOptions, WavpackOptions, PcmOptions, PcmFormat, Mp2Options } from './codecs/audio.ts';
export type { NvencOptions, NvencVideoCodec, VaapiOptions, VaapiVideoCodec, VaapiDeviceOptions, MediaCodecOptions, MediaCodecCodec, MediaCodecVideoCodec, MediaCodecAudioCodec, VulkanOptions, VulkanVideoCodec, QsvOptions, QsvVideoCodec } from './codecs/hardware.ts';
export type { MediaCodecVideoOptions, VulkanVideoOptions, AmfOptions, AmfVideoCodec, VideoToolboxOptions, VideoToolboxCodec } from './codecs/hardware.ts';
export type { FeatureGate } from './compat/features.ts';

// Screenshots & frame extraction
export { screenshots, frameToBuffer, extractFrames } from './helpers/screenshots.ts';
export type { ScreenshotOptions, ScreenshotResult, FrameToBufferOptions, ExtractFramesOptions, ExtractFramesResult } from './helpers/screenshots.ts';

// Concat / merge
export { mergeToFile, concatFiles, buildConcatList, concatWithTransitions } from './helpers/concat.ts';
export type { MergeOptions, ConcatOptions, TransitionType, ConcatWithTransitionsOptions } from './helpers/concat.ts';

// Pipe / stream I/O
export { pipeThrough, streamOutput, streamToFile } from './helpers/streams.ts';
export type { PipeOptions, PipeProcess, StreamOutputOptions, StreamToFileOptions } from './helpers/streams.ts';

// Named presets
export { getPreset, listPresets, applyPreset } from './helpers/presets.ts';
export type { PresetName, PresetResult } from './helpers/presets.ts';

// Animated GIF
export { toGif, gifToMp4 } from './helpers/gif.ts';
export type { GifOptions, GifToMp4Options } from './helpers/gif.ts';

// Audio normalization
export { normalizeAudio, adjustVolume, detectSilence, detectScenes, cropDetect, burnTimecode, parseLoudnorm } from './helpers/normalize.ts';
export type { NormalizeOptions, NormalizeResult, AdjustVolumeOptions, SilenceSegment, DetectSilenceOptions, SceneChange, DetectScenesOptions, CropRegion, CropDetectOptions, BurnTimecodeOptions, EbuR128Result, ParseLoudnormOptions } from './helpers/normalize.ts';

// Watermark
export { addWatermark, addTextWatermark } from './helpers/watermark.ts';
export type { WatermarkOptions, WatermarkPosition, TextWatermarkOptions } from './helpers/watermark.ts';

// Subtitle burn/extract
export { burnSubtitles, extractSubtitles } from './helpers/subtitles.ts';
export { trimVideo, changeSpeed, buildAtempoChain, extractAudio, replaceAudio, mixAudio, loopVideo, deinterlace, cropToRatio, stackVideos, generateSprite, applyLUT, stabilizeVideo, streamToUrl } from './helpers/edit.ts';
export type { TrimOptions, ChangeSpeedOptions, ExtractAudioOptions, ReplaceAudioOptions, MixAudioOptions, LoopVideoOptions, DeinterlaceOptions, CropToRatioOptions, StackVideosOptions, SpriteOptions, ApplyLutOptions, StabilizeOptions, StreamToUrlOptions } from './helpers/edit.ts';
export type { BurnSubtitlesOptions, ExtractSubtitlesOptions } from './helpers/subtitles.ts';

// Metadata write/strip
export { writeMetadata, stripMetadata, addChapters } from './helpers/metadata.ts';
export type { WriteMetadataOptions, StripMetadataOptions, ChapterMeta, AddChaptersOptions } from './helpers/metadata.ts';

// Waveform / spectrum
export { generateWaveform, generateSpectrum } from './helpers/waveform.ts';
export type { WaveformOptions, SpectrumOptions } from './helpers/waveform.ts';

// Process management
export { renice, autoKillOnExit, killAllFFmpeg } from './helpers/process.ts';

// Arg builders (testable without ffmpeg)
export { buildHlsArgs, buildDashArgs } from './helpers/hls.ts';
export { buildWatermarkFilter, buildTextWatermarkFilter } from './helpers/watermark.ts';
export { buildBurnSubtitlesFilter } from './helpers/subtitles.ts';
export { buildWaveformFilter, buildSpectrumFilter } from './helpers/waveform.ts';
export { buildMetadataArgs, buildChapterContent } from './helpers/metadata.ts';
export { buildLoudnormFilter, buildSilenceDetectFilter, buildSceneSelectFilter, buildBurnTimecodeFilter } from './helpers/normalize.ts';
export { buildGifArgs, buildGifPalettegenFilter, buildGifPaletteuseFilter } from './helpers/gif.ts';
export { buildScreenshotArgs, buildFrameBufferArgs, buildTimestampFilename, buildExtractFramesArgs } from './helpers/screenshots.ts';
export { buildConcatTransitionArgs } from './helpers/concat.ts';
export { buildPipeThroughArgs, buildStreamOutputArgs } from './helpers/streams.ts';
