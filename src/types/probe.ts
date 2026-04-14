/**
 * Typed output from ffprobe -print_format json -show_streams -show_format -show_chapters.
 * All fields are marked optional — real-world files may omit any of them.
 * Field names match ffprobe JSON output exactly (snake_case).
 */

// ─── Stream types ──────────────────────────────────────────────────────────────

export type StreamCodecType = 'video' | 'audio' | 'subtitle' | 'data' | 'attachment';

/** Disposition flags on a stream */
export interface StreamDisposition {
  default?: number;
  dub?: number;
  original?: number;
  comment?: number;
  lyrics?: number;
  karaoke?: number;
  forced?: number;
  hearing_impaired?: number;
  visual_impaired?: number;
  clean_effects?: number;
  attached_pic?: number;
  timed_thumbnails?: number;
}

/** One stream from ffprobe -show_streams */
export interface ProbeStream {
  /** Stream index within the file */
  index: number;
  /** Codec short name, e.g. "h264", "aac", "hevc" */
  codec_name?: string;
  /** Codec long name, e.g. "H.264 / AVC / MPEG-4 AVC" */
  codec_long_name?: string;
  /** Stream profile, e.g. "High", "LC" */
  profile?: string;
  /** Stream type */
  codec_type?: StreamCodecType;
  /** Codec tag, e.g. "avc1" */
  codec_tag_string?: string;
  /** Codec tag hex, e.g. "0x31637661" */
  codec_tag?: string;

  // ── Video-specific ───────────────────────────────────────────────────────────
  /** Frame width in pixels */
  width?: number;
  /** Frame height in pixels */
  height?: number;
  /** Coded (padded) width */
  coded_width?: number;
  /** Coded height */
  coded_height?: number;
  /** Has B-frames */
  has_b_frames?: number;
  /** Sample/pixel aspect ratio, e.g. "1:1" */
  sample_aspect_ratio?: string;
  /** Display aspect ratio, e.g. "16:9" */
  display_aspect_ratio?: string;
  /** Pixel format, e.g. "yuv420p" */
  pix_fmt?: string;
  /** H.264/HEVC level */
  level?: number;
  /** Color range: tv or pc */
  color_range?: 'tv' | 'pc' | string;
  /** Color space, e.g. "bt709" */
  color_space?: string;
  /** Color transfer, e.g. "bt709" */
  color_transfer?: string;
  /** Color primaries, e.g. "bt709" */
  color_primaries?: string;
  /** Chroma sample location */
  chroma_location?: string;
  /** Field order */
  field_order?: 'progressive' | 'tt' | 'bb' | 'tb' | 'bt' | string;
  /** Refs */
  refs?: number;
  /** Average frame rate as fraction string, e.g. "30000/1001" */
  avg_frame_rate?: string;
  /** Real base frame rate, e.g. "60000/1001" */
  r_frame_rate?: string;
  /** Number of frames (string representation) */
  nb_frames?: string;

  // ── Audio-specific ───────────────────────────────────────────────────────────
  /** Audio sample rate, e.g. "48000" */
  sample_rate?: string;
  /** Number of audio channels */
  channels?: number;
  /** Channel layout string, e.g. "stereo", "5.1" */
  channel_layout?: string;
  /** Bits per sample */
  bits_per_sample?: number;
  /** Sample format, e.g. "fltp" */
  sample_fmt?: string;

  // ── Subtitle-specific ────────────────────────────────────────────────────────
  /** Subtitle width */
  //width?: number; // already declared above for video

  // ── Common timing fields ─────────────────────────────────────────────────────
  /** Codec timebase, e.g. "1/12800" */
  codec_time_base?: string;
  /** Time base, e.g. "1/1000" */
  time_base?: string;
  /** Start presentation time in time_base units */
  start_pts?: number;
  /** Start time in seconds (string) */
  start_time?: string;
  /** Duration in time_base units */
  duration_ts?: number;
  /** Duration in seconds (string) */
  duration?: string;
  /** Bit rate in bits/s (string) */
  bit_rate?: string;
  /** Max bit rate */
  max_bit_rate?: string;

  /** Stream disposition flags */
  disposition?: StreamDisposition;
  /** Stream metadata tags, e.g. language */
  tags?: Record<string, string>;
}

// ─── Format (container) ───────────────────────────────────────────────────────

/** Format info from ffprobe -show_format */
export interface ProbeFormat {
  /** File path */
  filename?: string;
  /** Number of streams */
  nb_streams?: number;
  /** Number of programs */
  nb_programs?: number;
  /** Container format short names (comma-separated), e.g. "matroska,webm" */
  format_name?: string;
  /** Container format long name */
  format_long_name?: string;
  /** Container start time in seconds */
  start_time?: string;
  /** Total duration in seconds */
  duration?: string;
  /** Total file size in bytes */
  size?: string;
  /** Overall bitrate in bits/s */
  bit_rate?: string;
  /** Probe score 0–100 */
  probe_score?: number;
  /** Container-level metadata tags */
  tags?: Record<string, string>;
}

// ─── Chapters ─────────────────────────────────────────────────────────────────

export interface ProbeChapter {
  id?: number;
  time_base?: string;
  start?: number;
  start_time?: string;
  end?: number;
  end_time?: string;
  tags?: Record<string, string>;
}

// ─── Full probe result ────────────────────────────────────────────────────────

/** Complete ffprobe JSON output */
export interface ProbeResult {
  streams: ProbeStream[];
  format?: ProbeFormat;
  chapters?: ProbeChapter[];
}

// ─── Derived/helper types ─────────────────────────────────────────────────────

/** Parsed, numeric frame rate derived from avg_frame_rate fraction */
/** Parsed frame rate from an ffprobe fraction string. */
export interface ParsedFrameRate {
  /** Numerator */
  num: number;
  /** Denominator */
  den: number;
  /** Floating-point value: num/den */
  value: number;
}

/** Convenience summary of a video stream */
export interface VideoStreamSummary {
  index: number;
  codec: string;
  width: number;
  height: number;
  fps: number;
  pixFmt: string;
  durationSec: number | null;
  bitrateBps: number | null;
  profile?: string;
  colorSpace?: string;
}

/** Convenience summary of an audio stream */
export interface AudioStreamSummary {
  index: number;
  codec: string;
  sampleRate: number;
  channels: number;
  channelLayout: string;
  durationSec: number | null;
  bitrateBps: number | null;
}
