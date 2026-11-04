// The exit-code contract: 0 success, 1 network/unexpected, 2 usage, 3 a named
// API refusal whose catalog code is surfaced on stderr (and in the --json
// body). Agents branch on these without parsing prose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayServer, runCli, TEST_KEY } from './helpers.js';

const env = (url) => ({
  POMBITY_API_URL: url,
  POMBITY_API_KEY: TEST_KEY,
  POMBITY_TENANT_ID: 'cli-dev',
});

test('a named API refusal exits 3 and surfaces the catalog code', async () => {
  const server = await replayServer({
    status: 400,
    body: { error: 'The monthly SMS cap is reached.', code: 'quota_exceeded', cap: 25, used: 25 },
  });
  try {
    const result = await runCli(['send', '--to', '+14785550123', '--body', 'hi', '--json'], env(server.url));
    assert.equal(result.code, 3);
    assert.ok(result.stderr.includes('quota_exceeded'), result.stderr);
    // --json passes the API's error body through untouched.
    const body = JSON.parse(result.stdout);
    assert.equal(body.code, 'quota_exceeded');
    assert.equal(body.cap, 25);
  } finally {
    await server.close();
  }
});

test('a 401 invalid_api_key exits 3 with the code', async () => {
  const server = await replayServer({
    status: 401,
    body: { error: 'A valid X-Api-Key header is required.', code: 'invalid_api_key' },
  });
  try {
    const result = await runCli(['usage'], env(server.url));
    assert.equal(result.code, 3);
    assert.ok(result.stderr.includes('invalid_api_key'), result.stderr);
  } finally {
    await server.close();
  }
});

test('a connection failure exits 1', async () => {
  // Port 9 (discard) refuses on loopback.
  const result = await runCli(['usage'], env('http://127.0.0.1:9'));
  assert.equal(result.code, 1);
});

test('an error response without a catalog code exits 1', async () => {
  const server = await replayServer({ status: 500, body: null });
  try {
    const result = await runCli(['usage'], env(server.url));
    assert.equal(result.code, 1);
  } finally {
    await server.close();
  }
});

test('an unknown command exits 2 with help pointer', async () => {
  const result = await runCli(['frobnicate'], env('http://127.0.0.1:9'));
  assert.equal(result.code, 2);
  assert.ok(result.stderr.includes('--help'), result.stderr);
});

test('keys without a subcommand exits 2', async () => {
  const result = await runCli(['keys'], env('http://127.0.0.1:9'));
  assert.equal(result.code, 2);
});

test('send without --to exits 2', async () => {
  const result = await runCli(['send', '--body', 'hi'], env('http://127.0.0.1:9'));
  assert.equal(result.code, 2);
  assert.ok(result.stderr.includes('--to'), result.stderr);
});

test('--help exits 0 and lists every command', async () => {
  const result = await runCli(['--help'], {});
  assert.equal(result.code, 0);
  for (const command of ['send', 'email', 'preview', 'consent', 'report', 'usage', 'keys', 'verify']) {
    assert.ok(result.stdout.includes(command), `help should list ${command}`);
  }
});

test('--version exits 0 and prints the package version', async () => {
  const result = await runCli(['--version'], {});
  assert.equal(result.code, 0);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
});
