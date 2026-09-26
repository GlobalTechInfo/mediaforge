/**
 * README claim tests.
 *
 * These lock in the documented behaviour of every example / signature that
 * appears in README.md, so the docs cannot silently drift from the source.
 *
 * Run with: node --import tsx/esm tests/unit/readme.claims.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as m from '../../dist/esm/index.js';

const README = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');

/** Strip JSDoc/line comments so we only inspect real declarations. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n');

/** GitHub heading slug rules: lowercase, strip punctuation, spaces → hyphens. */
const slugify = (heading: string) => heading
  .toLowerCase()
  .replace(/[`*_~]/g, '')
  .replace(/[^\w\s-]/g, '')
  .trim()
  .replace(/\s+/g, '-');

describe('README: screenshots & frame extraction', () => {
  it('extractFrames options are filename/format (not pattern/quality)', () => {
    const src = readFileSync(new URL('../../lib/helpers/screenshots.ts', import.meta.url), 'utf8');
    const body = stripComments(/export interface ExtractFramesOptions \{([\s\S]*?)\n\}/.exec(src)![1]);
    assert.match(body, /filename\?/, 'filename option must exist');
    assert.match(body, /format\?/, 'format option must exist');
    assert.doesNotMatch(body, /\bpattern\b/, 'pattern is not a real option');
    assert.doesNotMatch(body, /\bquality\b/, 'quality is not a real option');
    assert.doesNotMatch(README, /pattern: 'frame_%06d\.png'/, 'README still shows a bogus pattern option');
  });

  it('screenshots count-based throws when duration is unknown', () => {
    // Documents that parseDuration (not parseFloat) guards the N/A case.
    assert.equal(m.parseDuration('N/A'), null);
    assert.equal(m.parseDuration('120.5'), 120.5);
  });
});

describe('README: detectSilence', () => {
  it('uses threshold/duration and returns SilenceSegment[]', () => {
    const src = readFileSync(new URL('../../lib/helpers/normalize.ts', import.meta.url), 'utf8');
    const body = stripComments(/export interface DetectSilenceOptions \{([\s\S]*?)\n\}/.exec(src)![1]);
    assert.match(body, /threshold\?:/, 'threshold is the real option name');
    assert.doesNotMatch(body, /noiseLevel/, 'noiseLevel is not a real option');
    assert.doesNotMatch(body, /silenceOnly/, 'silenceOnly is not a real option');
    assert.doesNotMatch(README, /noiseLevel:/, 'README still uses noiseLevel');
    assert.doesNotMatch(README, /silence\.startTimes/, 'README still uses the wrong return shape');
  });

  it('the silence_end regex matches real ffmpeg output', () => {
    const src = readFileSync(new URL('../../lib/helpers/normalize.ts', import.meta.url), 'utf8');
    const re = /silence_end:\\s\*\(\[\\d\.\]\+\)\\s\*\\\|\\s\*silence_duration:\\s\*\(\[\\d\.\]\+\)/.source;
    // Build the same pattern the source uses and assert it matches ffmpeg's line.
    const pattern = new RegExp('silence_end:\\s*([\\d.]+)\\s*\\|\\s*silence_duration:\\s*([\\d.]+)');
    const lineText = '[silencedetect @ 0x1] silence_end: 12.300000 | silence_duration: 1.800000';
    const mm = pattern.exec(lineText);
    assert.ok(mm, `source pattern must match: ${re}\n${lineText}`);
    assert.equal(parseFloat(mm[1]!), 12.3);
    assert.equal(parseFloat(mm[2]!), 1.8);
    assert.match(src, /silence_duration/);
  });
});

describe('README: parseLoudnorm', () => {
  it('returns camelCase inputI/inputLra/inputTp/inputThresh', async () => {
    const r = await m.parseLoudnorm({
      input: '[Parsed_loudnorm] JSON {\n"input_i":"-23.5","input_lra":"7.0","input_tp":"-1.5","input_thresh":"-40.0"\n}',
      mode: 'output',
    });
    assert.deepEqual(Object.keys(r).sort(), ['inputI', 'inputLra', 'inputThresh', 'inputTp']);
    assert.equal(r.inputI, -23.5);
    assert.doesNotMatch(README, /loudness\.normalized/, 'README still shows the wrong return shape');
  });

  it('ParseLoudnormOptions has no `measures` field', () => {
    const src = readFileSync(new URL('../../lib/helpers/normalize.ts', import.meta.url), 'utf8');
    const body = stripComments(/export interface ParseLoudnormOptions \{([\s\S]*?)\n\}/.exec(src)![1]);
    assert.match(body, /mode\?:/, 'mode is the real option');
    assert.doesNotMatch(body, /measures/, 'measures is not a real option');
    assert.doesNotMatch(README, /measures: \['I'/, 'README still uses measures');
  });
});

describe('README: metadata', () => {
  it('addChapters documents start, with startSec accepted as an alias', () => {
    const src = readFileSync(new URL('../../lib/helpers/metadata.ts', import.meta.url), 'utf8');
    const body = stripComments(/export interface AddChaptersOptions \{([\s\S]*?)\n\}/.exec(src)![1]);
    assert.match(body, /chapters: \{[\s\S]*?title: string;[\s\S]*?start\?: number;[\s\S]*?\}\[\];/);
    // startSec is accepted as an alias, but the README must show `start`.
    assert.match(body, /startSec\?: number;/);
    const addChaptersExample = /await addChapters\(\{[\s\S]*?\n\}\);/.exec(README)![0];
    assert.doesNotMatch(addChaptersExample, /startSec:/, 'README addChapters example still uses startSec');
    assert.match(addChaptersExample, /start: 0/);
  });

  it('chapter titles cannot inject FFMETADATA keys', () => {
    const content = m.buildChapterContent([{ title: 'A\nSTART=9\nEND=9', startSec: 0, endSec: 1 }]);
    assert.equal(content.match(/^START=/gm)!.length, 1);
    assert.equal(content.match(/^END=/gm)!.length, 1);
  });
});

describe('README: hlsPackage', () => {
  it('hlsVersion is a real option and is validated', () => {
    const src = readFileSync(new URL('../../lib/helpers/hls.ts', import.meta.url), 'utf8');
    const body = stripComments(/export interface HlsOptions \{([\s\S]*?)\n\}/.exec(src)![1]);
    assert.match(body, /hlsVersion\?: number;/, 'hlsVersion must be a real HlsOptions field');
    assert.match(README, /hlsVersion: 3/, 'README should document hlsVersion');
    // It is a top-level muxer option, not an hls_flags entry: no *code sample*
    // may assign it via hlsFlags. (Prose that explains this is fine.)
    assert.doesNotMatch(README, /^\s*hlsFlags:.*hls_version/m, 'hls_version must not be passed via hlsFlags');
  });

  it('emits -f hls before the hls_* private options', () => {
    const b = m.ffmpeg('in.mp4').output('out/playlist.m3u8')
      .outputFormat('hls')
      .videoCodec('libx264')
      .addOutputOption('-hls_time', '6');
    const args = b.dry();
    assert.ok(args.indexOf('hls') < args.indexOf('-hls_time'), '-f hls must precede -hls_time');
  });
});

describe('README: waveform', () => {
  it('backgroundColor and mode are deprecated no-ops', () => {
    const src = readFileSync(new URL('../../lib/helpers/waveform.ts', import.meta.url), 'utf8');
    assert.match(src, /@deprecated/);
    // The generated filter must not contain the removed 7.1 parameters
    // (the words may still appear in the deprecation comment).
    const filterLine = stripComments(src).split('\n').filter(l => l.includes('showwavespic'))[0] ?? '';
    assert.doesNotMatch(filterLine, /bgcolor/, 'bgcolor is never emitted (removed in FFmpeg 7.1)');
    assert.doesNotMatch(filterLine, /:draw=/, 'draw is never emitted (removed in FFmpeg 7.1)');
    assert.doesNotMatch(README, /Only emitted when non-default/, 'README still claims bgcolor is emitted');
    // generateWaveform strips a leading '#'; the builder passes the colour through
    assert.equal(m.buildWaveformFilter(100, 50, '#ff0000', 'lin', 0),
      '[0:a:0]showwavespic=s=100x50:colors=#ff0000:scale=lin[v]');
  });
});

describe('README: arg builders', () => {
  it('buildScreenshotArgs emits -vframes before -s', () => {
    assert.deepEqual(m.buildScreenshotArgs('input.mp4', 'thumb.jpg', 3, '320x180'),
      ['-y', '-ss', '3', '-i', 'input.mp4', '-vframes', '1', '-s', '320x180', 'thumb.jpg']);
  });

  it('buildLoudnormFilter uses lowercase keys', () => {
    assert.equal(m.buildLoudnormFilter(-23, 7, -2), 'loudnorm=i=-23:lra=7:tp=-2');
  });

  it('buildSilenceDetectFilter and buildSceneSelectFilter', () => {
    assert.equal(m.buildSilenceDetectFilter(-40, 1.0), 'silencedetect=noise=-40dB:d=1');
    assert.equal(m.buildSceneSelectFilter(0.4), "select='gt(scene,0.4)',showinfo");
  });
});

describe('README: stream mapping DSL', () => {
  it('mapAVS uses an optional subtitle pad', () => {
    assert.deepEqual(m.mapAVS(0), ['-map', '0:v', '-map', '0:a', '-map', '0:s?']);
  });

  it('ss() third arg is a numeric stream index, not a language tag', () => {
    assert.equal(m.serializeSpecifier(m.ss(0, 'v', 0)), '0:v:0');
    assert.equal(m.serializeSpecifier(m.ss(1, 'a')), '1:a');
    assert.equal(m.serializeSpecifier(m.ss(0, 's', 0, true)), '-0:s:0');
    assert.doesNotMatch(README, /0:a:language:eng/, 'README claims a language selector that does not exist');
  });

  it('mapStream has a numeric overload returning the same args tuple', () => {
    assert.deepEqual(m.mapStream('0:a:1'), ['-map', '0:a:1']);
    assert.deepEqual((m.mapStream as (n: number, t: 'v', i: number) => ['-map', string])(0, 'v', 0), ['-map', '0:v:0']);
    assert.doesNotMatch(README, /numeric form, returns a bare string/);
  });
});

describe('README: filter graph API', () => {
  it('videoFilterChain() takes no arguments and serializes via methods', () => {
    const chain = m.videoFilterChain();
    // Calling it with a string is ignored (the factory takes no parameters).
    const asAny = m.videoFilterChain('scale=1280:720' as never);
    assert.equal(asAny.toString(), '', 'a fresh chain is empty — args are not accepted');
    chain.scale(1280, 720).unsharp(5, 5, 1.0);
    assert.equal(chain.toString(), 'scale=1280:720,unsharp=lx=5:ly=5:la=1');
  });

  it('audioFilterChain() serializes positionally', () => {
    const af = m.audioFilterChain().loudnorm(-23, 7, -2).highpass(80);
    assert.equal(af.toString(), 'loudnorm=i=-23:lra=7:tp=-2,highpass=f=80');
  });

  it('resetLabelCounter is a deprecated no-op', () => {
    assert.equal(m.resetLabelCounter(), undefined);
    const src = readFileSync(new URL('../../lib/filters/complex.ts', import.meta.url), 'utf8');
    assert.match(src, /@deprecated[\s\S]*?no-op/);
  });
});

describe('README: filter overload styles', () => {
  const videoSrc = readFileSync(new URL('../../lib/filters/video/index.ts', import.meta.url), 'utf8');
  const audioSrc = readFileSync(new URL('../../lib/filters/audio/index.ts', import.meta.url), 'utf8');

  it('dual-style audio filters work standalone and chained', () => {
    for (const n of ['atempo', 'bass', 'equalizer', 'headphones', 'loudnorm', 'sofalizer', 'treble', 'volume'] as const) {
      assert.ok((audioSrc as string).includes(`export function ${n}(`), `${n} should exist`);
    }
    assert.equal(m.bass({ gain: 4 }), 'bass=g=4');
    assert.equal(m.loudnorm({ i: -16, lra: 11 }), 'loudnorm=i=-16:lra=11');
  });

  it('chained-only audio filters require a FilterChain and throw without one', () => {
    const chain = new m.FilterChain();
    m.highpass(chain, 80);
    assert.equal(chain.toString(), 'highpass=f=80');
    // Documented as a TypeError in the README.
    assert.throws(() => (m.highpass as (o: unknown) => unknown)({ frequency: 80 }));
    assert.throws(() => (m.lowpass as (o: unknown) => unknown)({ frequency: 80 }));
  });

  it('dual-style video filters accept both forms', () => {
    assert.equal(m.scale({ w: 320, h: 180 }), 'scale=320:180');
    assert.equal(m.crop({ w: 100, h: 50 }), 'crop=100:50');
    assert.equal(m.crop({ width: 100, height: 50 }), 'crop=100:50');
    const chain = new m.FilterChain();
    m.scale(chain, { w: 1280, h: 720 });
    assert.equal(chain.toString(), 'scale=1280:720');
  });

  it('chained-only video filters throw without a chain', () => {
    assert.throws(() => (m.unsharp as unknown as (...a: unknown[]) => unknown)(5, 5, 1.0));
    assert.throws(() => (m.hflip as unknown as (...a: unknown[]) => unknown)());
  });

  it('the documented dual/chained lists match the source signatures', () => {
    const classify = (src: string) => {
      const lines = src.split('\n');
      const out: Record<string, 'dual' | 'chained'> = {};
      for (let i = 0; i < lines.length; i++) {
        if (!/^export function [A-Za-z0-9_]+\(/.test(lines[i])) continue;
        let sig = lines[i];
        let j = i;
        while (!sig.includes('{') && j + 1 < lines.length) { j++; sig += ' ' + lines[j]!.trim(); }
        const mm = /^export function ([A-Za-z0-9_]+)\((.*)\)\s*:\s*.+?\{/.exec(sig.replace(/\s+/g, ' '));
        if (!mm) continue;
        const first = mm[2]!.split(',')[0]!.trim();
        out[mm[1]!] = /^chain\s*:\s*FilterChain$/.test(first) ? 'chained'
          : /chainOr\w*\??\s*:/.test(first) && /FilterChain/.test(first) ? 'dual'
          : 'dual';
      }
      return out;
    };
    const v = classify(videoSrc);
    const a = classify(audioSrc);
    // `colorlevels` is not re-exported from the package index; it is reachable
    // only through the deprecated alias `levels`.
    delete v['colorlevels'];
    v['levels'] = 'dual';

    // Build name -> documented style from every table row that carries a style
    // marker. A row qualifies if one of its cells is 'dual' / 'chained'
    // (possibly bolded or with a parenthetical). Each filter appears on
    // exactly one such row.
    const documented = new Map<string, 'dual' | 'chained'>();
    for (const row of README.split('\n')) {
      if (!row.trim().startsWith('|')) continue;
      const cells = row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const styleCell = cells.find(c => /^\*{0,2}(Dual|Chained only|dual|chained)\b/i.test(c));
      if (styleCell === undefined) continue;
      const style = /^chained/i.test(styleCell.replace(/\*/g, '')) ? 'chained' : 'dual';
      // Match `` `name` `` and `` `name(opts)` `` alike.
      for (const mm of row.matchAll(/`([A-Za-z0-9_]+)(?:\([^`]*\))?`/g)) {
        documented.set(mm[1]!, style);
      }
    }

    for (const [n, style] of Object.entries(v)) {
      if (n === 'pad') continue; // `pad` is also a builder method / label factory
      assert.equal(documented.get(n), style, `video filter ${n}: source=${style}, README=${documented.get(n)}`);
    }
    for (const [n, style] of Object.entries(a)) {
      assert.equal(documented.get(n), style, `audio filter ${n}: source=${style}, README=${documented.get(n)}`);
    }

    // Every exported filter must appear in the inventory, and the counts stated
    // in the README must match the real export lists.
    const idx = readFileSync(new URL('../../lib/index.ts', import.meta.url), 'utf8');
    const exported = (re: RegExp) => re.exec(idx)![1]!.split(',')
      .map(x => x.trim()).filter(Boolean).map(x => x.split(/\s+as\s+/).pop()!);
    const videoExports = exported(/export \{([^}]*)\} from '\.\/filters\/video\/index\.ts'/);
    const audioExports = exported(/export \{([^}]*)\} from '\.\/filters\/audio\/index\.ts'/);
    const m2 = m as unknown as Record<string, unknown>;
    for (const n of [...videoExports, ...audioExports]) {
      assert.equal(typeof m2[n], 'function', `${n} should be exported as a function`);
    }
    const inv = /\*\*(\d+) built-in filters\*\* \((\d+) video \+ (\d+) audio\)/.exec(README);
    assert.ok(inv, 'the filter-count summary must be present');
    assert.equal(Number(inv[2]), videoExports.length, 'video filter count in the summary');
    assert.equal(Number(inv[3]), audioExports.length, 'audio filter count in the summary');
    assert.equal(Number(inv[1]), videoExports.length + audioExports.length, 'total filter count in the summary');

    const inventory = /\*\*\d+ built-in filters\*\*[\s\S]*?\*Audio \(\d+\):\*([^\n]*)/.exec(README)![1]
      + /\*\*\d+ built-in filters\*\*[\s\S]*?\*Video \(\d+\):\*([^\n]*)/.exec(README)![1];
    for (const n of [...videoExports, ...audioExports]) {
      assert.ok(inventory.includes(n), `${n} missing from the filter inventory`);
    }
    assert.equal(audioExports.length, 26, '26 audio filters');
  });

  it('README does not claim all filters support both styles', () => {
    assert.doesNotMatch(README, /All filter functions work in two modes/);
    assert.doesNotMatch(README, /All support two overload styles/);
  });
});

describe('README: levels alias', () => {
  it('levels is a deprecated alias that emits the colorlevels filter', () => {
    const out = m.levels({ inBlack: 10, inWhite: 240 });
    assert.match(out, /^colorlevels=/);
    assert.equal(m.levels, (m as unknown as Record<string, unknown>)['levels']);
    const src = readFileSync(new URL('../../lib/filters/video/index.ts', import.meta.url), 'utf8');
    assert.match(src, /@deprecated Use `colorlevels` instead/);
  });
});

describe('README: repeated filter calls', () => {
  it('calling audioFilter twice appends two -af flags (docs warn about this)', () => {
    const args = m.ffmpeg('in.mp4').output('out.mp4')
      .audioFilter('volume=2')
      .audioFilter('alimiter')
      .dry();
    assert.equal(args.filter(a => a === '-af').length, 2);
    assert.match(README, /Do not call `\.audioFilter\(\)` \/ `\.videoFilter\(\)` more than once/);
  });
});

describe('README: builder surface', () => {
  it('documents every public builder method', () => {
    const methods = Object.getOwnPropertyNames(m.FFmpegBuilder.prototype)
      .filter(n => n !== 'constructor' && !n.startsWith('_') && n !== 'ensureOutput'); // ensureOutput is private
    for (const name of methods) {
      assert.ok(README.includes(`.${name}(`), `builder method .${name}() is undocumented`);
    }
  });

  it('records the run/spawn option shape', () => {
    const b = m.ffmpeg('in.mp4').output('out.mp4');
    assert.deepEqual(b.dry(), ['-y', '-i', 'in.mp4', 'out.mp4'], 'overwrite defaults to true');
  });
});

describe('README: getDefaultRegistry', () => {
  it('honours the binary argument on every call', () => {
    const a = m.getDefaultRegistry('/bin/ffmpeg-a');
    const b = m.getDefaultRegistry('/bin/ffmpeg-b');
    assert.notEqual(a, b);
    assert.equal(m.getDefaultRegistry('/bin/ffmpeg-a'), a);
  });
});

describe('README: progress events', () => {
  it('start event is observable after listeners attach', async () => {
    const proc = m.spawnFFmpeg({ binary: 'true', args: [] });
    const args = await new Promise<string[]>((res) => proc.emitter.on('start', res));
    assert.ok(Array.isArray(args));
    await new Promise((res) => proc.emitter.on('end', res));
  });

  it('N/A progress fields become 0, never NaN', () => {
    const [p] = m.parseAllProgress('frame=N/A\nout_time_us=N/A\nprogress=continue\n', 10_000_000);
    assert.equal(p.frame, 0);
    assert.equal(p.outTimeUs, 0);
    assert.ok(Number.isFinite(p.percent!));
  });
});

describe('README: CLI', () => {
  it('documents every flag the CLI parses', () => {
    const src = readFileSync(new URL('../../lib/cli/index.ts', import.meta.url), 'utf8');
    for (const flag of ['--ffmpeg', '--ffprobe', '--hwaccel', '--hwaccel-device', '--progress']) {
      assert.ok(README.includes(flag), `${flag} is undocumented`);
      assert.ok(src.includes(flag), `${flag} not found in CLI source`);
    }
    for (const sub of ['version', 'probe', 'caps', 'help']) {
      assert.ok(src.includes(`subcommand === '${sub}'`), `subcommand ${sub}`);
    }
  });
});

describe('README: environment variables', () => {
  it('documents both env vars the library reads', () => {
    const src = readFileSync(new URL('../../lib/utils/binary.ts', import.meta.url), 'utf8');
    for (const v of ['FFMPEG_PATH', 'FFPROBE_PATH']) {
      assert.ok(src.includes(v));
      assert.ok(README.includes(v), `${v} undocumented`);
    }
  });
});

describe('README: internal consistency', () => {
  it('table of contents links to sections that exist', () => {
    const toc = /## Table of Contents([\s\S]*?)\n---/.exec(README)![1];
    const links = [...toc.matchAll(/\[([^\]]+)\]\(#([a-z0-9-]+)\)/g)];
    assert.ok(links.length > 25, 'TOC should be substantial');
    // Collect the slugs of every real heading plus any explicit <a name> anchors.
    const slugs = new Set<string>();
    for (const h of README.matchAll(/^#{1,6} (.+)$/gm)) slugs.add(slugify(h[1]!));
    for (const a of README.matchAll(/<a name="([^"]+)"><\/a>/g)) slugs.add(a[1]!);
    for (const [, label, slug] of links) {
      assert.ok(slugs.has(slug), `TOC entry "${label}" → #${slug} has no matching heading or anchor`);
    }
  });

  it('drops stale (v0.3.0) version labels', () => {
    assert.doesNotMatch(README, /v0\.3\.0/);
  });

  it('every markdown table row has a consistent column count', () => {
    const rows = README.split('\n');
    let inTable = false;
    let expected = 0;
    for (const r of rows) {
      const isRow = /^\|.*\|\s*$/.test(r);
      if (!isRow) { inTable = false; continue; }
      const cols = r.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).length;
      if (!inTable) { inTable = true; expected = cols; }
      else assert.equal(cols, expected, `ragged table row: ${r.slice(0, 90)}`);
    }
  });
});
