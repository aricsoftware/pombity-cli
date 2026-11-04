import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commands } from './commands.js';
import { resolveConfig, UsageError } from './config.js';
import { request, ApiError, TransportError } from './client.js';

// Exit codes — the contract agents branch on:
//   0 success · 1 network or unexpected failure · 2 usage/configuration
//   3 the API refused with a named catalog code (printed on stderr, and the
//     full error body on stdout under --json)
const EXIT_OK = 0;
const EXIT_TRANSPORT = 1;
const EXIT_USAGE = 2;
const EXIT_API = 3;

const globalOptions = {
  json: { type: 'boolean' },
  tenant: { type: 'string' },
  'api-url': { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean' },
};

function helpText() {
  const lines = ['pombity — texting for your application, with the compliance built in', '', 'Commands:'];
  for (const [name, spec] of Object.entries(commands)) {
    lines.push(`  ${name.padEnd(8)} ${spec.summary}`);
  }
  lines.push(
    '',
    'Every command takes --json (raw API response on stdout), --tenant, --api-url.',
    'Configuration: POMBITY_API_KEY, POMBITY_API_URL, POMBITY_TENANT_ID, or',
    '~/.config/pombity/config.json {"apiKey","apiUrl","tenantId"}.',
    'Exit codes: 0 ok · 1 network · 2 usage · 3 named API refusal (code on stderr).',
  );
  return lines.join('\n');
}

function version() {
  const pkg = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
  );
  return pkg.version;
}

export async function main(argv, env) {
  try {
    return await run(argv, env);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`pombity: ${err.message}\nrun "pombity --help" for usage\n`);
      return EXIT_USAGE;
    }
    if (err instanceof ApiError) {
      process.stderr.write(`pombity: ${err.code}: ${err.body.error ?? ''}\n`);
      if (argv.includes('--json')) {
        process.stdout.write(JSON.stringify(err.body, null, 2) + '\n');
      }
      return EXIT_API;
    }
    if (err instanceof TransportError) {
      process.stderr.write(`pombity: ${err.message}\n`);
      return EXIT_TRANSPORT;
    }
    process.stderr.write(`pombity: unexpected: ${err.stack ?? err.message}\n`);
    return EXIT_TRANSPORT;
  }
}

async function run(argv, env) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(helpText() + '\n');
    return EXIT_OK;
  }
  if (argv[0] === '--version') {
    process.stdout.write(version() + '\n');
    return EXIT_OK;
  }

  const [commandName, ...rest] = argv;
  const command = commands[commandName];
  if (!command) throw new UsageError(`unknown command "${commandName}"`);

  let spec = command;
  let args = rest;
  if (command.sub) {
    const subName = rest[0];
    spec = command.sub[subName];
    if (!spec) {
      throw new UsageError(
        `"${commandName}" needs a subcommand: ${Object.keys(command.sub).join(' | ')}`,
      );
    }
    args = rest.slice(1);
  }

  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: { ...globalOptions, ...spec.options },
      allowPositionals: false,
      strict: true,
    }));
  } catch (err) {
    throw new UsageError(err.message);
  }

  if (values.help) {
    process.stdout.write((command.summary ?? spec.summary ?? commandName) + '\n');
    return EXIT_OK;
  }

  const config = resolveConfig(values, env);
  const requestSpec = spec.run(values, config.tenantId);
  const { status, body } = await request(config, requestSpec);

  if (values.json) {
    if (body !== null) process.stdout.write(JSON.stringify(body, null, 2) + '\n');
  } else if (body !== null) {
    process.stdout.write(spec.human(body) + '\n');
  } else if (status === 204) {
    process.stdout.write(spec.human(null) + '\n');
  }
  return EXIT_OK;
}
