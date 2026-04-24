import { runFFmpeg } from '../process/spawn.js';
import { resolveBinary } from '../utils/binary.js';

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

  // Convert chapter definitions to ChapterMeta format
  const chapters: ChapterMeta[] = chapterDefs.map((ch, i) => {
    const nextChapter = chapterDefs[i + 1];
    return {
      title: ch.title,
      startSec: ch.start,
      endSec: nextChapter ? nextChapter.start : Number.MAX_SAFE_INTEGER,
    };
  });

  // Fix the last chapter end time by probing the file
  if (chapterDefs.length > 0) {
    const lastIdx = chapters.length - 1;
    if (chapters[lastIdx]!.endSec === Number.MAX_SAFE_INTEGER) {
      const { probe } = await import('../probe/ffprobe.js');
      const info = probe(input);
      const duration = parseFloat(info.format?.duration ?? '0');
      chapters[lastIdx]!.endSec = duration;
    }
  }

  return writeMetadata({ input, output, metadata: {}, chapters, binary });
}

export interface AddChaptersOptions {
  /** Input file path */
  input: string;
  /** Output file path */
  output: string;
  /** Chapter definitions with title and start time (in seconds) */
  chapters: {
    /** Chapter title */
    title: string;
    /** Start time in seconds */
    start: number;
  }[];
  /** ffmpeg binary override */
  binary?: string;
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
  let chapterInput: string | null = null;
  if (chapters.length > 0) {
    const { writeFileSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    chapterInput = join(tmpdir(), `chapters-${Date.now()}.txt`);
    let chapterContent = ';FFMETADATA1\n';
    for (const ch of chapters) {
      chapterContent += `\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(ch.startSec * 1000)}\nEND=${Math.round(ch.endSec * 1000)}\ntitle=${ch.title}\n`;
    }
    writeFileSync(chapterInput, chapterContent);
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
    if (chapterInput) {
      const { unlinkSync, existsSync } = await import('fs');
      if (existsSync(chapterInput)) unlinkSync(chapterInput);
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
    content += `\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(ch.startSec * 1000)}\nEND=${Math.round(ch.endSec * 1000)}\ntitle=${ch.title}\n`;
  }
  return content;
}
