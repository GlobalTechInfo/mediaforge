#!/usr/bin/env node
/**
 * scripts/release.mjs
 *
 * Prepares and pushes a new release:
 *  1. Validates working tree is clean
 *  2. Bumps version in package.json (patch/minor/major via arg)
 *  3. Updates deno.json version to match
 *  4. Runs build + typecheck + lint + unit tests
 *  5. Commits the version bump
 *  6. Creates and pushes a git tag (v{version})
 *  7. Pushes main branch
 *
 * Usage:
 *   npm run release          # patch bump (0.0.1 → 0.0.2)
 *   npm run release minor    # minor bump (0.0.1 → 0.1.0)
 *   npm run release major    # major bump (0.0.1 → 1.0.0)
 *   npm run release 1.2.3    # explicit version
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const run = (cmd, opts = {}) => {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
};

const runSilent = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function bumpVersion(current, type) {
  const [maj, min, pat] = current.split('.').map(Number);
  if (type === 'major') return `${maj + 1}.0.0`;
  if (type === 'minor') return `${maj}.${min + 1}.0`;
  if (type === 'patch') return `${maj}.${min}.${pat + 1}`;
  // explicit version
  if (/^\d+\.\d+\.\d+/.test(type)) return type;
  throw new Error(`Unknown bump type: ${type}`);
}

async function main() {
  const bumpType = process.argv[2] ?? 'patch';

  console.log('\n🚀 MediaForge Release Script');
  console.log('═'.repeat(50));

  // 1. Check git is clean
  console.log('\n[1/7] Checking working tree...');
  const status = runSilent('git status --porcelain');
  if (status) {
    console.error('❌ Working tree is not clean. Commit or stash changes first:\n' + status);
    process.exit(1);
  }
  const branch = runSilent('git branch --show-current');
  console.log(`  ✓ Clean. Branch: ${branch}`);

  // 2. Bump package.json
  console.log('\n[2/7] Bumping version...');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const oldVersion = pkg.version;
  const newVersion = bumpVersion(oldVersion, bumpType);
  pkg.version = newVersion;
  writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  console.log(`  ✓ package.json: ${oldVersion} → ${newVersion}`);

  // 3. Bump deno.json
  console.log('\n[3/7] Syncing deno.json version...');
  const deno = JSON.parse(readFileSync('deno.json', 'utf8'));
  deno.version = newVersion;
  writeFileSync('deno.json', JSON.stringify(deno, null, 2) + '\n');
  console.log(`  ✓ deno.json: ${newVersion}`);

  // 4. Build + checks
  console.log('\n[4/7] Running build, typecheck, lint, and unit tests...');
  run('npm run build');
  run('npm run typecheck');
  run('npm run lint');
  run('npm run test:unit');
  console.log('  ✓ All checks passed');

  // 5. Commit
  console.log('\n[5/7] Committing version bump...');
  run('git add package.json deno.json');
  run(`git commit -m "chore: release v${newVersion}"`);
  console.log(`  ✓ Committed: chore: release v${newVersion}`);

  // 6. Tag
  console.log('\n[6/7] Creating git tag...');
  run(`git tag -a "v${newVersion}" -m "Release v${newVersion}"`);
  console.log(`  ✓ Tag created: v${newVersion}`);

  // 7. Push
  console.log('\n[7/7] Pushing to origin...');
  run('git push origin main');
  run(`git push origin "v${newVersion}"`);
  console.log(`  ✓ Pushed branch and tag`);

  console.log('\n' + '═'.repeat(50));
  console.log(`✅ Released v${newVersion}`);
  console.log(`   GitHub will now trigger:`);
  console.log(`   • build-release.yml  → creates GitHub Release`);
  console.log(`   • publish.yml        → publishes to npm`);
  console.log(`   • jsr.yml            → publishes to JSR`);
  console.log(`   • docs.yml           → deploys TypeDoc to GitHub Pages`);
  console.log('═'.repeat(50) + '\n');
}

main().catch((err) => {
  console.error('\n💥', err.message);
  process.exit(1);
});
