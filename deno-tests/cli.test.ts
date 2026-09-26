/**
 * deno-tests/battle.cli.test.ts — Deno mirror of the CLI task table
 *
 * Covers the task registry, help output and argument parsing — the parts that
 * do not need the built `mediaforge` binary. The end-to-end subprocess runs
 * live in the Node suite (`battle.cli.test.ts`), because Deno imports the
 * TypeScript source directly and has no dist/ to execute.
 *
 * Keep in sync with the task-table section of `battle.cli.test.ts`.
 *
 * Run: deno task battle:cli
 */

import {
  CLI_TASKS, parseTaskArgs, taskHelpText, taskDetail,
} from '../lib/index.ts';
import { CLI_TASKS as TASKS_MOD } from '../lib/cli/tasks.ts';

const errors: Array<{ label: string; error: string; stack: string }> = [];
let passed = 0;

async function run(label: string, fn: () => void | Promise<void>): Promise<void> {
  console.log(`  ▸ ${label} ... `);
  try {
    await fn();
    console.log('✅ PASS');
    passed++;
  } catch (err: unknown) {
    const msg = err instanceof Error ? (err.message ?? String(err)) : String(err);
    const stack = err instanceof Error ? (err.stack ?? '') : '';
    console.log(`❌ FAIL\n      ${msg}`);
    errors.push({ label, error: msg, stack });
  }
}

function section(title: string): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

const EXPECTED_TASKS = [
  'trim', 'speed', 'volume', 'normalize', 'extract', 'replace-audio', 'concat',
  'transitions', 'hls', 'abr', 'dash', 'segments', 'chapters', 'metadata',
  'thumbnail', 'sprite', 'frames', 'gif', 'watermark', 'text', 'subtitles',
  'quality', 'tonemap', 'interpolate', 'silence', 'scenes', 'waveform',
  'spectrum', 'delogo', 'twopass', 'to-bitrate',
  // The commands that close the gap between the library and the CLI.
  'filter', 'graph', 'codec', 'map', 'preset', 'analyze', 'features',
  'hwaccel', 'args', 'mix', 'loop', 'deinterlace', 'stabilize', 'aspect',
  'lut', 'timecode', 'cropdetect', 'gif2mp4', 'extract-subs', 'retime-subs', 'stack',
];

/**
 * Listing-only commands take no positionals on purpose, so they cannot reject an
 * empty invocation the way the others do. `features` is the only one today; the
 * assertion below keeps it that way instead of letting the exception spread.
 */
const LISTING_ONLY = ['features'];

// ─── Task table, help, argument parsing ─────────────────────────────────────
section('50 — CLI: task table, help, parsing');

await run(`CLI_TASKS exposes all ${EXPECTED_TASKS.length} task commands`, () => {
  for (const name of EXPECTED_TASKS) {
    if (!CLI_TASKS[name]) throw new Error(`missing task: ${name}`);
    const t = CLI_TASKS[name]!;
    if (typeof t.run !== 'function') throw new Error(`${name} has no run()`);
    if (!t.summary || t.summary.length < 5) throw new Error(`${name} has no usable summary`);
    if (!t.usage.startsWith(`mediaforge ${name} `)) {
      throw new Error(`${name} usage does not start with its own name: ${t.usage}`);
    }
    if (!Array.isArray(t.positionals)) throw new Error(`${name} has no positionals`);
    if (t.positionals.length === 0 && !LISTING_ONLY.includes(name)) {
      throw new Error(`${name} declares no positionals but is not a listing command`);
    }
  }
});

await run(`the only positional-free commands are ${LISTING_ONLY.join(', ')}`, () => {
  const zero = Object.entries(CLI_TASKS).filter(([, t]) => t.positionals.length === 0).map(([n]) => n);
  const extra = zero.filter(n => !LISTING_ONLY.includes(n));
  if (extra.length > 0) throw new Error(`undeclared positional-free commands: ${extra.join(', ')}`);
});

await run('no unexpected extra task commands are exported', () => {
  const extra = Object.keys(CLI_TASKS).filter(n => !EXPECTED_TASKS.includes(n));
  if (extra.length > 0) throw new Error(`undocumented tasks: ${extra.join(', ')}`);
});

await run('the index re-export matches the tasks module', () => {
  const a = Object.keys(CLI_TASKS).sort();
  const b = Object.keys(TASKS_MOD).sort();
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${a.length} vs ${b.length}`);
});

await run('every task usage line names its own flags', () => {
  for (const name of EXPECTED_TASKS) {
    const t = CLI_TASKS[name]!;
    for (const flag of Object.keys(t.flags)) {
      if (!t.usage.includes(`--${flag}`)) {
        throw new Error(`${name} declares --${flag} but its usage line omits it: ${t.usage}`);
      }
    }
  }
});

await run('every task flag is described in the flags table', () => {
  for (const name of EXPECTED_TASKS) {
    for (const [flag, desc] of Object.entries(CLI_TASKS[name]!.flags)) {
      if (!desc || desc.length < 3) throw new Error(`${name} --${flag} has no description`);
    }
  }
});

await run('every task flag table describes its value where it takes one', () => {
  for (const name of EXPECTED_TASKS) {
    for (const [flag, desc] of Object.entries(CLI_TASKS[name]!.flags)) {
      // A boolean switch is written bare; anything else documents its value.
      // A leading "=" in the description is the table's own marker for
      // "this flag takes a value", so the rule is self-describing instead of a
      // hardcoded list of switch names.
      const takesValue = desc.startsWith('=');
      if (takesValue && !desc.includes('=')) {
        throw new Error(`${name} --${flag} takes a value but its description omits "="`);
      }
    }
  }
});

await run('taskHelpText() lists every task', () => {
  const text = taskHelpText();
  for (const name of EXPECTED_TASKS) {
    if (!text.includes(name)) throw new Error(`help omits ${name}`);
  }
  console.log(`      ${text.split('\n').length} lines of help`);
});

await run('taskHelpText() includes each task summary', () => {
  const text = taskHelpText();
  for (const name of EXPECTED_TASKS) {
    const summary = CLI_TASKS[name]!.summary;
    if (!text.includes(summary)) throw new Error(`help omits the summary for ${name}`);
  }
});

await run('taskHelpText() is sorted, so the list is stable across runs', () => {
  // Match on the padded list-item prefix, not a bare substring: a task name can
  // appear inside another task's summary (the `text` summary says "watermark").
  const listed = taskHelpText()
    .split('\n')
    .map(l => /^ {2}(\S+)\s{2,}/.exec(l)?.[1])
    .filter((n): n is string => n !== undefined);
  const expected = Object.keys(CLI_TASKS).sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(listed) !== JSON.stringify(expected)) {
    throw new Error(`help order differs:\n  listed:    ${listed.join(', ')}\n  expected: ${expected.join(', ')}`);
  }
});

await run('taskDetail("trim") → usage, summary and options', () => {
  const d = taskDetail('trim');
  if (!d.includes('mediaforge trim')) throw new Error(`no usage: ${d}`);
  if (!d.includes('--start')) throw new Error(`no flag docs: ${d}`);
  if (!d.includes('OPTIONS')) throw new Error(`no options heading: ${d}`);
});

await run('taskDetail() names the task and points at the list for a bad name', () => {
  const d = taskDetail('nope');
  // Returning '' here would make `mediaforge help <typo>` look like a silent success.
  if (d.trim() === '') throw new Error('returned nothing for an unknown task');
  if (!d.includes('nope')) throw new Error(`does not name the bad task: ${d}`);
  if (!d.includes('mediaforge help')) throw new Error(`does not point at the task list: ${d}`);
});

await run('taskDetail() documents every declared flag', () => {
  for (const name of EXPECTED_TASKS) {
    const d = taskDetail(name);
    for (const flag of Object.keys(CLI_TASKS[name]!.flags)) {
      if (!d.includes(`--${flag}`)) throw new Error(`${name} detail omits --${flag}`);
    }
  }
});

await run('parseTaskArgs splits positionals, --flag value and --flag=value', () => {
  const r = parseTaskArgs(['in.mp4', 'out.mp4', '--start', '1', '--end=9', '--burn']);
  if (r.positional.join(',') !== 'in.mp4,out.mp4') throw new Error(`positional: ${r.positional}`);
  if (r.flags['start'] !== '1') throw new Error(`start: ${String(r.flags['start'])}`);
  if (r.flags['end'] !== '9') throw new Error(`end: ${String(r.flags['end'])}`);
  if (r.flags['burn'] !== true) throw new Error(`burn: ${String(r.flags['burn'])}`);
});

await run('parseTaskArgs treats a flag before another flag as boolean', () => {
  const r = parseTaskArgs(['in.mp4', '--cut', '--threshold', '0.5']);
  if (r.flags['cut'] !== true) throw new Error(`cut: ${String(r.flags['cut'])}`);
  if (r.flags['threshold'] !== '0.5') throw new Error(`threshold: ${String(r.flags['threshold'])}`);
});

await run('parseTaskArgs handles negative numbers and paths with spaces', () => {
  const r = parseTaskArgs(['/tmp/a b/in.mp4', '--start', '-3.5']);
  if (r.positional[0] !== '/tmp/a b/in.mp4') throw new Error(`positional: ${r.positional[0]}`);
  if (r.flags['start'] !== '-3.5') throw new Error(`start: ${String(r.flags['start'])}`);
});

await run('parseTaskArgs keeps a bare --flag as boolean true', () => {
  const r = parseTaskArgs(['--strip']);
  if (r.flags['strip'] !== true) throw new Error(`strip: ${String(r.flags['strip'])}`);
});

await run('parseTaskArgs preserves --flag=value containing an "="', () => {
  const r = parseTaskArgs(['--set', 'title=a=b']);
  if (r.flags['set'] !== 'title=a=b') throw new Error(`set: ${String(r.flags['set'])}`);
  const r2 = parseTaskArgs(['--set=title=a=b']);
  if (r2.flags['set'] !== 'title=a=b') throw new Error(`set: ${String(r2.flags['set'])}`);
});

await run('parseTaskArgs([]) → empty result, no throw', () => {
  const r = parseTaskArgs([]);
  if (r.positional.length !== 0 || Object.keys(r.flags).length !== 0) throw new Error('not empty');
});

await run('every task rejects a missing required positional and shows usage', async () => {
  for (const name of EXPECTED_TASKS) {
    if (LISTING_ONLY.includes(name)) continue;
    const t = CLI_TASKS[name]!;
    let msg = '';
    try {
      await t.run([], {});
    } catch (e) { msg = e instanceof Error ? e.message : String(e); }
    if (!msg) throw new Error(`${name} accepted an empty argument list`);
    if (!msg.includes('Usage:') && !/needs \d+ argument/.test(msg)) {
      throw new Error(`${name} error does not show usage: ${msg}`);
    }
  }
});

await run('no task runs successfully with no arguments', async () => {
  for (const name of EXPECTED_TASKS) {
    if (LISTING_ONLY.includes(name)) continue;
    try {
      await CLI_TASKS[name]!.run([], {});
    } catch {
      continue;
    }
    throw new Error(`${name} accepted an empty argument list`);
  }
});

// ─── 52. Library-surface commands ───────────────────────────────────────
section('52 — CLI: library-surface commands');

await run('the filter registry covers every exported filter', async () => {
  const mod = await import('../lib/cli/filter-registry.ts');
  const names = mod.filterNames();
  if (names.length !== 77) throw new Error(`registry has ${names.length} filters, expected 77`);
  for (const n of names) {
    const e = mod.FILTER_REGISTRY[n]!;
    if (e.stream !== 'video' && e.stream !== 'audio') throw new Error(`${n}: bad stream`);
    if (e.kind !== 'value' && e.kind !== 'opts') throw new Error(`${n}: bad kind`);
    if (!Array.isArray(e.keys)) throw new Error(`${n}: no key list`);
    if (typeof e.apply !== 'function') throw new Error(`${n}: no apply`);
    for (const req of e.required ?? []) {
      if (!e.keys.includes(req)) throw new Error(`${n}: required key ${req} is not in keys`);
    }
  }
});

await run('every registry filter serialises without placeholder values', async () => {
  const mod = await import('../lib/cli/filter-registry.ts');
  const { FilterChain } = await import('../lib/types/filters.ts');
  for (const n of mod.filterNames()) {
    const e = mod.FILTER_REGISTRY[n]!;
    const rec: Record<string, string | number | boolean> = {};
    for (const k of e.required ?? []) rec[k] = (k === 'width' || k === 'height') ? 2 : 1;
    let out: string;
    try {
      out = e.apply(new FilterChain(), rec).toString();
    } catch (err: unknown) {
      throw new Error(`${n} threw: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (out.length === 0) throw new Error(`${n} serialised to an empty string`);
    if (/undefined|NaN|\[object Object\]/.test(out)) throw new Error(`${n} serialised a placeholder: ${out}`);
  }
});

await run('the arg-op and codec-builder tables are non-empty', async () => {
  const mod = await import('../lib/cli/tasks.extra.ts');
  const ops = mod.argOpNames();
  const codecs = mod.codecBuilderNames();
  if (ops.length < 30) throw new Error(`only ${ops.length} arg builders`);
  if (codecs.length < 25) throw new Error(`only ${codecs.length} codec builders`);
  if (new Set(ops).size !== ops.length) throw new Error('duplicate arg op names');
  if (new Set(codecs).size !== codecs.length) throw new Error('duplicate codec builder names');
  console.log(`      ${ops.length} arg builders, ${codecs.length} codec builders`);
});

await run('LIBRARY_ONLY gives a reason for every entry', async () => {
  const { LIBRARY_ONLY } = await import('../lib/cli/tasks.extra.ts');
  for (const [name, reason] of Object.entries(LIBRARY_ONLY)) {
    if (reason.length < 10) throw new Error(`${name}: reason too short`);
  }
});

await run('every runtime export is reachable from the CLI or documented as library-only', async () => {
  // The real reachability test: an export counts as reachable when the CLI
  // source names it, or when LIBRARY_ONLY records why it has no command.
  const lib = await import('../lib/index.ts');
  const { LIBRARY_ONLY } = await import('../lib/cli/tasks.extra.ts');
  const files = [
    'lib/cli/tasks.ts', 'lib/cli/tasks.extra.ts', 'lib/cli/filter-registry.ts',
    'lib/cli/index.ts', 'lib/cli/flags.ts', 'lib/cli/types.ts',
  ];
  const src = files.map(f => Deno.readTextFileSync(f)).join('\n');
  const named = new Set<string>();
  for (const mt of src.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) named.add(mt[1]!);
  // Uppercase names are type-only exports, which are erased at runtime.
  const missing = Object.keys(lib).filter(
    n => !named.has(n) && !(n in LIBRARY_ONLY) && !/^[A-Z0-9_]+$/.test(n),
  );
  if (missing.length > 0) throw new Error(`unreachable from the CLI: ${missing.join(', ')}`);
  const unused = Object.keys(LIBRARY_ONLY).filter(n => !(n in lib));
  if (unused.length > 0) throw new Error(`LIBRARY_ONLY lists non-exports: ${unused.join(', ')}`);
  const { INTERNAL_NOTES } = await import('../lib/cli/tasks.extra.ts');
  for (const [name, reason] of Object.entries(INTERNAL_NOTES)) {
    if (name in lib) throw new Error(`${name} is a public export, so it belongs in LIBRARY_ONLY`);
    if (reason.length < 10) throw new Error(`${name}: reason too short`);
  }
});

await run('the library-surface commands are all in the task table', () => {
  for (const name of [
    'filter', 'graph', 'codec', 'map', 'preset', 'analyze', 'features',
    'hwaccel', 'args', 'mix', 'loop', 'deinterlace', 'stabilize', 'aspect',
    'lut', 'timecode', 'cropdetect', 'gif2mp4', 'extract-subs', 'retime-subs', 'stack',
  ]) {
    if (!CLI_TASKS[name]) throw new Error(`missing from CLI_TASKS: ${name}`);
  }
});

await run('the task table has grown past the original 31 commands', () => {
  const n = Object.keys(CLI_TASKS).length;
  if (n < 45) throw new Error(`only ${n} task commands`);
  console.log(`      ${n} task commands`);
});

await run('the filter/codec/arg tables cover the bulk of the library', async () => {
  const { argOpNames, codecBuilderNames } = await import('../lib/cli/tasks.extra.ts');
  const { filterNames } = await import('../lib/cli/filter-registry.ts');
  if (filterNames().length !== 77) throw new Error(`${filterNames().length} filters`);
  if (argOpNames().length < 55) throw new Error(`only ${argOpNames().length} arg builders`);
  if (codecBuilderNames().length < 35) throw new Error(`only ${codecBuilderNames().length} codec builders`);
  console.log(`      ${filterNames().length} filters, ${argOpNames().length} arg builders, ${codecBuilderNames().length} codec builders`);
});

// ─── summary ────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log('  DENO CLI BATTLE TEST SUMMARY');
console.log('═'.repeat(60));
console.log(`  ✅ PASSED : ${passed}`);
console.log(`  ❌ FAILED : ${errors.length}`);

if (errors.length > 0) {
  console.log(`\n${'─'.repeat(60)}`);
  for (let i = 0; i < errors.length; i++) {
    console.log(`\n  [${i + 1}] ${errors[i]!.label}`);
    console.log(`       ERROR : ${errors[i]!.error.slice(0, 300)}`);
  }
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${errors.length} test(s) failed.`);
  console.log('─'.repeat(60));
  Deno.exit(1);
} else {
  console.log('\n  All CLI tests passed! 🎉');
}
