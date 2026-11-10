// Records the HTTP fixtures in tests/fixtures/ against a REAL local messaging
// host (messaging-service, Development config: in-memory stores, fake
// providers). Each fixture holds the exact request the CLI must emit and the
// response the live host actually returned. Show-once key secrets are
// redacted at the moment of recording; API keys are never written.
//
// Usage:
//   RECORD_URL=http://127.0.0.1:5179 \
//   RECORD_ADMIN_KEY=... RECORD_SANDBOX_KEY=... \
//   node scripts/record-fixtures.js
//
// The host must be seeded with: a tenant (RECORD_TENANT, default cli-dev) on
// a UTC timezone with a sending number, a sandbox key scoped to it, and an
// opted-in consent for RECORD_PHONE (default +14785550123). The email
// verification fixtures (P6-23) also need a verified sending domain the tenant
// can use: start the host with Email__SharedDomain set and
// Email__FakeDomainAutoVerify=true, then register and verify that domain
// (PUT /v1/domains/<name>, POST /v1/domains/<name>/verify) with the admin key.
//
// RECORD_ONLY=<regex> re-records only the fixtures whose name matches and
// leaves every other fixture file untouched (their recorded answers are read
// back from disk where a later step needs them).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.RECORD_URL ?? 'http://127.0.0.1:5179';
const adminKey = process.env.RECORD_ADMIN_KEY;
const sandboxKey = process.env.RECORD_SANDBOX_KEY;
const tenant = process.env.RECORD_TENANT ?? 'cli-dev';
const phone = process.env.RECORD_PHONE ?? '+14785550123';
const verifyPhone = process.env.RECORD_VERIFY_PHONE ?? '+14785550124';
const verifyEmail = process.env.RECORD_VERIFY_EMAIL ?? 'dana@example.com';
const only = process.env.RECORD_ONLY ? new RegExp(process.env.RECORD_ONLY) : null;
const selected = (name) => !only || only.test(name);
if (!adminKey || !sandboxKey) {
  console.error('RECORD_ADMIN_KEY and RECORD_SANDBOX_KEY are required.');
  process.exit(2);
}

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const recordedAt = new Date().toISOString();

async function call(key, method, path, { body, headers } = {}) {
  const response = await fetch(url + path, {
    method,
    headers: {
      'x-api-key': key,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text.length > 0 ? JSON.parse(text) : null };
}

/** Record one exchange: send the request the CLI will emit, keep the live answer. */
async function record(name, argv, { method, path, body, headers }, { redact } = {}) {
  if (!selected(name)) {
    return JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), 'utf8')).response;
  }
  const response = await call(sandboxKey, method, path, { body, headers });
  if (redact) redact(response);
  const fixture = {
    recordedAt,
    recordedAgainst: 'messaging-service local dev host (InMemory stores, Fake/Sandbox providers)',
    argv,
    tenant,
    request: { method, path, ...(headers ? { headers } : {}), ...(body !== undefined ? { body } : {}) },
    response,
    exitCode: response.status < 400 ? 0 : response.body?.code ? 3 : 1,
  };
  writeFileSync(join(fixturesDir, `${name}.json`), JSON.stringify(fixture, null, 2) + '\n');
  console.log(`${name}: ${response.status}`);
  return response;
}

const q = (pairs) => '?' + new URLSearchParams(pairs).toString();

// --- keys ---
const created = await record(
  'keys-create',
  ['keys', 'create', '--name', 'fixture-key', '--mode', 'sandbox'],
  { method: 'POST', path: '/v1/keys', body: { tenantId: tenant, name: 'fixture-key', mode: 'sandbox' } },
  {
    redact: (response) => {
      if (response.body?.key) response.body.key = 'ak_test_[redacted-at-recording]';
    },
  },
);

await record('keys-list', ['keys', 'list'], {
  method: 'GET',
  path: '/v1/keys' + q({ tenantId: tenant }),
});

await record('keys-revoke', ['keys', 'revoke', '--id', created.body.id], {
  method: 'DELETE',
  path: `/v1/keys/${created.body.id}` + q({ tenantId: tenant }),
});

// --- send / report ---
const sent = await record('send', ['send', '--to', phone, '--body', 'hi', '--idempotency-key', 'fixture-send-1'], {
  method: 'POST',
  path: '/v1/messages',
  headers: { 'idempotency-key': 'fixture-send-1' },
  body: { tenantId: tenant, to: [phone], body: 'hi' },
});

const messageId = sent.body.messages[0].id;
const correlationId = sent.body.correlationId;

await record('report-id', ['report', '--id', messageId], {
  method: 'GET',
  path: `/v1/messages/${messageId}` + q({ tenantId: tenant }),
});

await record('report-list', ['report', '--correlation', correlationId], {
  method: 'GET',
  path: '/v1/messages' + q({ tenantId: tenant, correlationId }),
});

// --- email / preview / consent / usage ---
await record('email', ['email', '--to', 'dev@example.com', '--subject', 'Hello', '--body', 'hi'], {
  method: 'POST',
  path: '/v1/emails',
  body: { tenantId: tenant, to: ['dev@example.com'], subject: 'Hello', body: 'hi' },
});

await record('preview', ['preview', '--to', phone, '--body', 'hi'], {
  method: 'POST',
  path: '/v1/messages/preview',
  body: { tenantId: tenant, to: [phone], body: 'hi' },
});

await record('consent', ['consent', '--phone', phone], {
  method: 'GET',
  path: '/v1/consents' + q({ tenantId: tenant, phone }),
});

await record('usage', ['usage'], {
  method: 'GET',
  path: '/v1/usage' + q({ tenantId: tenant }),
});

// --- verified destinations ---
await record('verify-request', ['verify', 'request', '--phone', verifyPhone], {
  method: 'POST',
  path: '/v1/verified-destinations',
  body: { tenantId: tenant, phone: verifyPhone },
});

// The real code never leaves the provider (by design: it is texted to the
// phone and appears in no log, audit row, or API response), so the recorded
// confirm is the wrong-code refusal — the CLI's named-error path.
await record('verify-confirm', ['verify', 'confirm', '--phone', verifyPhone, '--code', '000000'], {
  method: 'POST',
  path: '/v1/verified-destinations/confirm',
  body: { tenantId: tenant, phone: verifyPhone, code: '000000' },
});

await record('verify-list', ['verify', 'list'], {
  method: 'GET',
  path: '/v1/verified-destinations' + q({ tenantId: tenant }),
});

// Nothing is verified on the recording host, so remove records the honest
// indistinguishable 404 — the CLI's not_found path.
await record('verify-remove', ['verify', 'remove', '--phone', verifyPhone], {
  method: 'DELETE',
  path: `/v1/verified-destinations/${encodeURIComponent(verifyPhone)}` + q({ tenantId: tenant }),
});

// --- verified destinations, the email form (P6-23) ---
// The code is emailed through the live provider even for a sandbox key.
await record('verify-request-email', ['verify', 'request', '--email', verifyEmail], {
  method: 'POST',
  path: '/v1/verified-destinations',
  body: { tenantId: tenant, email: verifyEmail },
});

// As with the phone: the real code never leaves the provider, so the recorded
// confirm is the wrong-code refusal.
await record('verify-confirm-email', ['verify', 'confirm', '--email', verifyEmail, '--code', '000000'], {
  method: 'POST',
  path: '/v1/verified-destinations/confirm',
  body: { tenantId: tenant, email: verifyEmail, code: '000000' },
});

await record('verify-remove-email', ['verify', 'remove', '--email', verifyEmail], {
  method: 'DELETE',
  path: `/v1/verified-destinations/${encodeURIComponent(verifyEmail)}` + q({ tenantId: tenant }),
});

// --- quota refusal, produced for real: cap the sandbox allowance at 0 ---
if (selected('send-quota-exceeded')) {
  const capped = await call(adminKey, 'PUT', `/v1/tenants/${tenant}`, { body: { sandboxSmsMonthlyCap: 0 } });
  if (capped.status !== 200) {
    console.error(`could not cap tenant for the quota fixture: ${capped.status}`);
    process.exit(1);
  }
  await record('send-quota-exceeded', ['send', '--to', phone, '--body', 'over the cap'], {
    method: 'POST',
    path: '/v1/messages',
    body: { tenantId: tenant, to: [phone], body: 'over the cap' },
  });
  await call(adminKey, 'PUT', `/v1/tenants/${tenant}`, { body: { sandboxSmsMonthlyCap: -1 } });
}

console.log('done');
