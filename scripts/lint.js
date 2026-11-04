// Dependency-free lint: every JavaScript file must parse (node --check),
// stay ESM (no require), and the package must stay dependency-free. The
// P6-13 plan calls for minimal dependencies; zero is the enforced minimum.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dirs = ['bin', 'src', 'scripts', 'tests'];

function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...jsFiles(path));
    else if (entry.endsWith('.js')) out.push(path);
  }
  return out;
}

let failures = 0;
for (const dir of dirs) {
  for (const file of jsFiles(join(root, dir))) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
      failures += 1;
      console.error(`syntax: ${file}\n${err.stderr}`);
    }
    const source = readFileSync(file, 'utf8');
    if (/\brequire\s*\(/.test(source)) {
      failures += 1;
      console.error(`not ESM (require found): ${file}`);
    }
    if (/[ \t]+\r?\n/.test(source)) {
      failures += 1;
      console.error(`trailing whitespace: ${file}`);
    }
  }
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (pkg.dependencies || pkg.devDependencies) {
  failures += 1;
  console.error('package.json must declare no dependencies');
}

if (failures > 0) {
  console.error(`lint: ${failures} problem(s)`);
  process.exit(1);
}
console.log('lint: clean');
