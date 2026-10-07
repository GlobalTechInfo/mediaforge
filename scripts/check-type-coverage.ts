/**
 * Type-coverage gate.
 *
 * Replaces the `type-coverage` npm package, which had to be removed because it
 * depends on `fast-glob` → `micromatch` → `braces`, and every published version
 * of `braces` (through 3.0.3, the newest that exists) is covered by the
 * unpatched advisory GHSA-vfj7-8cjw-p6xm (CWE-674 stack exhaustion). There is
 * no version to upgrade to — see SECURITY.md.
 *
 * This measures the share of identifier positions in `lib/` whose inferred type
 * is `any`. It is built directly on `typescript`, which was already a direct
 * devDependency, so the vulnerable subtree is gone without adding a replacement
 * package.
 *
 * Unlike the package it replaces, this enforces a real threshold. The old
 * script was wired into CI under the name "Type coverage must stay above 99%"
 * but passed no threshold, so it reported 99.96% and exited 0 unconditionally.
 *
 *   npm run type-coverage                    # report only
 *   npm run type-coverage -- --at-least 99  # enforce a gate
 *   npm run type-coverage -- --list          # print every `any` position
 */

import process from 'node:process';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ─── Argument parsing ────────────────────────────────────────────────────────

function readArg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const eqForm = argv.find((a) => a.startsWith(`--${name}=`));
  if (eqForm !== undefined) return eqForm.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  if (i !== -1) {
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) return next;
  }
  return undefined;
}

// ─── Positions that are `any` through no fault of the author ─────────────────

/**
 * Is this identifier part of a type rather than a value?
 *
 * Type-position identifiers legitimately report `any` for reasons that have
 * nothing to do with how strictly the code is typed: tuple labels (`[line:
 * string]`), the `const` of an `as const`, the left side of a qualified type
 * name (`m.TransitionType`), and names inside an `asserts x is T` clause. None
 * of those is a place an author can supply a type, so they are not type
 * coverage failures.
 */
function isTypePosition(node: ts.Identifier): boolean {
  let current: ts.Node | undefined = node;
  while (current !== undefined) {
    const parent: ts.Node | undefined = current.parent;
    if (parent === undefined) return false;
    // `x as const` — the contextual `const` keyword is the AsExpression's type.
    if (
      (ts.isAsExpression(parent) ||
        ts.isTypeAssertionExpression(parent) ||
        ts.isSatisfiesExpression(parent)) &&
      parent.type === current
    ) {
      return true;
    }
    if (ts.isTypeNode(parent) || ts.isTypeElement(parent) || ts.isAssertClause(parent)) {
      return true;
    }
    // Do not climb past the nearest enclosing declaration or statement: an
    // identifier somewhere else in that body is a value again.
    if (
      ts.isSourceFile(parent) ||
      ts.isStatement(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isArrowFunction(parent) ||
      ts.isFunctionExpression(parent)
    ) {
      return false;
    }
    current = parent;
  }
  return false;
}

/**
 * Is the identifier's `any` inherent rather than authored?
 *
 * Two cases matter here:
 *
 *  - An **ambient** symbol — `console`, `NodeJS` — is declared in a `.d.ts` and
 *    is `any` because of how TypeScript declares the standard library, not
 *    because of anything written here.
 *  - A **declaration** position — a catch clause, an import binding, an
 *    unannotated binding element whose type is inferred from an untyped host
 *    signature such as an EventEmitter listener, which is only knowable at the
 *    call site.
 */
function isExempt(node: ts.Identifier, symbol: ts.Symbol | undefined): boolean {
  const { parent } = node;
  if (parent === undefined) return true;

  if (isTypePosition(node)) return true;

  // Ambient: declared by the standard library or by a `.d.ts`, never locally.
  const declarations = symbol?.declarations;
  if (declarations === undefined || declarations.length === 0) return true;
  if (declarations.every((d) => d.getSourceFile().isDeclarationFile)) return true;

  // `catch (e)`.
  if (ts.isCatchClause(parent) && parent.variableDeclaration?.name === node) return true;

  // Import bindings resolve through the module record, not the local type.
  // Each case is narrowed separately because these node kinds do not all carry
  // a `name` — `NamedImports` is the `{ a, b }` wrapper and has no name at all.
  if (
    (ts.isImportSpecifier(parent) ||
      ts.isNamespaceImport(parent) ||
      ts.isImportClause(parent)) &&
    parent.name === node
  ) {
    return true;
  }

  // The property half of a renamed binding element (`{ copy: useCopy }`).
  if (ts.isBindingElement(parent) && parent.propertyName === node) return true;

  // A declaration with no type annotation may be inferring from an untyped host
  // signature. An *annotated* one is always the author's responsibility.
  const declarator = parent as ts.Declaration & { type?: ts.TypeNode; name?: ts.Node };
  if (declarator.name === node) {
    if (ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent)) return true;
    if (ts.isBindingElement(parent)) {
      // A binding element carries no `type` of its own: in
      // `const { a }: T = x` the annotation lives on the VariableDeclaration or
      // Parameter two levels up, so walk to that.
      const owner = parent.parent.parent;
      if (ts.isVariableDeclaration(owner) || ts.isParameter(owner)) {
        return owner.type === undefined;
      }
      return true;
    }
    if (ts.isVariableDeclaration(parent)) return parent.type === undefined;
    if (ts.isParameter(parent)) return parent.type === undefined;
    if (
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isMethodDeclaration(parent)
    ) {
      return parent.type === undefined;
    }
  }

  // A property key in an object literal is a *name*, not a value expression, so
  // `getTypeAtLocation` on it reports `any` unconditionally — reporting every
  // `{ cause }` as a type hole would make the gate meaningless.
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isShorthandPropertyAssignment(parent)) return true;

  return false;
}

interface Finding {
  file: string;
  line: number;
  column: number;
  name: string;
}

function measure(): { total: number; anyCount: number; findings: Finding[] } {
  const configPath = path.join(ROOT, 'tsconfig.check.json');
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT);
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new Error(ts.flattenDiagnosticMessageText(first?.messageText ?? 'unknown', '\n'));
  }

  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();

  let total = 0;
  let anyCount = 0;
  const findings: Finding[] = [];

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (!sourceFile.fileName.includes(`${path.sep}lib${path.sep}`)) continue;

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        let symbol: ts.Symbol | undefined;
        try {
          symbol = checker.getSymbolAtLocation(node);
        } catch {
          symbol = undefined;
        }
        if (!isExempt(node, symbol)) {
          const type = checker.getTypeAtLocation(node);
          if (type !== undefined) {
            total++;
            if (type.flags & ts.TypeFlags.Any) {
              anyCount++;
              const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
              findings.push({
                file: path.relative(ROOT, sourceFile.fileName),
                line: pos.line + 1,
                column: pos.character + 1,
                name: node.text,
              });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return { total, anyCount, findings };
}

// ─── Report ──────────────────────────────────────────────────────────────────

function main(): void {
  const argv = process.argv.slice(2);
  const rawAtLeast = readArg('at-least');
  let atLeast: number | undefined;
  if (rawAtLeast !== undefined) {
    atLeast = Number(rawAtLeast);
    if (!Number.isFinite(atLeast) || atLeast < 0 || atLeast > 100) {
      console.error(`--at-least must be a number between 0 and 100, got "${rawAtLeast}"`);
      process.exit(2);
    }
  }
  const list = argv.includes('--list');

  const { total, anyCount, findings } = measure();

  if (total === 0) {
    console.error('type-coverage measured 0 typed positions — is lib/ empty or misconfigured?');
    process.exit(1);
  }

  const percentage = (100 * (total - anyCount)) / total;
  const detail = `(${total - anyCount} / ${total}) ${percentage.toFixed(2)}%`;

  if (list) {
    for (const f of findings) {
      console.log(`${f.file}:${f.line}:${f.column}  \`any\` at "${f.name}"`);
    }
  }

  if (atLeast === undefined) {
    console.log(`${detail} — ${anyCount} \`any\` position(s).`);
    return;
  }

  // Guard the comparison against float drift, e.g. 99.999999 for a 99.99 gate.
  if (percentage + 1e-9 < atLeast) {
    console.error(`type-coverage FAILED: ${detail} is below the required ${atLeast}%.`);
    console.error(`${anyCount} \`any\` position(s) must be annotated.`);
    console.error('Re-run with --list to print every offending position.');
    process.exit(1);
  }

  console.log(`type-coverage OK: ${detail} meets the required ${atLeast}%.`);
}

main();