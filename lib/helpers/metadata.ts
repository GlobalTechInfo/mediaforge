import { runFFmpeg } from '../process/spawn.ts';
import { resolveBinary } from '../utils/binary.ts';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { probeAsync, parseDuration } from '../probe/ffprobe.ts';

export interface WriteMetadataOptions {
  /** Input file */
  input: string;
  /** Output file */
  output: string;
  /** Container-level metadata */
  metadata: Record<string, string>;
  /** Per-stream metadata: key is stream specifier e.g. 'v:0', 'a:0', 's:0' */
  streamMetadata?: Record<string, Record<string, string>>;
  /** Chapter definitions */
  chapters?: ChapterMeta[];
  /** ffmpeg binary override */
  binary?: string;
}

export interface ChapterMeta {
  /** Chapter title */
  title: string;
  /** Start time in seconds */
  startSec: number;
  /** End time in seconds */
  endSec: number;
}

export interface AddChaptersOptions {
  /** Input file path */
  input: string;
  /** Output file path */
  output: string;
  /**
   * Chapter definitions with title and start time (in seconds).
   *
   * `start` is canonical, but `startSec` is also accepted because that is the
   * name used by {@link ChapterMeta} and is what callers naturally reach for.
   * Passing neither produces a clear error instead of writing `START=NaN`.
   */
  chapters: {
    /** Chapter title */
    title: string;
    /** Start time in seconds */
    start?: number;
    /** Start time in seconds (alias for `start`) */
    startSec?: number;
  }[];
  /** ffmpeg binary override */
  binary?: string;
}

/**
 * Convenience wrapper to add chapters from chapter timestamps.
 * Automatically creates chapter metadata and writes to output file.
 *
 * @example
 * // Add chapters at specific timestamps
 * await addChapters({
 *   input: 'video.mp4',
 *   output: 'chapters.mp4',
 *   chapters: [
 *     { title: 'Introduction', start: 0 },
 *     { title: 'Chapter 1: Getting Started', start: 60 },
 *     { title: 'Chapter 2: Advanced Topics', start: 300 },
 *     { title: 'Conclusion', start: 540 },
 *   ]
 * });
 */
export async function addChapters(opts: AddChaptersOptions): Promise<void> {
  const {
    input,
    output,
    chapters: chapterDefs,
    binary = resolveBinary(),
  } = opts;

  // Resolve `start` / `startSec` once, then validate. Without this a missing or
  // misspelled key silently wrote START=NaN, and out-of-order chapters made
  // ffmpeg fail with the very unhelpful "Chapter end time 1000 before start 2000"
  // / "Cannot allocate memory".
  if (!Array.isArray(chapterDefs) || chapterDefs.length === 0) {
    throw new Error('addChapters requires at least one chapter');
  }

  const starts = chapterDefs.map((ch, i) => {
    if (typeof ch?.title !== 'string' || ch.title.trim() === '') {
      throw new Error(`addChapters: chapter ${i} is missing a non-empty "title"`);
    }
    const start = typeof ch.start === 'number' ? ch.start : ch.startSec;
    if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) {
      throw new Error(
        `addChapters: chapter ${i} ("${ch.title}") needs a finite, non-negative start ` +
          'time in seconds, passed as `start` (or `startSec`).',
      );
    }
    return start;
  });

  for (let i = 1; i < starts.length; i++) {
    const prev = starts[i - 1]!;
    const cur = starts[i]!;
    if (cur < prev) {
      throw new Error(
        `addChapters: chapters must be in ascending time order — chapter ${i} ` +
          `("${chapterDefs[i]!.title}", start ${cur}) starts before chapter ${i - 1} ` +
          `("${chapterDefs[i - 1]!.title}", start ${prev}).`,
      );
    }
  }

  // Convert chapter definitions to ChapterMeta format
  const chapters: ChapterMeta[] = starts.map((startSec, i) => {
    const nextStart = starts[i + 1];
    return {
      title: chapterDefs[i]!.title,
      startSec,
      endSec: nextStart !== undefined ? nextStart : Number.MAX_SAFE_INTEGER,
    };
  });

  // Fix the last chapter end time by probing the file
  if (chapterDefs.length > 0) {
    const lastIdx = chapters.length - 1;
    if (chapters[lastIdx]!.endSec === Number.MAX_SAFE_INTEGER) {
      const info = await probeAsync(input);
      // parseFloat('N/A') is NaN, which would emit a bogus END= value.
      chapters[lastIdx]!.endSec = parseDuration(info.format?.duration) ?? 0;
    }
  }

  return writeMetadata({ input, output, metadata: {}, chapters, binary });
}

/**
 * Write metadata tags to a file without re-encoding.
 *
 * @example
 * await writeMetadata({
 *   input: 'video.mp4',
 *   output: 'tagged.mp4',
 *   metadata: { title: 'My Film', artist: 'Director', year: '2025' },
 * });
 */
export async function writeMetadata(opts: WriteMetadataOptions): Promise<void> {
  const {
    input,
    output,
    metadata,
    streamMetadata = {},
    chapters = [],
    binary = resolveBinary(),
  } = opts;

  const args: string[] = ['-y', '-i', input];

  // Add chapter file if chapters provided
  let chapterTmpDir: string | null = null;
  let chapterInput: string | null = null;
  if (chapters.length > 0) {
    chapterTmpDir = mkdtempSync(join(tmpdir(), 'mediaforge-chapters-'));
    try {
      chapterInput = join(chapterTmpDir, 'chapters.txt');
      writeFileSync(chapterInput, buildChapterContent(chapters));
    } catch (err) {
      // Never leave the temp dir behind if writing the chapter file fails.
      try { rmSync(chapterTmpDir, { recursive: true, force: true }); } catch { /* cleanup */ }
      chapterTmpDir = null;
      throw err;
    }
    args.push('-i', chapterInput, '-map_chapters', '1');
  }

  args.push('-c', 'copy', '-map_metadata', '0');

  // Container metadata
  for (const [k, v] of Object.entries(metadata)) {
    args.push('-metadata', `${k}=${v}`);
  }

  // Stream metadata
  for (const [spec, tags] of Object.entries(streamMetadata)) {
    for (const [k, v] of Object.entries(tags)) {
      args.push(`-metadata:s:${spec}`, `${k}=${v}`);
    }
  }

  args.push(output);

  try {
    await runFFmpeg({ binary, args });
  } finally {
    if (chapterTmpDir) {
      if (existsSync(chapterTmpDir)) rmSync(chapterTmpDir, { recursive: true, force: true });
    }
  }
}

/**
 * Strip ALL metadata from a file (privacy-safe export).
 *
 * @example
 * await stripMetadata({ input: 'original.mp4', output: 'clean.mp4' });
 */
export interface StripMetadataOptions {
  input: string;
  output: string;
  binary?: string;
}

export async function stripMetadata(opts: StripMetadataOptions): Promise<void> {
  const { input, output, binary = resolveBinary() } = opts;
  await runFFmpeg({
    binary,
    args: ['-y', '-i', input, '-c', 'copy', '-map_metadata', '-1', '-map_chapters', '-1', output],
  });
}

// ─── Arg builders ─────────────────────────────────────────────────────────────

export function buildMetadataArgs(
  metadata: Record<string, string>,
  streamMetadata?: Record<string, Record<string, string>>,
): string[] {
  const args: string[] = ['-c', 'copy', '-map_metadata', '0'];
  for (const [k, v] of Object.entries(metadata)) args.push('-metadata', `${k}=${v}`);
  for (const [spec, tags] of Object.entries(streamMetadata ?? {})) {
    for (const [k, v] of Object.entries(tags)) args.push(`-metadata:s:${spec}`, `${k}=${v}`);
  }
  return args;
}

export function buildChapterContent(chapters: ChapterMeta[]): string {
  let content = ';FFMETADATA1\n';
  for (const ch of chapters) {
    content += `\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(ch.startSec * 1000)}\nEND=${Math.round(ch.endSec * 1000)}\ntitle=${escapeFfmetadataValue(ch.title)}\n`;
  }
  return content;
}

/**
 * Neutralize characters that would break out of the FFMETADATA1 format.
 * A newline (or a leading '#'/';' comment marker) in a chapter title would
 * otherwise let the title inject arbitrary metadata keys or sections.
 */
function escapeFfmetadataValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/[\r\n]+/g, ' ')
    .replace(/^([#;])/, '\\$1');
}
