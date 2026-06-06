import { cpSync, rmSync, chmodSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const root = join(import.meta.dirname, '..');
const tmp = join(root, '.ts2js');
const lib = join(root, 'lib');

if (existsSync(tmp)) rmSync(tmp, { recursive: true });

cpSync(lib, tmp, { recursive: true });

try {
  execSync(`find ${tmp} -name '*.ts' -exec sed -i "s/\\.ts'/\\.js'/g" {} +`);
  execSync(`find ${tmp} -name '*.ts' -exec sed -i 's/\\.ts"/\\.js"/g' {} +`);

  execSync('node_modules/.bin/tsc -p tsconfig.build.json', { stdio: 'inherit', cwd: root });
  execSync('node_modules/.bin/tsc -p tsconfig.cjs.json', { stdio: 'inherit', cwd: root });
} finally {
  rmSync(tmp, { recursive: true });
}

writeFileSync(join(root, 'dist/cjs/package.json'), JSON.stringify({ type: 'commonjs' }) + '\n');
chmodSync(join(root, 'dist/esm/cli/index.js'), 0o755);
