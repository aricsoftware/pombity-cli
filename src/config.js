import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** A problem with how the CLI was invoked or configured — exit code 2. */
export class UsageError extends Error {}

/**
 * The config file lives in the user's home (XDG config dir), NEVER in the
 * working directory: a checked-out repository must not be able to plant
 * credentials or point the CLI at another host.
 */
export function configFilePath(env) {
  const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config');
  return join(base, 'pombity', 'config.json');
}

function readConfigFile(env) {
  try {
    return JSON.parse(readFileSync(configFilePath(env), 'utf8'));
  } catch {
    return {};
  }
}

/** Resolution order: flag (where one exists), then environment, then the
 * home config file. The API key deliberately has no flag — keys on command
 * lines leak into shell history and process listings. */
export function resolveConfig(flags, env) {
  const file = readConfigFile(env);
  const apiKey = env.POMBITY_API_KEY || file.apiKey;
  const apiUrl = flags['api-url'] || env.POMBITY_API_URL || file.apiUrl;
  const tenantId = flags.tenant || env.POMBITY_TENANT_ID || file.tenantId;

  if (!apiKey) {
    throw new UsageError(
      'no API key: set POMBITY_API_KEY, or put {"apiKey": "..."} in '
        + `${configFilePath(env)} (a config file in the working directory is never read)`,
    );
  }
  if (!apiUrl) {
    throw new UsageError(
      'no API URL: set POMBITY_API_URL, pass --api-url, or put {"apiUrl": "..."} in '
        + configFilePath(env),
    );
  }
  if (!tenantId) {
    throw new UsageError(
      'no tenant: pass --tenant, set POMBITY_TENANT_ID, or put {"tenantId": "..."} in '
        + configFilePath(env),
    );
  }
  return { apiKey, apiUrl: apiUrl.replace(/\/+$/, ''), tenantId };
}
