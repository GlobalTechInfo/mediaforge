/**
 * Dead-export check.
 *
 * `ts-prune` reports a symbol as unused when nothing in the project imports it
 * by name. That is a false positive for every public export, because this
 * library re-exports its whole surface from `lib/index.ts` with
 * `export { x } from './y.ts'` — a chain ts-prune does not follow. The raw
 * output is therefore ~1000 lines of noise.
 *
 * This script subtracts both the re-exported surface and the type-only/structural
 * symbols, then fails if anything genuinely dead is left. Run it in CI so dead
 * code cannot quietly accumulate.
 *
 *   npm run check:dead          # fail on anything not in ts-prune.ignore
 *   npm run check:dead -- --write   # rewrite ts-prune.ignore from the current state
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IGNORE_FILE = path.join(ROOT, 'ts-prune.ignore');
const WRITE = process.argv.includes('--write');

// ─── 1. Symbols re-exported through the public entry point ──────────────────
const index = readFileSync(path.join(ROOT, 'lib/index.ts'), 'utf8');
const reexported = new Set<string>();
for (const m of index.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s+from/g)) {
  for (const part of m[1]!.split(',')) {
    const name = part.trim();
    if (name === '') continue;
    reexported.add(name.split(/\s+as\s+/).pop()!);
  }
}

// ─── 2. Type aliases and option interfaces ──────────────────────────────────
// These are consumed structurally (as parameter and option types), so nothing
// ever imports them by name.
const TYPE_LIKE = /(?:Options|Props|Refs|Entry|Config|Preset|Node|Mode|Type|Info|Kind)$/;

function isTypeLike(name: string): boolean {
  return TYPE_LIKE.test(name) || /^[A-Z]/.test(name);
}

// ─── 3. Symbols imported by another module in lib/ ──────────────────────────
// ts-prune cannot resolve the Deno-style './x.ts' import specifiers this
// project uses, so a helper imported from a sibling module is still reported as
// unused. Collect the real import edges ourselves.
const libFiles: string[] = [];
for (const dir of ['cli', 'codecs', 'filters/audio', 'filters/video', 'helpers', 'probe', 'process', 'types', 'utils']) {
  const full = path.join(ROOT, 'lib', dir);
  if (!existsSync(full)) continue;
  for (const name of execFileSync('ls', [full], { encoding: 'utf8' }).split('\n')) {
    if (name.endsWith('.ts')) libFiles.push(path.posix.join('lib', dir, name));
  }
}
const mainIndex = path.join(ROOT, 'lib/index.ts');
if (existsSync(mainIndex)) libFiles.push('lib/index.ts');

// The test suites are real consumers too: several internal helpers exist purely
// so a regression can be asserted against them (e.g. getSpawnedCount, which the
// child-leak test reads directly). An export used only by tests is not dead.
for (const testDir of ['tests', 'deno-tests']) {
  const full = path.join(ROOT, testDir);
  if (!existsSync(full)) continue;
  const found = execFileSync('sh', ['-c', `find ${testDir} -name '*.ts'`], { encoding: 'utf8' });
  for (const name of found.split('\n')) {
    if (name.trim() === '') continue;
    libFiles.push(name.trim());
  }
}

const imported = new Set<string>();
for (const rel of libFiles) {
  const src = readFileSync(path.join(ROOT, rel), 'utf8');
  // Static imports: `import { a, b as c } from '...'`
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from/g)) {
    for (const part of m[1]!.split(',')) {
      const name = part.trim();
      if (name === '') continue;
      // `import { x as y }` binds y locally; x is the exported name.
      const asMatch = /^(\w+)\s+as\s+\w+$/.exec(name);
      imported.add(asMatch ? asMatch[1]! : name);
    }
  }
  // Dynamic imports: `const { a, b } = await import('...')` — how the test
  // suites reach internal helpers that are deliberately not re-exported.
  for (const m of src.matchAll(/=\s*(?:await\s+)?import(?:<[^>]*>)?\(\s*['"][^'"]+['"]\s*\)/g)) {
    const decl = src.slice(Math.max(0, m.index! - 300), m.index!);
    const braces = /\{([^}]*)\}\s*$/.exec(decl);
    if (!braces) continue;
    for (const part of braces[1]!.split(',')) {
      const name = part.trim();
      if (name === '') continue;
      const asMatch = /^(\w+)\s*:\s*\w+$/.exec(name);
      imported.add(asMatch ? asMatch[1]! : name);
    }
  }
}

// ─── 4. Everything ts-prune flagged ─────────────────────────────────────────
let pruned = '';
try {
  pruned = execFileSync('npx', ['ts-prune', '-p', 'tsconfig.check.json'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
} catch (e) {
  console.error('check:dead could not run ts-prune:', (e as Error).message);
  process.exit(1);
}

const flagged: { id: string; file: string; symbol: string; typeLike: boolean }[] = [];
const dead: { id: string; file: string; symbol: string }[] = [];
for (const line of pruned.split('\n')) {
  const m = /^(.+?):(\d+)\s+-\s+(.+?)\s*(\(used in module\))?$/.exec(line);
  if (!m) continue;
  const file = m[1]!;
  const symbol = m[3]!.trim();
  const typeLike = isTypeLike(symbol);
  const id = `${file}:${symbol}`;
  // Public API, structurally-consumed types, and anything another module
  // imports are all alive. None of those is dead code.
  if (reexported.has(symbol) || typeLike || imported.has(symbol)) {
    flagged.push({ id, file, symbol, typeLike });
  } else {
    dead.push({ id, file, symbol });
  }
}

// ─── 5. Compare against the ignore list ─────────────────────────────────────
const known = new Set<string>();
if (existsSync(IGNORE_FILE)) {
  for (const line of readFileSync(IGNORE_FILE, 'utf8').split('\n')) {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;
    known.add(t);
  }
}

const newDead = dead.filter(f => !known.has(f.id));

if (WRITE) {
  const header = readFileSync(IGNORE_FILE, 'utf8').split('\n').slice(0, 13).join('\n');
  const body = flagged
    .map(f => f.id)
    .sort()
    .map(id => `${id} # ${id.split(':')[1]!.endsWith('Options') || isTypeLike(id.split(':')[1]!) ? 'type/structural' : 're-exported'}`)
    .join('\n');
  writeFileSync(IGNORE_FILE, `${header}\n${body}\n`);
  console.log(`check:dead — wrote ${flagged.length} entries to ts-prune.ignore`);
  process.exit(0);
}

if (newDead.length > 0) {
  console.error(`\ncheck:dead — ${newDead.length} genuinely unused export(s):\n`);
  for (const d of newDead) console.error(`  ${d.id}`);
  console.error(
    '\nIf these are intentional (public API used only by consumers, or types\n' +
    'referenced structurally), add them to ts-prune.ignore with a reason.\n' +
    'Otherwise delete them.\n',
  );
  process.exit(1);
}

console.log(
  `check:dead — OK. ${flagged.length} known false positive(s) suppressed, 0 dead exports.`,
);
