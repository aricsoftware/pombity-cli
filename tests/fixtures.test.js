// Recorded-fixture tests: every command replays a real HTTP exchange recorded
// against a local messaging host (scripts/record-fixtures.js). Each test
// asserts the CLI reproduces the recorded request exactly and that its --json
// output matches the committed snapshot. Regenerate snapshots deliberately
// with UPDATE_SNAPSHOTS=1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { replayServer, runCli, repoRoot, TEST_KEY } from './helpers.js';

const fixturesDir = join(repoRoot, 'tests', 'fixtures');
const snapshotsDir = join(repoRoot, 'tests', 'snapshots');
const update = process.env.UPDATE_SNAPSHOTS === '1';

const fixtureFiles = readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));

test('there is a fixture for every command', () => {
  const commands = ['send', 'email', 'preview', 'consent', 'report', 'usage', 'keys', 'verify'];
  for (const command of commands) {
    assert.ok(
      fixtureFiles.some((f) => {
        const { argv } = JSON.parse(readFileSync(join(fixturesDir, f), 'utf8'));
        return argv[0] === command;
      }),
      `no recorded fixture exercises "${command}"`,
    );
  }
});

for (const file of fixtureFiles) {
  const name = file.replace(/\.json$/, '');
  const fixture = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'));

  test(`fixture ${name}: --json replays the recorded exchange`, async () => {
    const server = await replayServer(fixture.response);
    try {
      const result = await runCli([...fixture.argv, '--json'], {
        POMBITY_API_URL: server.url,
        POMBITY_API_KEY: TEST_KEY,
        POMBITY_TENANT_ID: fixture.tenant,
      });

      // The CLI sent exactly the recorded request.
      assert.equal(server.received.length, 1, 'expected exactly one HTTP request');
      const sent = server.received[0];
      assert.equal(sent.method, fixture.request.method);
      assert.equal(sent.url, fixture.request.path);
      assert.equal(sent.headers['x-api-key'], TEST_KEY);
      for (const [header, value] of Object.entries(fixture.request.headers ?? {})) {
        assert.equal(sent.headers[header.toLowerCase()], value, `header ${header}`);
      }
      assert.deepEqual(sent.body, fixture.request.body ?? null);

      // Exit code is the recorded outcome.
      assert.equal(result.code, fixture.exitCode);

      // A named API error surfaces its catalog code on stderr.
      if (fixture.exitCode === 3) {
        assert.ok(
          result.stderr.includes(fixture.response.body.code),
          `stderr should carry the catalog code: ${result.stderr}`,
        );
      }

      // --json output matches the committed snapshot byte for byte.
      const snapshotPath = join(snapshotsDir, `${name}.out`);
      if (update) {
        writeFileSync(snapshotPath, result.stdout);
      } else {
        assert.ok(existsSync(snapshotPath), `missing snapshot ${name}.out (run UPDATE_SNAPSHOTS=1)`);
        assert.equal(result.stdout, readFileSync(snapshotPath, 'utf8'));
      }
    } finally {
      await server.close();
    }
  });

  test(`fixture ${name}: human output exits the same way`, async () => {
    const server = await replayServer(fixture.response);
    try {
      const result = await runCli(fixture.argv, {
        POMBITY_API_URL: server.url,
        POMBITY_API_KEY: TEST_KEY,
        POMBITY_TENANT_ID: fixture.tenant,
      });
      assert.equal(result.code, fixture.exitCode);
      if (fixture.exitCode === 0 && fixture.response.status !== 204) {
        assert.ok(result.stdout.length > 0, 'human mode should say something');
      }
    } finally {
      await server.close();
    }
  });
}
