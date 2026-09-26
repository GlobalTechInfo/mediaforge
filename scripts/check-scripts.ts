#!/usr/bin/env tsx
/**
 * Verify every test file in the tree is actually run by a script.
 *
 * A test file that no `npm run` or `deno task` reaches is a test file nobody
 * runs. This walks the tree and reports anything a script has forgotten,
 * rather than relying on a human reading package.json and counting.
 *
 * Run with `npm run check:scripts`.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

interface Pkg {
  scripts: Record<string, string>;
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as Pkg;
const deno = JSON.parse(readFileSync('deno.json', 'utf8')) as {
  tasks: Record<string, string>;
};
const scripts = pkg.scripts;
const tasks = deno.tasks;

const SKIP_DIRS =
  /^(node_modules|dist|\.battle|coverage|lcov-report|\.git|tmp_.*|tmp)$/;

/** Recursively collect files matching `re`, skipping build and scratch output. */
function walk(dir: string, re: RegExp, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir).sort()) {
    if (SKIP_DIRS.test(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, re, out);
    else if (re.test(entry)) out.push(full.replaceAll('\\', '/'));
  }
  return out;
}

// The root-level self-test suites, and the npm script each one belongs to.
// Named by their script rather than by a filename prefix, so a rename shows
// up here instead of silently unhooking a suite from `battle:all`.
const BATTLE_SCRIPTS: Record<string, string> = {
  'battle.test.ts': 'battle',
  'newfeatures.test.ts': 'battle:new',
  'cli.test.ts': 'battle:cli',
  'coverage.test.ts': 'battle:cov',
  'gaps.test.ts': 'battle:gaps',
  'libgaps.test.ts': 'battle:lib',
  'gaps2.test.ts': 'battle:gaps2',
  'gaps3.test.ts': 'battle:gaps3',
};

const DENO_TASKS: Record<string, string> = {
  'deno-tests/battle.test.ts': 'battle',
  'deno-tests/newfeatures.test.ts': 'battle:new',
  'deno-tests/cli.test.ts': 'battle:cli',
};


const unit = walk('tests/unit', /\.test\.ts$/);
const integration = walk('tests/integration', /\.test\.ts$/);
const denoAll = walk('deno-tests', /\.test\.ts$/);
const runtime = walk('runtime-tests', /\.ts$/);

// The root-level self-test suites. Named by their own npm script rather than
// by a filename prefix, so a rename is caught here instead of silently
// unhooking a suite from `battle:all`.
const rootBattle = Object.keys(BATTLE_SCRIPTS).filter((f) => existsSync(f));
const denoBattle = Object.keys(DENO_TASKS).filter((f) => existsSync(f));
const problems: string[] = [];

// ─── Node battle suites ──────────────────────────────────────────────────────
// Each suite needs its own script, a place in `battle:all`, and a turn in the
// c8 chain that feeds `coverage:gate`.


for (const [file, own] of Object.entries(BATTLE_SCRIPTS)) {
  if (!rootBattle.includes(file)) {
    problems.push(`battle suite is gone from disk but still scripted: ${file}`);
    continue;
  }
  if (scripts[own] !== `tsx ${file}`) {
    problems.push(`"${own}" must run exactly \`tsx ${file}\`, got: ${scripts[own]}`);
  }
  if (!scripts['battle:all']?.includes(`run ${own} `)
      && !scripts['battle:all']?.endsWith(`run ${own}`)) {
    problems.push(`"battle:all" does not chain "${own}"`);
  }
  if (!scripts['coverage:battle']?.includes(`tsx ${file} `)
      && !scripts['coverage:battle']?.endsWith(`tsx ${file}`)) {
    problems.push(`"coverage:battle" does not instrument ${file}`);
  }
}
for (const file of rootBattle) {
  if (!(file in BATTLE_SCRIPTS)) {
    problems.push(
      `battle suite on disk with no script, no battle:all entry and no ` +
        `coverage:battle turn: ${file}`,
    );
  }
}

// ─── Deno battle suites ──────────────────────────────────────────────────────


for (const [file, task] of Object.entries(DENO_TASKS)) {
  if (!denoBattle.includes(file)) {
    problems.push(`deno battle suite is gone from disk but still scripted: ${file}`);
    continue;
  }
  if (!tasks[task]?.includes(file)) {
    problems.push(`deno task "${task}" does not run ${file}`);
  }
  if (!tasks['battle:all']?.includes(`task ${task} `)
      && !tasks['battle:all']?.endsWith(`task ${task}`)) {
    problems.push(`deno "battle:all" does not chain "${task}"`);
  }
  // `deno task test` globs deno-tests/, so a battle suite it does not ignore
  // would be run twice — once as a suite, once as a plain test file.
  const testTask = tasks['test'] ?? '';
  if (!testTask.includes(`--ignore=${file}`)) {
    problems.push(`deno "test" does not --ignore ${file}, so it runs it twice`);
  }
}
for (const file of denoBattle) {
  if (!(file in DENO_TASKS)) {
    problems.push(`deno battle suite on disk with no deno task: ${file}`);
  }
}

// ─── find-based Node suites ──────────────────────────────────────────────────
// These discover their own files, so the check is that they search the right
// directories and that every file on disk sits in one of them.

const FIND_SCRIPTS: Array<[string, string[]]> = [
  ['test', ['tests/unit', 'tests/integration']],
  ['test:watch', ['tests/unit', 'tests/integration']],
  ['test:unit', ['tests/unit']],
  ['test:integration', ['tests/integration']],
  ['test:coverage', ['tests/unit', 'tests/integration']],
  ['coverage', ['tests/unit', 'tests/integration']],
  ['coverage:summary', ['tests/unit', 'tests/integration']],
];
for (const [name, dirs] of FIND_SCRIPTS) {
  const body = scripts[name];
  if (body === undefined) {
    problems.push(`missing script: ${name}`);
    continue;
  }
  if (!/\bfind\b/.test(body)) {
    problems.push(`"${name}" does not discover test files with \`find\``);
    continue;
  }
  for (const dir of dirs) {
    if (!body.includes(dir)) problems.push(`"${name}" does not search ${dir}`);
  }
}

// Nothing may sit in tests/ outside the two directories the scripts search.
const testsRoot = walk('tests', /\.test\.ts$/);
const reachable = new Set([...unit, ...integration]);
for (const file of testsRoot) {
  if (!reachable.has(file)) {
    problems.push(`test file in tests/ that no script finds: ${file}`);
  }
}

// ─── Runtime cross-runtime suite ─────────────────────────────────────────────

for (const file of runtime) {
  if (!scripts['battle:runtime']?.includes(file)) {
    problems.push(`"battle:runtime" does not run ${file}`);
  }
}
if (!scripts['battle:runtimes']?.includes('run battle:runtime')) {
  problems.push('"battle:runtimes" does not chain "battle:runtime"');
}
if (!scripts['battle:runtimes']?.includes('deno task battle:runtime')) {
  problems.push('"battle:runtimes" does not chain the deno runtime task');
}
if (!scripts['battle:runtimes']?.includes('bun run runtime-tests/battle.ts')) {
  problems.push('"battle:runtimes" does not chain the bun runtime suite');
}

// ─── Coverage gate ───────────────────────────────────────────────────────────

if (!scripts['coverage:gate']?.includes('--check-coverage')) {
  problems.push('"coverage:gate" does not actually fail on a coverage miss');
}
for (const metric of ['--lines', '--functions', '--branches', '--statements']) {
  if (!scripts['coverage:gate']?.includes(metric)) {
    problems.push(`"coverage:gate" sets no threshold for ${metric.replace('--', '')}`);
  }
}

// ─── Report ──────────────────────────────────────────────────────────────────

if (problems.length > 0) {
  console.error('check:scripts — FAIL');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `check:scripts — OK. ${rootBattle.length} node battle suites, ` +
    `${denoBattle.length} deno battle suites, ${unit.length} unit, ` +
    `${integration.length} integration, ${denoAll.length} deno test files, ` +
    `${runtime.length} runtime files — all reachable from a script.`,
);
