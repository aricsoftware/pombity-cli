import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const cliPath = join(repoRoot, 'bin', 'pombity.js');
export const TEST_KEY = 'ak_test_fixturekey000000000000000000';

/**
 * One-shot replay server: serves the fixture's recorded response and keeps
 * every request it received so the test can assert the CLI sent exactly the
 * recorded request.
 */
export function replayServer(response) {
  const received = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      received.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: raw.length > 0 ? JSON.parse(raw) : null,
      });
      res.statusCode = response.status;
      if (response.body !== undefined && response.body !== null) {
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(response.body));
      } else {
        res.end();
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        received,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

/** Spawn the CLI with a controlled environment; HOME points at an empty
 * temp dir so no real user config can leak into a test. */
export function runCli(args, env = {}) {
  const home = env.HOME ?? mkdtempSync(join(tmpdir(), 'pombity-test-'));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: env.CWD ?? repoRoot,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        ...env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
