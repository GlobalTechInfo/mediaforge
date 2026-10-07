/**
 * Workflow syntax gate.
 *
 * A GitHub Actions workflow that does not parse does not run — GitHub reports a
 * single failure and silently skips every job, so every check it claimed to
 * perform goes unperformed while the badge still looks configured. That is not
 * hypothetical: an unquoted `name: Installed package: ESM import + CLI (Bun)`
 * contains a colon, which YAML reads as a nested mapping. The file parsed
 * cleanly for everyone locally and the whole suite stopped running.
 *
 * This parses every workflow on every run, so the next one is caught by the
 * commit that introduces it rather than by a reviewer.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, '.github', 'workflows');

// `yaml` ships transitively with typedoc. Avoid adding a dependency for a gate
// this small: fall back to a conservative structural check if it is absent.
function loadYaml(): ((src: string) => unknown) | undefined {
  // `require` is not defined in an ES module, so reach it through
  // createRequire. Without this the gate silently degraded to the structural
  // check alone and reported "OK" on the very file it exists to catch.
  try {
    const require = createRequire(import.meta.url);
    const mod = require('yaml') as { parse?: (src: string) => unknown };
    if (typeof mod.parse === 'function') return mod.parse;
  } catch {
    // Not installed — the structural check still applies below.
  }
  return undefined;
}

function structuralCheck(source: string, file: string): string[] {
  const problems: string[] = [];
  const lines = source.split('\n');

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) return;

    // An unquoted scalar value may not contain ": " — YAML reads that as a
    // nested mapping, which is exactly the parse error this gate exists for.
    const keyValue = /^\s*(?:-\s*)?([A-Za-z_][\w-]*):\s+(.+)$/.exec(line);
    if (keyValue === null) return;
    const key = keyValue[1]!;
    const value = keyValue[2]!.trim();
    if (value === '' || /^["']/.test(value)) return;
    if (value.includes(': ') || /:$/.test(value)) {
      problems.push(
        `${file}:${index + 1}  unquoted "${key}" value contains a colon — ` +
          `quote it: "${key}: ${value}"`,
      );
    }
  });

  // Tabs are illegal for YAML indentation.
  lines.forEach((line, index) => {
    if (/^\s*\t/.test(line)) {
      problems.push(`${file}:${index + 1}  tab character in indentation (YAML forbids tabs)`);
    }
  });

  return problems;
}

function main(): void {
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();

  if (files.length === 0) {
    console.error('check:workflows — no workflow files found');
    process.exit(1);
  }

  const parse = loadYaml();
  const problems: string[] = [];
  let checked = 0;

  for (const file of files) {
    const source = readFileSync(join(DIR, file), 'utf8');
    checked++;

    if (parse !== undefined) {
      try {
        const doc = parse(source) as { jobs?: Record<string, unknown> };
        if (doc === null || typeof doc !== 'object') {
          problems.push(`${file}  parsed to ${doc === null ? 'null' : typeof doc}, not a mapping`);
          continue;
        }
        const jobs = Object.keys(doc.jobs ?? {});
        if (jobs.length === 0) {
          problems.push(`${file}  declares no jobs`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
        problems.push(`${file}  does not parse: ${message}`);
      }
    }

    problems.push(...structuralCheck(source, file));
  }

  if (problems.length > 0) {
    console.error(`\ncheck:workflows — ${problems.length} problem(s):\n`);
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(
      '\nA workflow that does not parse is skipped entirely by GitHub, so every check\n' +
        'it claims to run silently stops running.\n',
    );
    process.exit(1);
  }

  console.log(`check:workflows — OK. ${checked} workflow file(s) parse, ${checked} structurally clean.`);
}

main();