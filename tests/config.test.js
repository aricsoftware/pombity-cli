// The API key comes from the environment or a config file in the user's
// home — NEVER from a file in the working directory (a repo checkout must not
// be able to plant credentials or redirect the CLI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { replayServer, runCli, TEST_KEY } from './helpers.js';
import { resolveConfig, DEFAULT_API_URL } from '../src/config.js';

const OK = { status: 200, body: { tenantId: 'cli-dev', standing: 'ok' } };

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'pombity-home-'));
}

function writeHomeConfig(home, config) {
  const dir = join(home, '.config', 'pombity');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
}

test('missing API key refuses with a usage error naming POMBITY_API_KEY', async () => {
  const result = await runCli(['usage'], {
    POMBITY_API_URL: 'http://127.0.0.1:9',
    POMBITY_TENANT_ID: 'cli-dev',
  });
  assert.equal(result.code, 2);
  assert.ok(result.stderr.includes('POMBITY_API_KEY'), result.stderr);
});

test('with no URL configured anywhere, the production default is used', () => {
  const home = tempHome();
  const config = resolveConfig({}, {
    POMBITY_API_KEY: TEST_KEY,
    POMBITY_TENANT_ID: 'cli-dev',
    HOME: home,
  });
  assert.equal(config.apiUrl, DEFAULT_API_URL);
  assert.equal(DEFAULT_API_URL, 'https://api.pombity.com');
});

test('an explicit URL still wins over the default', () => {
  const home = tempHome();
  const config = resolveConfig({}, {
    POMBITY_API_KEY: TEST_KEY,
    POMBITY_TENANT_ID: 'cli-dev',
    POMBITY_API_URL: 'http://127.0.0.1:9',
    HOME: home,
  });
  assert.equal(config.apiUrl, 'http://127.0.0.1:9');
});

test('missing tenant refuses with a usage error naming --tenant and POMBITY_TENANT_ID', async () => {
  const result = await runCli(['usage'], {
    POMBITY_API_KEY: TEST_KEY,
    POMBITY_API_URL: 'http://127.0.0.1:9',
  });
  assert.equal(result.code, 2);
  assert.ok(result.stderr.includes('POMBITY_TENANT_ID'), result.stderr);
  assert.ok(result.stderr.includes('--tenant'), result.stderr);
});

test('key, url, and tenant resolve from the home config file', async () => {
  const server = await replayServer(OK);
  try {
    const home = tempHome();
    writeHomeConfig(home, { apiKey: TEST_KEY, apiUrl: server.url, tenantId: 'cli-dev' });
    const result = await runCli(['usage', '--json'], { HOME: home });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(server.received[0].headers['x-api-key'], TEST_KEY);
    assert.equal(server.received[0].url, '/v1/usage?tenantId=cli-dev');
  } finally {
    await server.close();
  }
});

test('the environment wins over the home config file', async () => {
  const server = await replayServer(OK);
  try {
    const home = tempHome();
    writeHomeConfig(home, { apiKey: 'ak_test_fromconfigfile0000000000000', apiUrl: server.url, tenantId: 'cli-dev' });
    const result = await runCli(['usage', '--json'], { HOME: home, POMBITY_API_KEY: TEST_KEY });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(server.received[0].headers['x-api-key'], TEST_KEY);
  } finally {
    await server.close();
  }
});

test('config files in the working directory are ignored', async () => {
  // Plant every plausible config filename in the CWD; with an empty HOME and
  // no env, the CLI must still refuse for want of a key.
  const cwd = mkdtempSync(join(tmpdir(), 'pombity-cwd-'));
  const planted = { apiKey: 'ak_live_plantedinworkingdir00000000', apiUrl: 'http://127.0.0.1:9', tenantId: 'cli-dev' };
  for (const name of ['config.json', '.pombityrc', 'pombity.config.json', '.pombity.json']) {
    writeFileSync(join(cwd, name), JSON.stringify(planted));
  }
  const result = await runCli(['usage'], { CWD: cwd });
  assert.equal(result.code, 2, `working-directory config must not be read: ${result.stdout}${result.stderr}`);
  assert.ok(result.stderr.includes('POMBITY_API_KEY'), result.stderr);
});

test('--tenant flag wins over the environment', async () => {
  const server = await replayServer(OK);
  try {
    const result = await runCli(['usage', '--tenant', 'other-tenant', '--json'], {
      POMBITY_API_URL: server.url,
      POMBITY_API_KEY: TEST_KEY,
      POMBITY_TENANT_ID: 'cli-dev',
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(server.received[0].url, '/v1/usage?tenantId=other-tenant');
  } finally {
    await server.close();
  }
});
