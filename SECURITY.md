# Security Policy

## Supported Versions

The following versions will receive security updates promptly based on the maintainers' discretion.

| Version | Supported          |
| ------- | ------------------ |
| 2.x     | :white_check_mark: |
| 1.x     | :x:                |

## Reporting a Vulnerability

To report a vulnerability, please use the GitHub disclosure in the security tab to alert us to a security issue.

## Dependency advisories

### mediaforge ships no runtime dependencies

`package.json` has no `dependencies` and no `peerDependencies`. Everything in
this repository — the builder, the spawn layer, the filters, the codec
serialisers, the CLI — is built on the Node.js standard library
(`node:child_process`, `node:events`, `node:stream`, `node:fs`). mediaforge
drives the system `ffmpeg` binary as a subprocess and has no native bindings.

`npm audit --omit=dev` therefore reports zero findings for anything a consumer
installs. Auditing the full tree, including development tooling, also reports
zero — see the note below on how that was achieved.

### Removed: `type-coverage` and `ts-prune` (GHSA-vfj7-8cjw-p6xm)

Advisory `GHSA-vfj7-8cjw-p6xm` reports `braces` as vulnerable to
stack-exhaustion denial of service (CWE-674) through deeply nested glob
patterns. Published 2026-09-18.

**It has no fixed release.** The advisory lists a vulnerable range of
`<=3.0.3` and no patched versions, because `3.0.3` is the newest version of
`braces` that has ever been published. It reached this project through two
independent chains of development-only dependencies:

```
type-coverage → type-coverage-core → fast-glob → micromatch → braces   (vulnerable)
ts-prune      → ts-morph → @ts-morph/common → fast-glob → micromatch → braces   (vulnerable)
```

Because `micromatch@4.0.8` depends on `braces@^3.0.3` and that resolves to the
one and only `braces`, **no upgrade of any upstream package can clear this**.
Bumping `type-coverage` changes nothing on the path.

`npm audit fix --force` appears to offer a fix, but it proposes
`type-coverage@2.17.0` and `ts-prune@0.3.0` — versions just *below* the
vulnerable ranges. That is not a patch; it downgrades 13 minor versions to step
around the dependency. Do not run it.

Both tools were removed and replaced with scripts written directly against the
TypeScript compiler API, which was already a direct devDependency:

| Removed       | Replacement                        | Script                       |
| ------------- | ---------------------------------- | ---------------------------- |
| `type-coverage` | type-coverage AST measurement    | `scripts/check-type-coverage.ts` |
| `ts-prune`      | symbol-keyed dead-export analysis | `scripts/check-dead.ts`         |

Both replacements are strictly more accurate than the packages they replace.
`ts-prune` could not resolve this project's Deno-style `./x.ts` import
specifiers and could not follow the `export { x } from './y.ts'` re-export chain
that publishes the public API, so it reported roughly 1090 false positives that
an ignore list had to suppress. The replacement resolves both correctly and
reports an empty false-positive set.

The old `type-coverage` script also passed no threshold, so the CI step named
"Type coverage must stay above 99%" could never fail regardless of the result.
The replacement enforces a real gate.

A CI step (`npm audit --audit-level=moderate`) now fails the build if any
advisory reappears, so neither removal can silently rot.

### If `npm audit` ever reports this again

Check whether it is production or development scope:

- **Development only** — no consumer is affected; `npm audit --omit=dev` is the
  question that matters for the shipped artifact.
- **A new advisory** — do not reach for `npm audit fix --force`. Read the
  advisory's `patched_versions` first. When it is `undefined` or absent, there
  is no upgrade that fixes it, and the only real options are removing the
  dependency or documenting an accepted, unreachable risk.