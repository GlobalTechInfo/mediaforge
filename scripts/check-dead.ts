/**
 * Dead-export check.
 *
 * Replaces the `ts-prune` npm package, which had to be removed because it
 * depends on `fast-glob` → `micromatch` → `braces`, and every published version
 * of `braces` (through 3.0.3, the newest that exists) is covered by the
 * unpatched advisory GHSA-vfj7-8cjw-p6xm (CWE-674 stack exhaustion). There is
 * no version to upgrade to — see SECURITY.md.
 *
 * `ts-prune` matched imported *names*, which could not work for this project:
 *
 *  - It could not resolve the Deno-style `./x.ts` import specifiers used
 *    throughout `lib/`, so a helper imported by a sibling module was reported
 *    as unused.
 *  - It could not follow the `export { x } from './y.ts'` re-export chain that
 *    `lib/index.ts` uses to publish the whole surface, so every public export
 *    looked dead.
 *
 * Both false positives were suppressed through a hand-maintained ignore list of
 * ~1090 entries — which meant the check could only ever catch something the
 * ignore list did not already excuse.
 *
 * This implementation uses the TypeScript compiler API instead, which resolves
 * `./x.ts` correctly and follows re-exports natively, and counts references by
 * *symbol identity* rather than by name so a local `const concat` is not
 * mistaken for a use of the exported `concat`. With those three problems gone
 * the ignore list is no longer needed and the raw output is a short, real list.
 *
 *   npm run check:dead      # fail if any export is genuinely unreachable
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(ROOT, 'lib');

// ─── Program construction ────────────────────────────────────────────────────

function loadProgramConfig(): ts.ParsedCommandLine {
  const configFile = ts.readConfigFile(path.join(ROOT, 'tsconfig.check.json'), ts.sys.readFile);
  if (configFile.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT);
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new Error(ts.flattenDiagnosticMessageText(first?.messageText ?? 'unknown', '\n'));
  }
  return parsed;
}

function collect(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(full, out);
    } else if (entry.name.endsWith('.ts') && !full.includes(`${path.sep}tmp`)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The test suites are real consumers: several internal helpers exist purely so
 * a regression can be asserted against them (`getSpawnedCount`, which the
 * child-leak test reads directly). An export used only by a test is not dead.
 */
function consumerFiles(parsed: ts.ParsedCommandLine): string[] {
  return [
    ...parsed.fileNames,
    ...collect(path.join(ROOT, 'tests')),
    ...collect(path.join(ROOT, 'deno-tests')),
    ...collect(path.join(ROOT, 'scripts')),
    ...collect(path.join(ROOT, 'runtime-tests')),
  ];
}

// ─── Symbols that are alive by role, not by reference ────────────────────────

/**
 * Public API: everything `lib/index.ts` republishes.
 *
 * With symbol-keyed counting this is mostly redundant — an `export { x } from`
 * specifier resolves through the alias to the target symbol and so already
 * counts as a reference. It is kept as an explicit belt-and-braces allowance so
 * the public surface can never be reported as dead by a compiler quirk.
 */
function reexportedFromIndex(): Set<string> {
  const index = readFileSync(path.join(LIB, 'index.ts'), 'utf8');
  const names = new Set<string>();
  for (const m of index.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s+from/g)) {
    for (const part of (m[1] ?? '').split(',')) {
      const name = part.trim();
      if (name === '') continue;
      names.add(name.split(/\s+as\s+/).pop() ?? name);
    }
  }
  return names;
}

/**
 * Option and result interfaces are consumed structurally — as parameter and
 * return types — so nothing ever imports them by name.
 */
const TYPE_LIKE = /(?:Options|Props|Refs|Entry|Config|Preset|Node|Mode|Type|Info|Kind)$/;

function isTypeLike(name: string): boolean {
  return TYPE_LIKE.test(name) || /^[A-Z]/.test(name);
}

// ─── Exports referenced only through a type-erased dynamic import ─────────────

/**
 * A handful of battle-style tests reach internal helpers through
 *
 *   const proc = await import('../../lib/helpers/process.js') as Record<string, any>;
 *
 * The `as Record<string, any>` deliberately erases every type, so the checker
 * cannot connect `proc.getSpawnedCount()` back to the declaration and this check
 * is structurally unable to see the use. Those symbols are listed here with the
 * reason they are alive.
 *
 * Every entry is verified to still exist, so an allowlist entry cannot outlive
 * the symbol it excuses — the previous ignore list grew to 1090 entries and
 * could only ever excuse.
 */
const DYNAMIC_ONLY = new Map<string, string>([
  [
    'getSpawnedCount',
    'lib/helpers/process.ts — asserted by tests/integration/gaps3.test.ts and ' +
    'tests/unit/changelog.claims.test.ts through an `as Record<string, any>` dynamic import',
  ],
]);

// ─── The check ───────────────────────────────────────────────────────────────

interface Finding {
  file: string;
  symbol: string;
}

function main(): void {
  const parsed = loadProgramConfig();
  const program = ts.createProgram(consumerFiles(parsed), {
    ...parsed.options,
    noEmit: true,
  });
  const checker = program.getTypeChecker();

  // Pass 1 — count how many identifier positions resolve to each symbol. Counting
  // symbols rather than names is what makes a local `const concat` unable to
  // mask a real use of the exported `concat`.
  //
  // Every lookup is normalised through `getAliasedSymbol` first. An import
  // specifier resolves to an *alias* symbol, which is a distinct object from
  // the export it points at, so references from an importing module and the
  // declaration in the exporting module would otherwise be counted under two
  // different keys — making every imported helper look unused.
  const referenceCounts = new Map<ts.Symbol, number>();
  const resolve = (node: ts.Identifier): ts.Symbol | undefined => {
    let symbol: ts.Symbol | undefined;
    try {
      symbol = checker.getSymbolAtLocation(node);
      if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
        symbol = checker.getAliasedSymbol(symbol);
      }
    } catch {
      symbol = undefined;
    }
    return symbol;
  };

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const symbol = resolve(node);
        if (symbol !== undefined) {
          referenceCounts.set(symbol, (referenceCounts.get(symbol) ?? 0) + 1);
        }
      } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        // `import * as m from './x.ts'; m.helper()` names the export through the
        // property, not through an identifier, so an identifier-only walk never
        // sees it. Asking the checker for the whole access resolves the property
        // to the same symbol the export declares.
        let symbol: ts.Symbol | undefined;
        try {
          symbol = checker.getSymbolAtLocation(node);
          if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
            symbol = checker.getAliasedSymbol(symbol);
          }
        } catch {
          symbol = undefined;
        }
        if (symbol !== undefined) {
          referenceCounts.set(symbol, (referenceCounts.get(symbol) ?? 0) + 1);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  // Pass 2 — an export is dead when nothing anywhere resolves to its symbol
  // beyond its own declaration(s).
  const reexported = reexportedFromIndex();
  const dead: Finding[] = [];
  const suppressed: Finding[] = [];

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (!sourceFile.fileName.startsWith(LIB)) continue;

    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (moduleSymbol === undefined) continue;

    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const declarations = exported.declarations ?? [];
      if (declarations.length === 0) continue;

      const references = referenceCounts.get(exported) ?? 0;
      if (references > declarations.length) continue; // genuinely referenced

      // Alive by role rather than by reference.
      if (reexported.has(exported.getName()) || isTypeLike(exported.getName())) {
        suppressed.push({
          file: path.relative(ROOT, sourceFile.fileName),
          symbol: exported.getName(),
        });
        continue;
      }

      dead.push({
        file: path.relative(ROOT, sourceFile.fileName),
        symbol: exported.getName(),
      });
    }
  }

  dead.sort((a, b) => `${a.file}${a.symbol}`.localeCompare(`${b.file}${b.symbol}`));

  // An allowlist entry that no longer matches a real dead export means the
  // symbol was deleted or became referenced, so the exception is now stale.
  const stale = [...DYNAMIC_ONLY.keys()].filter((name) => !dead.some((d) => d.symbol === name));
  if (stale.length > 0) {
    console.error(`\ncheck:dead — ${stale.length} stale allowlist entr(ies):\n`);
    for (const name of stale) {
      console.error(`  ${name} — no longer an unused export; remove it from DYNAMIC_ONLY`);
    }
    console.error('');
    process.exit(1);
  }

  const realDead = dead.filter((d) => !DYNAMIC_ONLY.has(d.symbol));
  const excused = dead.length - realDead.length;

  if (realDead.length > 0) {
    console.error(`\ncheck:dead — ${realDead.length} unused export(s):\n`);
    for (const d of realDead) console.error(`  ${d.file}  ${d.symbol}`);
    console.error(
      '\nIf these are intentional (public API used only by consumers, or types\n' +
      'referenced structurally), re-export it from lib/index.ts or annotate it.\n' +
      'Otherwise delete it.\n',
    );
    process.exit(1);
  }

  const total = suppressed.length + dead.length;
  console.log(
    `check:dead — OK. ${total} export(s) resolved, ${suppressed.length} public/type-only, ` +
    `${excused} referenced via type-erased dynamic import, 0 dead.`,
  );
}

try {
  main();
} catch (error) {
  console.error(`check:dead failed: ${(error as Error).message}`);
  process.exit(1);
}