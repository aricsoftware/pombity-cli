# pombity

Command-line client for **Pombity** (formal name: Aric Communication Service) — texting for your application, with the compliance built in.

## For agents

**What this is.** `pombity` is a thin command-line wrapper over the Pombity messaging HTTP API. It sends SMS and email, previews sends, checks consent, reads delivery reports and usage, manages API keys, and verifies destinations (phone numbers and email addresses). Every command takes `--json`, which prints the API's response body verbatim on stdout — parse that, not the human text.

**The three commands that matter.**

```bash
pombity send --to +14785550123 --body "hi" --json         # send a text
pombity report --id <messageId> --json                     # did it deliver?
pombity verify request --phone +14785550123 --json         # make a number live-sendable
pombity verify confirm --phone +14785550123 --code 123456 --json
```

An email address is verified the same way (from version 0.2.0): `pombity verify request --email you@example.com`, then `pombity verify confirm --email you@example.com --code 123456`. The code arrives by email.

**Rules the service enforces — do not re-implement them, and do not try to route around them.**

- **Consent**: the service keeps the consent ledger. A send to a number that opted out (STOP) or never opted in is refused or recorded `Blocked` — that is correct behavior, not an error to retry.
- **STOP / HELP** are handled by the service on every number it sends from. Never send your own opt-out instructions or re-text a number after a STOP.
- **Quiet hours**: non-emergency texts are held overnight in the recipient's time zone. A `Blocked`/held result at night is the rule working. A send to the key holder's own verified number is never held.
- **Quotas**: refusals come back as `quota_exceeded` with the cap, honest usage, and the reset moment (`resetsAt`). Do not retry before it; check `pombity usage`.
- **Velocity**: a burst past the per-key limit answers HTTP 429 with `Retry-After`. Back off exactly that long.
- **Verified destinations**: on a free tier, live texts go only to numbers, and live email only to addresses, that the key holder proved with `pombity verify` (`destination_not_verified` otherwise). An account holds at most 3 verified destinations in all. Sandbox sends are exempt.
- **Email**: an account without its own verified sending domain sends plain text only (`--html` is refused with `html_requires_verified_domain`) from one shared sender, notify@mail.pombity.com, shown as "Pombity". The service puts "Sent by <organization> via Pombity" as the first line of the body, and adds the unsubscribe header and the unsubscribe line to every live email that is not going to your own verified address: never write your own. An address that unsubscribed, hard-bounced, or complained is `Blocked` from then on; that is the rule working, not an error to retry.
- **Sandbox keys** (`ak_test_…`) never create carrier traffic: sends route to a simulator with realistic `Delivered` receipts, and every rule above still runs. Develop against a sandbox key.
- **Idempotency**: pass `--idempotency-key <token>` on `send`/`email`; a retry with the same key returns the original response and sends nothing. Use it for any retry logic.

**Exit codes** (branch on these, not on prose):

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | network failure, or a response without a catalog code |
| 2 | usage or configuration error (bad flags, missing key/url/tenant) |
| 3 | the API refused with a named catalog code — the code is on stderr (`pombity: <code>: …`) and, with `--json`, the full error body is on stdout |

Every API error carries a machine-readable `code` from the service's test-locked catalog (`invalid_api_key`, `quota_exceeded`, `destination_not_verified`, `content_refused`, `account_suspended`, …).

## Install

```bash
npm install -g pombity    # (not yet published; until then: npm install -g <path to this repo>)
```

Requires Node 20+. The package has zero dependencies.

## Configuration

The CLI reads, in order of precedence:

1. Flags: `--tenant`, `--api-url` (there is deliberately no `--api-key` flag — keys on command lines leak into shell history).
2. Environment: `POMBITY_API_KEY`, `POMBITY_API_URL`, `POMBITY_TENANT_ID`.
3. `~/.config/pombity/config.json` (or `$XDG_CONFIG_HOME/pombity/config.json`):
4. Default API URL when none is configured: `https://api.pombity.com`.

```json
{ "apiKey": "ak_live_…", "apiUrl": "https://…", "tenantId": "your-tenant" }
```

A config file in the **working directory is never read** (test-locked): a checked-out repository cannot plant credentials or redirect the CLI.

## Commands

Every command accepts `--json`, `--tenant <id>`, `--api-url <url>`.

| Command | What it does |
|---|---|
| `send --to <phone>… --body <text>` | Send a text. Also `--template`, `--merge k=v`, `--category`, `--correlation`, `--idempotency-key`. |
| `email --to <addr>… --subject <s> --body <text>` | Send an email. Also `--html` (needs your own verified sending domain), `--template`, `--merge`, `--category`, `--correlation`, `--idempotency-key`. |
| `preview --to <phone>… --body <text>` | Segments, recipients, consent-blocked counts — nothing is sent. |
| `consent [--phone <p>] [--history]` | Current consent for a phone, its full history, or the tenant's current list. |
| `report --id <messageId>` | One message with its delivery receipts. |
| `report [--correlation <id>] [--since <iso>] [--until <iso>] [--mode live\|sandbox]` | The message log. |
| `usage` | This month's counts, caps, and account standing. |
| `keys list` / `keys create --name <n> [--mode live\|sandbox]` / `keys revoke --id <id>` | Key lifecycle. A created key is shown **once**. Rotate = create, move over, revoke. |
| `verify request --phone <p>` / `verify confirm --phone <p> --code <c>` / `verify list` / `verify remove --phone <p>` | Verified destinations for free-tier live sends. |
| `verify request --email <e>` / `verify confirm --email <e> --code <c>` / `verify remove --email <e>` | The same for an email address (0.2.0). Exactly one of `--phone` or `--email`. |

## Development

```bash
npm test        # recorded-fixture replay tests + --json snapshots (node:test, no deps)
npm run lint    # syntax + ESM + dependency-freedom checks
```

Tests replay HTTP fixtures recorded against a real local messaging host (`scripts/record-fixtures.js`; see its header for the required seeding). `UPDATE_SNAPSHOTS=1 npm test` regenerates the `--json` snapshots deliberately.

## Publishing

`.github/workflows/publish.yml` publishes to npm **only** on a `v*` tag **and** only when the repository variable `NPM_PUBLISH_ENABLED` is `'true'`. The variable stays unset until P6-06, so tagging alone can never publish. Both locks are test-locked in `tests/workflows.test.js`.
