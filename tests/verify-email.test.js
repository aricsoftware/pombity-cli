// P6-23: verified destinations take an email address as well as a phone
// number. `verify request|confirm|remove` accept exactly one of --phone or
// --email; the email form sends `email` (never `phone`) in the request body,
// and the phone form is byte-for-byte what it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayServer, runCli, TEST_KEY } from './helpers.js';

const env = (url) => ({
  POMBITY_API_URL: url,
  POMBITY_API_KEY: TEST_KEY,
  POMBITY_TENANT_ID: 'cli-dev',
});
const ADDRESS = 'dana@example.com';

test('verify request --email posts the email form', async () => {
  const server = await replayServer({
    status: 200,
    body: { tenantId: 'cli-dev', status: 'code-sent', expiresAt: '2026-11-09T15:14:05+00:00' },
  });
  try {
    const result = await runCli(['verify', 'request', '--email', ADDRESS], env(server.url));
    assert.equal(result.code, 0, result.stderr);
    const sent = server.received[0];
    assert.equal(sent.method, 'POST');
    assert.equal(sent.url, '/v1/verified-destinations');
    assert.deepEqual(sent.body, { tenantId: 'cli-dev', email: ADDRESS });
    assert.ok(result.stdout.includes('code sent'), result.stdout);
  } finally {
    await server.close();
  }
});

test('verify confirm --email posts the email form and names the address', async () => {
  const server = await replayServer({
    status: 200,
    body: { tenantId: 'cli-dev', email: ADDRESS, verifiedAt: '2026-11-09T15:05:11+00:00' },
  });
  try {
    const result = await runCli(
      ['verify', 'confirm', '--email', ADDRESS, '--code', '123456'],
      env(server.url),
    );
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(server.received[0].body, { tenantId: 'cli-dev', email: ADDRESS, code: '123456' });
    assert.ok(result.stdout.includes(`verified ${ADDRESS}`), result.stdout);
    assert.ok(!result.stdout.includes('undefined'), result.stdout);
  } finally {
    await server.close();
  }
});

test('verify remove --email deletes the URL-encoded address', async () => {
  const server = await replayServer({ status: 204, body: null });
  try {
    const result = await runCli(['verify', 'remove', '--email', ADDRESS], env(server.url));
    assert.equal(result.code, 0, result.stderr);
    const sent = server.received[0];
    assert.equal(sent.method, 'DELETE');
    assert.equal(sent.url, '/v1/verified-destinations/dana%40example.com?tenantId=cli-dev');
  } finally {
    await server.close();
  }
});

test('verify list shows numbers and addresses', async () => {
  const server = await replayServer({
    status: 200,
    body: [
      { phone: '+14785550123', verifiedAt: '2026-11-02T15:05:11+00:00' },
      { email: ADDRESS, verifiedAt: '2026-11-09T15:05:11+00:00' },
    ],
  });
  try {
    const result = await runCli(['verify', 'list'], env(server.url));
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes('+14785550123'), result.stdout);
    assert.ok(result.stdout.includes(ADDRESS), result.stdout);
    assert.ok(!result.stdout.includes('undefined'), result.stdout);
  } finally {
    await server.close();
  }
});

test('the phone form is unchanged: no email key is ever sent', async () => {
  const server = await replayServer({
    status: 200,
    body: { tenantId: 'cli-dev', status: 'code-sent', expiresAt: '2026-11-09T15:14:05+00:00' },
  });
  try {
    await runCli(['verify', 'request', '--phone', '+14785550123'], env(server.url));
    assert.deepEqual(server.received[0].body, { tenantId: 'cli-dev', phone: '+14785550123' });
  } finally {
    await server.close();
  }
});

for (const sub of ['request', 'confirm', 'remove']) {
  // Only confirm takes --code.
  const code = sub === 'confirm' ? ['--code', '123456'] : [];
  test(`verify ${sub} with both --phone and --email exits 2 and sends nothing`, async () => {
    const server = await replayServer({ status: 200, body: {} });
    try {
      const result = await runCli(
        ['verify', sub, '--phone', '+14785550123', '--email', ADDRESS, ...code],
        env(server.url),
      );
      assert.equal(result.code, 2);
      assert.ok(result.stderr.includes('--phone') && result.stderr.includes('--email'), result.stderr);
      assert.equal(server.received.length, 0);
    } finally {
      await server.close();
    }
  });

  test(`verify ${sub} with neither --phone nor --email exits 2`, async () => {
    const result = await runCli(['verify', sub, ...code], env('http://127.0.0.1:9'));
    assert.equal(result.code, 2);
    assert.ok(result.stderr.includes('--phone') && result.stderr.includes('--email'), result.stderr);
  });
}

test('help names the email form', async () => {
  const result = await runCli(['--help'], {});
  assert.equal(result.code, 0);
  assert.ok(result.stdout.includes('--email'), result.stdout);
});
