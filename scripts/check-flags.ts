/**
 * Flag-declaration consistency.
 *
 * The CLI parser takes flag arity from the task table: a description beginning
 * with `=` means the flag requires a value, everything else is boolean. That
 * convention was documented in `CliTask.flags` but nothing read it, so the two
 * could disagree freely. When the parser started honouring it, every
 * disagreement became a broken command:
 *
 *   `metadata --no-strip in out`     --strip read as a boolean, declared `=`
 *   `subtitles --fix-duration`       read as a boolean, declared `=`
 *   `stabilize --max-shift 12`       read as a value, declared boolean
 *
 * All three shipped. Rather than fix them one at a time as users reported them,
 * this check compares every flag's declaration against how the task body
 * actually reads it, and fails on any disagreement.
 *
 *   npm run check:flags
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_TASKS } from '../lib/cli/tasks.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Flag tables live in two modules; both are scanned. */
const SOURCES = ['lib/cli/tasks.ts', 'lib/cli/tasks.extra.ts'];

interface TaskSlice {
  name: string;
  flags: string;
  body: string;
}

/** Split a task source file into `{ name, flags table, run body }`. */
function slices(path: string): TaskSlice[] {
  const source = readFileSync(join(ROOT, path), 'utf8');
  const out: TaskSlice[] = [];

  const nameRe = /\n {4}name: '([a-z0-9-]+)',/g;
  const positions: { name: string; start: number }[] = [];
  for (const match of source.matchAll(nameRe)) {
    positions.push({ name: match[1]!, start: match.index! + match[0].length });
  }

  for (let i = 0; i < positions.length; i++) {
    const { name, start } = positions[i]!;
    const end = i + 1 < positions.length ? positions[i + 1]!.start : source.length;
    const segment = source.slice(start, end);

    const flagsAt = segment.search(/flags:\s*\{/);
    if (flagsAt === -1) continue;
    const open = segment.indexOf('{', flagsAt);
    let depth = 0;
    let close = open;
    while (close < segment.length) {
      if (segment[close] === '{') depth++;
      else if (segment[close] === '}') {
        depth--;
        if (depth === 0) break;
      }
      close++;
    }

    const runAt = segment.search(/\brun\(pos, f\)/);
    out.push({
      name,
      flags: segment.slice(open + 1, close),
      body: runAt === -1 ? '' : segment.slice(runAt),
    });
  }
  return out;
}

/** Parse the flag table. Keys may be bare or quoted (`'fix-duration': …`). */
function declarations(flags: string): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const match of flags.matchAll(/(?:'([^']+)'|([a-zA-Z0-9_-]+))\s*:\s*'([^']*)'/g)) {
    const name = match[1] ?? match[2];
    if (name !== undefined) map.set(name, match[3]!.trimStart().startsWith('='));
  }
  return map;
}

/** Flags the body reads as booleans. */
function booleanReads(body: string): Set<string> {
  const found = new Set<string>();
  for (const m of body.matchAll(/\bbool\((?:f|flags),\s*'([^']+)'\)/g)) found.add(m[1]!);
  for (const m of body.matchAll(/(?:f|flags)\['([^']+)'\]\s*===\s*true/g)) found.add(m[1]!);
  return found;
}

/** Flags the body reads as values. */
function valueReads(body: string): Set<string> {
  const found = new Set<string>();
  for (const m of body.matchAll(
    /\b(?:str|num|list|listOf|requireFlag)\((?:f|flags),\s*'([^']+)'/g,
  )) {
    found.add(m[1]!);
  }
  return found;
}

function main(): void {
  const problems: string[] = [];
  let checked = 0;

  for (const source of SOURCES) {
    for (const slice of slices(source)) {
      const declared = declarations(slice.flags);
      for (const flag of booleanReads(slice.body)) {
        if (!declared.has(flag)) continue;
        checked++;
        if (declared.get(flag) === true) {
          problems.push(
            `${source} [${slice.name}]: --${flag} is read as a boolean but its description ` +
              'starts with "=", declaring it value-taking. The parser will demand a value ' +
              'the task never uses.',
          );
        }
      }
      for (const flag of valueReads(slice.body)) {
        if (!declared.has(flag)) continue;
        checked++;
        if (declared.get(flag) === false) {
          problems.push(
            `${source} [${slice.name}]: --${flag} is read as a value but its description has ` +
              'no leading "=", declaring it boolean. The parser will not accept its value.',
          );
        }
      }
    }
  }

  // Every task must be reachable, or the scan above silently covers less than it
  // appears to. `Object.keys` forces the deferred merge in the CLI_TASKS proxy.
  const taskNames = Object.keys(CLI_TASKS);
  if (taskNames.length === 0) {
    problems.push('CLI_TASKS is empty — the flag scan checked nothing.');
  }
  for (const task of taskNames) {
    const declaredHere = SOURCES.some((source) =>
      slices(source).some((slice) => slice.name === task),
    );
    if (!declaredHere) {
      problems.push(`task "${task}" has no flag table in ${SOURCES.join(' or ')}`);
    }
  }

  if (problems.length > 0) {
    console.error(`\ncheck:flags — ${problems.length} flag declaration mismatch(es):\n`);
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(
      '\nA value-taking flag describes itself with a leading "=" in its description:\n' +
        "  json: 'emit JSON'            -> boolean\n" +
        "  start: '=start time'         -> requires a value\n",
    );
    process.exit(1);
  }

  console.log(
    `check:flags — OK. ${checked} flag read(s) across ${taskNames.length} tasks agree with ` +
      'their declarations.',
  );
}

main();