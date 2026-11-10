import { UsageError } from './config.js';

const q = (pairs) => '?' + new URLSearchParams(pairs).toString();

function need(values, flag) {
  const value = values[flag.replace(/^--/, '')];
  if (value === undefined || (Array.isArray(value) && value.length === 0)) {
    throw new UsageError(`${flag.startsWith('--') ? flag : '--' + flag} is required`);
  }
  return value;
}

/** A verified destination is exactly one of a phone number or an email
 * address; the request carries the one that was given, under its own key. */
function destination(values) {
  const hasPhone = values.phone !== undefined;
  const hasEmail = values.email !== undefined;
  if (hasPhone === hasEmail) {
    throw new UsageError('exactly one of --phone or --email is required');
  }
  return hasPhone ? { phone: values.phone } : { email: values.email };
}

function bodyOrTemplate(values) {
  if (values.body === undefined && values.template === undefined) {
    throw new UsageError('one of --body or --template is required');
  }
}

/** --merge key=value pairs → the API's mergeFields object. */
function mergeFields(values) {
  if (!values.merge) return undefined;
  const fields = {};
  for (const pair of values.merge) {
    const eq = pair.indexOf('=');
    if (eq <= 0) throw new UsageError(`--merge expects key=value, not "${pair}"`);
    fields[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return fields;
}

function withIdempotency(values) {
  return values['idempotency-key'] !== undefined
    ? { headers: { 'idempotency-key': values['idempotency-key'] } }
    : {};
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined));
}

const sendResult = (body) =>
  [`correlation ${body.correlationId}`]
    .concat(
      body.messages.map(
        (m) =>
          `  ${m.to}  ${m.status}${m.deliveryStatus ? ` (${m.deliveryStatus})` : ''}${m.sandbox ? '  [sandbox]' : ''}`,
      ),
    )
    .join('\n');

const consentLine = (c) =>
  `${c.phone}  ${c.status}  (${c.source}${c.campaign ? `, ${c.campaign}` : ''}, ${c.occurredAt})`;

const messageLine = (m) =>
  `${m.id}  ${m.to}  ${m.status}${m.deliveryStatus ? ` (${m.deliveryStatus})` : ''}${m.sandbox ? '  [sandbox]' : ''}  ${m.createdAt}`;

export const commands = {
  send: {
    summary: 'Send a text message: pombity send --to +14785550123 --body "hi"',
    options: {
      to: { type: 'string', multiple: true },
      body: { type: 'string' },
      template: { type: 'string' },
      merge: { type: 'string', multiple: true },
      category: { type: 'string' },
      correlation: { type: 'string' },
      'idempotency-key': { type: 'string' },
    },
    run(values, tenantId) {
      need(values, '--to');
      bodyOrTemplate(values);
      return {
        method: 'POST',
        path: '/v1/messages',
        ...withIdempotency(values),
        body: compact({
          tenantId,
          to: values.to,
          body: values.body,
          templateId: values.template,
          mergeFields: mergeFields(values),
          category: values.category,
          correlationId: values.correlation,
        }),
      };
    },
    human: sendResult,
  },

  email: {
    summary: 'Send an email: pombity email --to dev@example.com --subject Hello --body "hi"',
    options: {
      to: { type: 'string', multiple: true },
      subject: { type: 'string' },
      body: { type: 'string' },
      template: { type: 'string' },
      merge: { type: 'string', multiple: true },
      html: { type: 'boolean' },
      category: { type: 'string' },
      correlation: { type: 'string' },
      'idempotency-key': { type: 'string' },
    },
    run(values, tenantId) {
      need(values, '--to');
      bodyOrTemplate(values);
      return {
        method: 'POST',
        path: '/v1/emails',
        ...withIdempotency(values),
        body: compact({
          tenantId,
          to: values.to,
          subject: values.subject,
          body: values.body,
          templateId: values.template,
          mergeFields: mergeFields(values),
          isHtml: values.html ? true : undefined,
          category: values.category,
          correlationId: values.correlation,
        }),
      };
    },
    human: sendResult,
  },

  preview: {
    summary: 'Preview a send without sending: segments, recipients, consent-blocked',
    options: {
      to: { type: 'string', multiple: true },
      body: { type: 'string' },
      template: { type: 'string' },
      merge: { type: 'string', multiple: true },
    },
    run(values, tenantId) {
      need(values, '--to');
      bodyOrTemplate(values);
      return {
        method: 'POST',
        path: '/v1/messages/preview',
        body: compact({
          tenantId,
          to: values.to,
          body: values.body,
          templateId: values.template,
          mergeFields: mergeFields(values),
        }),
      };
    },
    human: (b) =>
      `recipients ${b.recipients}  segments ${b.segments}  consentBlocked ${b.consentBlocked}  invalid ${b.invalidRecipients}`,
  },

  consent: {
    summary: 'Check consent: pombity consent --phone +14785550123 [--history]',
    options: {
      phone: { type: 'string' },
      history: { type: 'boolean' },
    },
    run(values, tenantId) {
      const pairs = { tenantId };
      if (values.phone !== undefined) pairs.phone = values.phone;
      if (values.history) {
        if (values.phone === undefined) throw new UsageError('--history needs --phone');
        pairs.history = 'true';
      }
      return { method: 'GET', path: '/v1/consents' + q(pairs) };
    },
    human: (b) => (Array.isArray(b) ? b.map(consentLine).join('\n') || '(none)' : consentLine(b)),
  },

  report: {
    summary: 'Delivery report: pombity report --id <messageId> | --correlation <id> [--since --until --mode]',
    options: {
      id: { type: 'string' },
      correlation: { type: 'string' },
      since: { type: 'string' },
      until: { type: 'string' },
      mode: { type: 'string' },
    },
    run(values, tenantId) {
      if (values.id !== undefined) {
        return { method: 'GET', path: `/v1/messages/${values.id}` + q({ tenantId }) };
      }
      const pairs = { tenantId };
      if (values.correlation !== undefined) pairs.correlationId = values.correlation;
      if (values.since !== undefined) pairs.from = values.since;
      if (values.until !== undefined) pairs.to = values.until;
      if (values.mode !== undefined) pairs.mode = values.mode;
      return { method: 'GET', path: '/v1/messages' + q(pairs) };
    },
    human: (b) =>
      Array.isArray(b)
        ? b.map(messageLine).join('\n') || '(no messages)'
        : [
            messageLine(b),
            `  category ${b.category}  segments ${b.segments}  correlation ${b.correlationId}`,
            ...(b.deliveries ?? []).map((d) => `  delivery ${d.status}  ${d.receivedAt}${d.detail ? `  (${d.detail})` : ''}`),
          ].join('\n'),
  },

  usage: {
    summary: 'This month\'s usage, caps, and account standing',
    options: {},
    run(values, tenantId) {
      return { method: 'GET', path: '/v1/usage' + q({ tenantId }) };
    },
    human: (b) =>
      [
        `sms ${b.sms.sent}${b.sms.cap != null ? `/${b.sms.cap}` : ''} (sandbox ${b.sms.sandbox.sent}${b.sms.sandbox.cap != null ? `/${b.sms.sandbox.cap}` : ''})`,
        `email ${b.email.sent}${b.email.cap != null ? `/${b.email.cap}` : ''} (sandbox ${b.email.sandbox.sent})`,
        `period resets ${b.period.resetsAt}`,
        `standing ${b.standing}`,
      ].join('\n'),
  },

  keys: {
    summary: 'API keys: pombity keys list | create --name <n> [--mode live|sandbox] | revoke --id <id>',
    sub: {
      list: {
        options: {},
        run(values, tenantId) {
          return { method: 'GET', path: '/v1/keys' + q({ tenantId }) };
        },
        human: (b) =>
          b
            .map(
              (k) =>
                `${k.id}  ${k.name}  ${k.mode}${k.displayPrefix ? `  ${k.displayPrefix}…` : ''}${k.revoked ? '  REVOKED' : ''}`,
            )
            .join('\n') || '(no keys)',
      },
      create: {
        options: { name: { type: 'string' }, mode: { type: 'string' } },
        run(values, tenantId) {
          need(values, '--name');
          return {
            method: 'POST',
            path: '/v1/keys',
            body: compact({ tenantId, name: values.name, mode: values.mode }),
          };
        },
        human: (b) =>
          [
            `key ${b.key}`,
            'This is the only time the key is shown — store it now.',
            `id ${b.id}  name ${b.name}  mode ${b.mode}`,
          ].join('\n'),
      },
      revoke: {
        options: { id: { type: 'string' } },
        run(values, tenantId) {
          need(values, '--id');
          return { method: 'DELETE', path: `/v1/keys/${values.id}` + q({ tenantId }) };
        },
        human: () => 'revoked',
      },
    },
  },

  verify: {
    summary:
      'Verified destinations (a phone number or an email address): pombity verify request --phone <p> | --email <e> ; confirm --phone <p> | --email <e> --code <c> ; list ; remove --phone <p> | --email <e>',
    sub: {
      request: {
        options: { phone: { type: 'string' }, email: { type: 'string' } },
        run(values, tenantId) {
          return {
            method: 'POST',
            path: '/v1/verified-destinations',
            body: { tenantId, ...destination(values) },
          };
        },
        human: (b) =>
          b.status === 'already-verified'
            ? 'already verified'
            : `code sent; expires ${b.expiresAt}`,
      },
      confirm: {
        options: { phone: { type: 'string' }, email: { type: 'string' }, code: { type: 'string' } },
        run(values, tenantId) {
          const dest = destination(values);
          need(values, '--code');
          return {
            method: 'POST',
            path: '/v1/verified-destinations/confirm',
            body: { tenantId, ...dest, code: values.code },
          };
        },
        human: (b) => `verified ${b.phone ?? b.email} at ${b.verifiedAt}`,
      },
      list: {
        options: {},
        run(values, tenantId) {
          return { method: 'GET', path: '/v1/verified-destinations' + q({ tenantId }) };
        },
        human: (b) =>
          b.map((d) => `${d.phone ?? d.email}  verified ${d.verifiedAt}`).join('\n') || '(none verified)',
      },
      remove: {
        options: { phone: { type: 'string' }, email: { type: 'string' } },
        run(values, tenantId) {
          const dest = destination(values);
          return {
            method: 'DELETE',
            path:
              `/v1/verified-destinations/${encodeURIComponent(dest.phone ?? dest.email)}` + q({ tenantId }),
          };
        },
        human: () => 'removed',
      },
    },
  },
};
