// Locks on the release train: the npm publish workflow runs ONLY on a v* tag
// AND only when the repository variable NPM_PUBLISH_ENABLED is 'true' — the
// variable stays unset until P6-06, so a stray tag can never publish. CI runs
// lint and test on push. The package stays dependency-free.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './helpers.js';

const publish = readFileSync(join(repoRoot, '.github', 'workflows', 'publish.yml'), 'utf8');
const ci = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

test('publish workflow triggers only on v* tags', () => {
  assert.match(publish, /on:\s*\n\s+push:\s*\n\s+tags:\s*\n\s+- ["']v\*["']/, 'must trigger on push of v* tags');
  for (const trigger of ['workflow_dispatch', 'pull_request', 'schedule', 'branches']) {
    assert.ok(!publish.includes(trigger), `publish workflow must not trigger on ${trigger}`);
  }
});

test('publish workflow is blocked until the repository variable is set', () => {
  const gate = publish.indexOf("if: ${{ vars.NPM_PUBLISH_ENABLED == 'true' }}");
  const publishStep = publish.indexOf('npm publish');
  assert.ok(gate !== -1, 'the NPM_PUBLISH_ENABLED gate is missing');
  assert.ok(publishStep !== -1, 'npm publish step is missing');
  assert.ok(gate < publishStep, 'the gate must sit on the job, before npm publish');
  // One job only: a second ungated job could slip past the variable.
  assert.equal(publish.match(/runs-on:/g).length, 1, 'publish.yml must hold exactly one job');
});

test('publish workflow runs the suite before publishing', () => {
  const lint = publish.indexOf('npm run lint');
  const tests = publish.indexOf('npm test');
  const publishStep = publish.indexOf('npm publish');
  assert.ok(lint !== -1 && lint < publishStep, 'lint must run before publish');
  assert.ok(tests !== -1 && tests < publishStep, 'tests must run before publish');
});

test('publish workflow uses npm trusted publishing, never a token', () => {
  assert.ok(publish.includes('id-token: write'), 'OIDC needs the id-token: write permission');
  assert.ok(!publish.includes('NODE_AUTH_TOKEN'), 'no token env: trusted publishing only');
  assert.ok(!publish.includes('NPM_TOKEN'), 'no token secret: trusted publishing only');
  assert.ok(publish.includes('npm install -g npm@^11.5.1'), 'trusted publishing needs npm 11.5.1+');
  assert.ok(publish.includes('--provenance'), 'provenance stays on (public repository)');
});

test('the contract check runs on a schedule and never publishes', () => {
  const contract = readFileSync(join(repoRoot, '.github', 'workflows', 'contract.yml'), 'utf8');
  assert.ok(contract.includes('schedule'), 'contract check must be scheduled');
  assert.ok(contract.includes('node scripts/check-contract.js'), 'must run the contract script');
  assert.ok(!contract.includes('npm publish'), 'the contract workflow must never publish');
  assert.ok(!contract.includes('id-token'), 'the contract workflow needs no OIDC');
});

test('CI runs lint and test on push', () => {
  assert.match(ci, /on:\s*\n\s+push:/, 'CI must run on push');
  assert.ok(ci.includes('npm run lint'), 'CI must lint');
  assert.ok(ci.includes('npm test'), 'CI must test');
});

test('the package has no dependencies and ships as the pombity command', () => {
  assert.equal(pkg.name, 'pombity');
  assert.equal(pkg.bin.pombity, 'bin/pombity.js');
  assert.equal(pkg.dependencies, undefined, 'runtime dependencies are not allowed');
  assert.equal(pkg.devDependencies, undefined, 'dev dependencies are not allowed');
  assert.match(pkg.engines.node, />=20/);
});
