import { execSync, type ExecSyncOptions } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const run = (cmd: string, opts: ExecSyncOptions = {}): void => {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
};

const runSilent = (cmd: string): string =>
  execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function bumpVersion(current: string, type: string): string {
  const [maj, min, pat] = current.split('.').map(Number);
  if (type === 'major') return `${maj + 1}.0.0`;
  if (type === 'minor') return `${maj}.${min + 1}.0`;
  if (type === 'patch') return `${maj}.${min}.${pat + 1}`;
  if (/^\d+\.\d+\.\d+/.test(type)) return type;
  throw new Error(`Unknown bump type: ${type}`);
}

async function main(): Promise<void> {
  const bumpType: string = process.argv[2] ?? 'patch';

  console.log('\nMediaForge Release Script');
  console.log('='.repeat(50));

  console.log('\n[1/7] Checking working tree...');
  const status = runSilent('git status --porcelain');
  if (status) {
    console.error('Working tree is not clean. Commit or stash changes first:\n' + status);
    process.exit(1);
  }
  const branch = runSilent('git branch --show-current');
  console.log(`  OK. Branch: ${branch}`);

  console.log('\n[2/7] Bumping version...');
  const pkg: Record<string, unknown> = JSON.parse(readFileSync('package.json', 'utf8'));
  const oldVersion = pkg.version as string;
  const newVersion = bumpVersion(oldVersion, bumpType);
  pkg.version = newVersion;
  writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  console.log(`  package.json: ${oldVersion} -> ${newVersion}`);

  console.log('\n[3/7] Syncing deno.json version...');
  const deno: Record<string, unknown> = JSON.parse(readFileSync('deno.json', 'utf8'));
  deno.version = newVersion;
  writeFileSync('deno.json', JSON.stringify(deno, null, 2) + '\n');
  console.log(`  deno.json: ${newVersion}`);

  console.log('\n[4/7] Running build, typecheck, lint, and unit tests...');
  run('npm run build');
  run('npm run typecheck');
  run('npm run lint');
  run('npm run test:unit');
  console.log('  All checks passed');

  console.log('\n[5/7] Committing version bump...');
  run('git add package.json deno.json');
  run(`git commit -m "chore: release v${newVersion}"`);
  console.log(`  Committed: chore: release v${newVersion}`);

  console.log('\n[6/7] Creating git tag...');
  run(`git tag -a "v${newVersion}" -m "Release v${newVersion}"`);
  console.log(`  Tag created: v${newVersion}`);

  console.log('\n[7/7] Pushing to origin...');
  run('git push origin main');
  run(`git push origin "v${newVersion}"`);
  console.log('  Pushed branch and tag');

  console.log('\n' + '='.repeat(50));
  console.log(`Released v${newVersion}`);
  console.log('   GitHub will now trigger:');
  console.log('   *. build-release.yml  -> creates GitHub Release');
  console.log('   *. publish.yml        -> publishes to npm');
  console.log('   *. jsr.yml            -> publishes to JSR');
  console.log('   *. docs.yml           -> deploys TypeDoc to GitHub Pages');
  console.log('='.repeat(50) + '\n');
}

main().catch((err: unknown) => {
  console.error('\n', (err as Error).message);
  process.exit(1);
});
