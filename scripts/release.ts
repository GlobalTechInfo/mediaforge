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
  try {
    run('npm run build');
    run('npm run typecheck');
    run('npm run lint');
    run('npm run test:unit');
  } catch {
    // package.json / deno.json have already been rewritten to the new version,
    // but nothing is committed and no tag exists yet. Say so, because "the
    // working tree is not clean" is otherwise a confusing thing to find next.
    console.error(
      '\n  Checks failed — no commit or tag was created.\n' +
      '  package.json and deno.json are still set to the new version in your working\n' +
      '  tree. To start over, discard that edit:\n\n' +
      `      git checkout -- package.json deno.json\n\n` +
      '  (It is safe: nothing has been committed or tagged at this point.)\n',
    );
    process.exit(1);
  }
  console.log('  All checks passed');

  console.log('\n[5/7] Committing version bump...');
  run('git add package.json deno.json');
  run(`git commit -m "chore: release v${newVersion}"`);
  console.log(`  Committed: chore: release v${newVersion}`);

  console.log('\n[6/7] Creating git tag...');
  run(`git tag -a "v${newVersion}" -m "Release v${newVersion}"`);
  console.log(`  Tag created: v${newVersion}`);

  console.log('\n[7/7] Pushing to origin...');
  try {
    run('git push origin main');
    run(`git push origin "v${newVersion}"`);
  } catch {
    // The push is the one step that can fail purely because of the
    // environment: this script runs `git push` in a child process, and some
    // sandboxes/agents inject their short-lived git credential only into
    // git commands they invoke directly, not into nested ones. When that
    // happens the commit and tag are already created locally, so the release
    // is *not* lost — it just needs finishing by hand.
    console.error(
      '\n  Push failed.\n' +
      '  The version bump is committed and the tag exists locally, so the release\n' +
      '  is ready — it only needs to be pushed. Run these yourself:\n\n' +
      `      git push origin main\n` +
      `      git push origin v${newVersion}\n\n` +
      '  If the error is "could not read Username for https://github.com", the\n' +
      '  credential was not available to this child process rather than missing.\n',
    );
    process.exit(1);
  }
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
