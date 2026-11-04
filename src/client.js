/** The service refused with a named catalog code — exit code 3. The full
 * error body is preserved so --json can pass it through untouched. */
export class ApiError extends Error {
  constructor(status, body) {
    super(`${body.code}: ${body.error ?? ''}`);
    this.status = status;
    this.body = body;
    this.code = body.code;
  }
}

/** The request never completed, or the answer carried no catalog code —
 * exit code 1. */
export class TransportError extends Error {}

export async function request({ apiUrl, apiKey }, { method, path, body, headers }) {
  let response;
  try {
    response = await fetch(apiUrl + path, {
      method,
      headers: {
        'x-api-key': apiKey,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new TransportError(`request failed: ${err.cause?.message ?? err.message}`);
  }

  const text = await response.text();
  let parsed = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (response.ok) return { status: response.status, body: parsed };
  if (parsed !== null && typeof parsed.code === 'string') throw new ApiError(response.status, parsed);
  throw new TransportError(`HTTP ${response.status} from ${method} ${path} without a catalog error code`);
}
