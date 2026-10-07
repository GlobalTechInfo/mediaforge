import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EXTRA_TASKS } from '../../lib/cli/tasks.extra.ts';
import type { CliFlags } from '../../lib/cli/types.ts';

/**
 * The optional-argument branches of the CLI arg builders.
 *
 * Every builder spreads its options conditionally, so each optional key has two
 * paths and the "set" path is only taken when a caller actually passes the flag.
 * That left ~46 statements uncovered: `mediaforge args <op>` with only the
 * required keys never entered them.
 *
 * These go through the public `args` task rather than the private builders, so
 * they also cover the option-parsing layer (`key=value`, presence-only flags,
 * the accepted-keys check and the missing-required check).
 */

/** Run `mediaforge args <...>` and capture what it printed. */
async function runArgs(positional: string[], flags: CliFlags = {}): Promise<string> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...parts: unknown[]) => {
    lines.push(parts.map(String).join(' '));
  };
  try {
    await EXTRA_TASKS['args']!.run(positional, flags);
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

describe('args — global option branches', () => {
  it('includes overwrite, loglevel, progress, stats_interval and extra args', async () => {
    const out = await runArgs([
      'global', 'overwrite=1', 'logLevel=warning', 'progress=1', 'statsInterval=2', 'extraArgs=-threads 4',
    ]);
    assert.match(out, /-y/, 'overwrite should become -y');
    assert.match(out, /-loglevel/);
    assert.match(out, /-stats_period/);
    assert.match(out, /-threads 4/);
  });

  it('takes the no-overwrite branch', async () => {
    const out = await runArgs(['global', 'noOverwrite=1']);
    assert.match(out, /-n/);
  });

  it('falls back to the plain branch when neither overwrite nor loglevel is set', async () => {
    const out = await runArgs(['global', 'progress=1', 'statsInterval=1', 'extraArgs=-hide_banner']);
    assert.match(out, /-progress/);
    assert.match(out, /-hide_banner/);
  });
});

describe('args — optional keys on the muxers', () => {
  it('builds HLS arguments with every optional key set', async () => {
    const out = await runArgs([
      'hls',
      'input=in.mp4',
      'outputDir=out',
      'segmentDuration=6',
      'playlistName=index.m3u8',
      'hlsListSize=0',
      'hlsFlags=independent_segments',
      'videoCodec=libx264',
      'videoBitrate=2M',
      'audioCodec=aac',
      'audioBitrate=128k',
    ]);
    assert.match(out, /-hls_time 6/);
    assert.match(out, /index\.m3u8/);
    assert.match(out, /-hls_list_size 0/);
    assert.match(out, /independent_segments/);
    assert.match(out, /libx264/);
    assert.match(out, /aac/);
  });

  it('builds HLS arguments from the required keys alone', async () => {
    const out = await runArgs(['hls', 'input=in.mp4', 'outputDir=out']);
    assert.match(out, /-hls/);
  });

  it('builds DASH arguments with every optional key set', async () => {
    const out = await runArgs([
      'dash',
      'input=in.mp4',
      'output=out.mpd',
      'segmentDuration=4',
      'videoCodec=libx264',
      'videoBitrate=1M',
      'audioCodec=aac',
      'audioBitrate=96k',
    ]);
    assert.match(out, /-seg_duration 4/);
    assert.match(out, /libx264/);
    assert.match(out, /96k/);
  });

  it('builds GIF arguments with the optional timing keys', async () => {
    const out = await runArgs([
      'gif',
      'input=in.mp4',
      'palette=palette.png',
      'output=out.gif',
      'fps=15',
      'width=320',
      'dither=bayer',
      'startTime=2',
      'duration=3',
      'colors=128',
    ]);
    assert.match(out, /palette/);
    assert.match(out, /15/);
    assert.match(out, /bayer/);
  });

  it('builds GIF arguments from the required keys alone', async () => {
    // fps, width and dither are required too; startTime, duration and colors are
    // the genuinely optional ones, and omitting them must not break the build.
    const out = await runArgs(['gif', 'input=in.mp4', 'palette=p.png', 'output=out.gif', 'fps=10', 'width=240', 'dither=none']);
    assert.match(out, /palette/);
  });
});

describe('args — option validation', () => {
  it('lists every builder', async () => {
    const out = await runArgs([], { list: true });
    assert.match(out, /arg builders/);
    assert.match(out, /buildGlobalArgs/);
    assert.match(out, /buildHlsArgs/);
  });

  it('rejects an unknown builder', async () => {
    await assert.rejects(runArgs(['nope']), /unknown arg builder "nope"/);
  });

  it('rejects an option the builder does not accept', async () => {
    await assert.rejects(runArgs(['hls', 'input=a', 'outputDir=b', 'bogus=1']), /has no option "bogus"/);
  });

  it('rejects a missing required option', async () => {
    await assert.rejects(runArgs(['hls', 'input=a']), /requires outputDir=<value>/);
  });

  it('requires an op name', async () => {
    await assert.rejects(runArgs([]), /needs an op name/);
  });
});

describe('args — typed option coercion', () => {
  it('rejects a non-numeric value for a numeric option', async () => {
    await assert.rejects(runArgs(['hls', 'input=a', 'outputDir=b', 'segmentDuration=abc']), /must be a number/);
  });

  it('rejects malformed JSON for a JSON-valued option, naming the key', async () => {
    // `json()` parses the raw string, so a bad value has to surface the parse
    // error with the option name rather than failing later inside the builder.
    await assert.rejects(
      runArgs(['chapters', 'chapters={not json}']),
      /"chapters" must be valid JSON/,
    );
  });

  it('accepts a well-formed JSON option', async () => {
    const out = await runArgs(['chapters', 'chapters=[{"title":"Intro","start":0}]']);
    assert.match(out, /Intro/);
  });
});

describe('filter --chain spec parsing', () => {
  /**
   * The chain spec is validated before anything is spawned, so these throw
   * without needing a real encode. Only the validation is exercised here; the
   * happy path is covered by the CLI integration tests.
   */
  const filterRun = (flags: Record<string, unknown>): Promise<unknown> => {
    const original = console.log;
    console.log = () => {};
    return (EXTRA_TASKS['filter']!.run(['name', 'in.mp4', 'out.mp4'], flags as CliFlags) as Promise<unknown>)
      .finally(() => { console.log = original; });
  };

  it('rejects an unknown filter name and points at --list', async () => {
    await assert.rejects(
      filterRun({ chain: 'definitelynotafilter:k=1' }),
      /unknown filter "definitelynotafilter" in --chain/,
    );
  });

  it('rejects a filter that is missing a required option', async () => {
    await assert.rejects(filterRun({ chain: 'transpose' }), /filter "transpose" requires dir=<value>/);
  });

  it('requires positionals before it looks at the chain', async () => {
    const original = console.log;
    console.log = () => {};
    try {
      // `run` is typed `void | Promise<void>`, so wrap it to satisfy assert.rejects.
      await assert.rejects(
        async () => EXTRA_TASKS['filter']!.run([], { chain: 'scale:w=1,h=1' }),
        /needs 2 arguments/,
      );
    } finally {
      console.log = original;
    }
  });
});
