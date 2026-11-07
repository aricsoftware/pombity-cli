#!/usr/bin/env node
// Scheduled contract check: the recorded fixtures must still describe the live
// API. For every fixture, the live /openapi/v1.json must document the request's
// method + path; a 2xx fixture's status must be documented on that operation;
// a refusal fixture's error `code` must appear in the live document (the error
// catalog lives in the document). Drift here means the CLI's recorded contract
// no longer matches production — re-record the fixtures and release.
//
// Zero dependencies. API base from POMBITY_API_URL or the production default.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiUrl = (process.env.POMBITY_API_URL || 'https://api.pombity.com').replace(/\/+$/, '');

function pathMatches(template, actual) {
  const t = template.split('/');
  const a = actual.split('/');
  if (t.length !== a.length) return false;
  return t.every((seg, i) => (seg.startsWith('{') && seg.endsWith('}')) || seg === a[i]);
}

const response = await fetch(`${apiUrl}/openapi/v1.json`);
if (!response.ok) {
  console.error(`contract check: ${apiUrl}/openapi/v1.json answered ${response.status}`);
  process.exit(1);
}
const doc = await response.json();
const docText = JSON.stringify(doc);
const templates = Object.keys(doc.paths || {});

const fixturesDir = join(root, 'tests', 'fixtures');
const failures = [];
let checked = 0;

for (const file of readdirSync(fixturesDir).filter((f) => f.endsWith('.json'))) {
  const fixture = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'));
  const method = fixture.request.method.toLowerCase();
  const path = fixture.request.path.split('?')[0];
  checked += 1;

  const template = templates.find((t) => pathMatches(t, path));
  if (!template) {
    failures.push(`${file}: ${method.toUpperCase()} ${path} — path no longer in the live OpenAPI document`);
    continue;
  }
  const operation = doc.paths[template][method];
  if (!operation) {
    failures.push(`${file}: ${method.toUpperCase()} ${path} — method no longer documented on ${template}`);
    continue;
  }
  const status = fixture.response.status;
  if (status >= 200 && status < 300 && !(operation.responses && operation.responses[String(status)])) {
    failures.push(`${file}: ${status} no longer documented on ${method.toUpperCase()} ${template}`);
  }
  const code = fixture.response.body && fixture.response.body.code;
  if (status >= 400 && code && !docText.includes(code)) {
    failures.push(`${file}: error code "${code}" no longer appears in the live document`);
  }
}

if (failures.length > 0) {
  console.error(`contract check FAILED against ${apiUrl} (${failures.length} of ${checked} fixtures):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`contract check passed: ${checked} fixtures verified against ${apiUrl}/openapi/v1.json`);
