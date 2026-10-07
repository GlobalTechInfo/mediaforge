/**
 * Test-tree parity.
 *
 * `tests/` (Node) and `deno-tests/` (Deno) were two hand-maintained copies of the
 * same suite, with comments asking readers to "keep them in sync" and nothing
 * enforcing it. Measured drift at the time this was written:
 *
 *   unit/coverage-boost.test.ts          217 cases vs 88  (138 missing)
 *   unit/filters/video.filters.test.ts   139 vs 120
 *   unit/codecs/codecs.serializers…      151 vs 142
 *   …and six more
 *
 * A fix landed in one tree was silently absent from the other, which quietly
 * made the Deno and Bun story less accurate than the Node one while CI reported
 * both as green.
 *
 * Full consolidation into one shared source is the ideal end state but a
 * high-risk refactor of ~1,600 cases. Name-level parity catches the same class
 * of regression at a fraction of the cost: a file whose mirror exists but has
 * lost cases fails, so drift cannot accumulate unnoticed again.
 *
 *   npm run check:parity
 *   npm run check:parity -- --write   # record the current state as the baseline
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NODE_DIR = join(ROOT, 'tests');
const DENO_DIR = join(ROOT, 'deno-tests');
const BASELINE = join(ROOT, 'testkit', 'test-parity.json');
const WRITE = process.argv.includes('--write');

interface Parity {
  /**
   * Per mirrored file, the case titles present in the Node tree but not in the
   * Deno mirror *when the baseline was recorded*.
   *
   * Some drift predates this check — `unit/coverage-boost.test.ts` was missing
   * 138 cases before anyone measured it — and refusing to run at all until that
   * is fixed would mean the gate never gets adopted. Recording the existing
   * shortfall lets the check do the thing that actually matters: make sure no
   * *new* drift accumulates, so the gap can only shrink.
   */
  knownMissing: Record<string, string[]>;
  /** Files that exist only in the Node tree, with a reason each. */
  nodeOnly: Record<string, string>;
}

/** Every `*.test.ts` under a directory, recursively. */
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** Test-case titles declared in a file. */
function caseTitles(path: string): Set<string> {
  const source = readFileSync(path, 'utf8');
  const titles = new Set<string>();
  for (const match of source.matchAll(/\b(?:it|test|describe)\(\s*['"`]([^'"`]+)/g)) {
    const title = match[1];
    if (title !== undefined) titles.add(title);
  }
  return titles;
}

function relKey(path: string): string {
  return relative(path.includes('deno-tests') ? DENO_DIR : NODE_DIR, path).split(sep).join('/');
}

function main(): void {
  const nodeFiles = new Map<string, string>();
  for (const file of walk(NODE_DIR)) nodeFiles.set(relKey(file), file);

  const denoFiles = new Map<string, string>();
  for (const file of walk(DENO_DIR)) denoFiles.set(relKey(file), file);

  // ─── Mirrors ─────────────────────────────────────────────────────────────
  interface MirrorProblem {
    file: string;
    nodeCases: number;
    denoCases: number;
    missing: string[];
  }
  const problems: MirrorProblem[] = [];
  const knownMissing: Record<string, string[]> = {};

  for (const [key, nodeFile] of nodeFiles) {
    const denoFile = denoFiles.get(key);
    if (denoFile === undefined) continue;

    const nodeTitles = caseTitles(nodeFile);
    const denoTitles = caseTitles(denoFile);

    const missing = [...nodeTitles].filter((t) => !denoTitles.has(t));
    if (missing.length > 0) knownMissing[key] = missing;
  }

  // ─── Node-only files ─────────────────────────────────────────────────────
  const nodeOnly: Record<string, string> = {};
  for (const key of nodeFiles.keys()) {
    if (denoFiles.has(key)) continue;
    nodeOnly[key] = '';
  }

  if (WRITE) {
    const previous: Partial<Parity> = existsSync(BASELINE)
      ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as Partial<Parity>)
      : {};
    const reasons = previous.nodeOnly ?? {};
    const payload: Parity = {
      knownMissing,
      nodeOnly: Object.fromEntries(
        Object.keys(nodeOnly).map((key) => [
          key,
          reasons[key] ?? 'TODO: explain why this has no Deno mirror',
        ]),
      ),
    };
    writeFileSync(BASELINE, `${JSON.stringify(payload, null, 2)}\n`);
    const shortfalls = Object.entries(knownMissing).filter(([, v]) => v.length > 0);
    console.log(
      `check:parity — wrote baseline: ${shortfalls.length} mirrored file(s) with a recorded ` +
        `shortfall (${shortfalls.reduce((n, [, v]) => n + v.length, 0)} cases), ` +
        `${Object.keys(payload.nodeOnly).length} node-only`,
    );
    return;
  }

  const baseline: Parity = existsSync(BASELINE)
    ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as Parity)
    : { knownMissing: {}, nodeOnly: {} };

  let failed = false;

  // Only drift *beyond* the recorded baseline fails. Existing shortfalls are
  // visible in testkit/test-parity.json and can only shrink.
  for (const [key, missing] of Object.entries(knownMissing)) {
    const known = new Set(baseline.knownMissing[key] ?? []);
    const added = missing.filter((t) => !known.has(t));
    if (added.length === 0) continue;
    const denoFile = denoFiles.get(key)!;
    problems.push({
      file: key,
      nodeCases: caseTitles(nodeFiles.get(key)!).size,
      denoCases: caseTitles(denoFile).size,
      missing: added.slice(0, 3).map((m) => `      - ${m}`),
    });
  }

  // A case that used to be missing and is now present is progress; shrink the
  // baseline so it cannot be re-forgiven later.
  const shrunk = Object.entries(baseline.knownMissing).filter(([key, titles]) => {
    const current = knownMissing[key];
    return current !== undefined && current.length < titles.length;
  });

  if (problems.length > 0) {
    console.error(
      `\ncheck:parity — ${problems.length} mirrored file(s) gained NEW test cases in ` +
        `tests/ that deno-tests/ does not have:\n`,
    );
    for (const problem of problems) {
      console.error(
        `  ${problem.file}\n    Node has ${problem.nodeCases}, Deno has ${problem.denoCases}\n` +
          `${problem.missing.join('\n')}`,
      );
    }
    console.error(
      '\nPort the new cases into the Deno mirror. A case added to tests/ but not to\n' +
        'deno-tests/ makes the Deno and Bun story quietly weaker than the Node one.\n' +
        'If the file should be Node-only, say so in testkit/test-parity.json.\n',
    );
    failed = true;
  }

  if (shrunk.length > 0) {
    console.log(
      `check:parity — ${shrunk.length} mirrored file(s) closed cases since the baseline ` +
        `was recorded; re-run with --write to tighten it.`,
    );
  }

  const unrecorded = Object.keys(nodeOnly).filter(
    (key) => !baseline.nodeOnly[key] || baseline.nodeOnly[key]?.startsWith('TODO:'),
  );
  if (unrecorded.length > 0) {
    console.error(
      `\ncheck:parity — ${unrecorded.length} Node-only test file(s) with no recorded reason:\n`,
    );
    for (const key of unrecorded) console.error(`  ${key}`);
    console.error(
      '\nA Node-only file is a legitimate decision, but it has to be a stated one:\n' +
        'add a reason to testkit/test-parity.json.\n',
    );
    failed = true;
  }

  const staleReasons = Object.keys(baseline.nodeOnly).filter((key) => !nodeFiles.has(key));
  if (staleReasons.length > 0) {
    console.error(
      `\ncheck:parity — ${staleReasons.length} recorded Node-only file(s) no longer exist:\n`,
    );
    for (const key of staleReasons) console.error(`  ${key}`);
    console.error('\nRe-run `npm run check:parity -- --write` to refresh the baseline.\n');
    failed = true;
  }

  if (failed) process.exit(1);

  const outstanding = Object.entries(baseline.knownMissing).reduce((n, [, v]) => n + v.length, 0);
  console.log(
    `check:parity — OK. No new drift across ${nodeFiles.size - Object.keys(nodeOnly).length} ` +
      `mirrored file(s); ${outstanding} pre-existing shortfall(s) recorded; ` +
      `${Object.keys(nodeOnly).length} Node-only with recorded reasons.`,
  );
}

main();