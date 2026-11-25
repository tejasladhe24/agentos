import { describe, expect, test } from 'bun:test';

import {
  createIntegrationsKit,
  createMemoryIntegrationsBackend,
  type IntegrationRoutesContext,
} from '@agentos/core/api/integrations';
import type {
  DbStoreClient,
  NotificationEntry,
} from '@agentos/core/builtins/notifications/api/lib/db-store-client';
import { handleNotificationsRequest } from '@agentos/core/builtins/notifications/api/lib/handle-request';
import { notificationIntegrationDefinitions } from '@agentos/core/builtins/notifications/api/lib/integrations';
import { createNotifyStore } from '@agentos/core/builtins/notifications/api/lib/notify-store';
import { createProviders } from '@agentos/core/builtins/notifications/api/lib/providers/create-providers';
import { createMemoryUserEmailPrefsStore } from '@agentos/core/builtins/notifications/api/lib/user-email-prefs';
import { createMemoryUserSmsPrefsStore } from '@agentos/core/builtins/notifications/api/lib/user-sms-prefs';

function memoryDb(): DbStoreClient {
  const rows: NotificationEntry[] = [];
  return {
    async insert(entry) {
      rows.unshift(entry);
      return entry;
    },
    async query() {
      return [...rows];
    },
    async get(id) {
      return rows.find((e) => e.id === id);
    },
    async update(entry) {
      const idx = rows.findIndex((e) => e.id === entry.id);
      rows[idx] = entry;
      return entry;
    },
    async delete(ids) {
      let n = 0;
      for (const id of ids) {
        const idx = rows.findIndex((e) => e.id === id);
        if (idx >= 0) {
          rows.splice(idx, 1);
          n += 1;
        }
      }
      return n;
    },
  };
}

type Call = { url: string; auth: string | null; body: string };

function mockFetch(status = 200) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      auth: headers.get('authorization'),
      body:
        typeof init?.body === 'string' ? init.body : String(init?.body ?? ''),
    });
    if (status !== 200) {
      return new Response(
        JSON.stringify({
          name: 'validation_error',
          message: 'API key is invalid',
        }),
        { status },
      );
    }
    return Response.json({ id: 'msg_1', success: true });
  }) as typeof fetch;
  return { calls, impl };
}

function setup(status = 200) {
  const backend = createMemoryIntegrationsBackend();
  const kit = createIntegrationsKit(backend);
  const store = createNotifyStore(memoryDb());
  const platform = createProviders();
  const http = mockFetch(status);
  const integrationRoutes: IntegrationRoutesContext = {
    kit,
    definitions: notificationIntegrationDefinitions({
      platform,
      fetchImpl: http.impl,
    }),
    resolveOrg: async (request) => ({
      ok: true,
      orgId: request.headers.get('x-agentos-org-id') ?? 'org_a',
      via: 'session',
      actor: 'admin@example.com',
    }),
    checkPermission: async () => 'ok',
  };
  const send = (orgId: string, body: Record<string, unknown>) =>
    handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/notify', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-agentos-org-id': orgId,
        },
        body: JSON.stringify(body),
      }),
      platform,
      { integrations: kit, fetchImpl: http.impl, integrationRoutes },
    );
  const call = (method: string, path: string, body?: unknown) =>
    handleNotificationsRequest(
      store,
      new Request(`http://127.0.0.1:6117${path}`, {
        method,
        headers: { 'content-type': 'application/json', cookie: 's=1' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      platform,
      { integrations: kit, fetchImpl: http.impl, integrationRoutes },
    );
  return { kit, backend, http, send, call };
}

const email = {
  channel: 'email',
  to: 'client@example.com',
  subject: 'Hi',
  message: 'Hello',
};

async function delivery(res: Response): Promise<NotificationEntry> {
  return ((await res.json()) as { notification: NotificationEntry })
    .notification;
}

describe('notifications BYOK (ticket 105)', () => {
  test('org with Resend key sends via its key; unconfigured org uses platform log', async () => {
    const { kit, http, send } = setup();
    await kit.putIntegration('org_a', {
      integration: 'email.send',
      provider: 'resend',
      settings: { from: 'A <a@acme.test>' },
      secrets: { apiKey: 're_org_a' },
    });

    const a = await delivery(await send('org_a', email));
    expect(a).toMatchObject({
      status: 'sent',
      provider: 'resend',
      source: 'org',
    });
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0]?.url).toBe('https://api.resend.com/emails');
    expect(http.calls[0]?.auth).toBe('Bearer re_org_a');
    expect(JSON.parse(http.calls[0]!.body).from).toBe('A <a@acme.test>');

    const b = await delivery(await send('org_b', email));
    expect(b).toMatchObject({
      status: 'sent',
      provider: 'log:email',
      source: 'platform',
    });
    expect(http.calls).toHaveLength(1);
  });

  test('rotating the key in Settings is used on the next send without restart', async () => {
    const { http, send, call } = setup();
    const put = (apiKey: string) =>
      call('PUT', '/integrations/email.send', {
        provider: 'resend',
        settings: { from: 'a@acme.test' },
        secrets: { apiKey },
      });
    expect((await put('re_first')).status).toBe(201);
    await send('org_a', email);
    expect((await put('re_second')).status).toBe(200);
    await send('org_a', email);
    expect(http.calls.map((c) => c.auth)).toEqual([
      'Bearer re_first',
      'Bearer re_second',
    ]);
  });

  test('invalid org key → failed delivery with a clear error', async () => {
    const { kit, send } = setup(401);
    await kit.putIntegration('org_a', {
      integration: 'email.send',
      provider: 'resend',
      settings: { from: 'a@acme.test' },
      secrets: { apiKey: 're_bad' },
    });
    const entry = await delivery(await send('org_a', email));
    expect(entry.status).toBe('failed');
    expect(entry.source).toBe('org');
    expect(entry.error).toContain('credentials rejected');
    expect(entry.error).not.toContain('re_bad');
  });

  test('Cloudflare email + Twilio SMS from org config', async () => {
    const { kit, http, send } = setup();
    await kit.putIntegration('org_a', {
      integration: 'email.send',
      provider: 'cloudflare',
      settings: { from: 'a@acme.test', accountId: 'acc_1' },
      secrets: { apiToken: 'cf_tok' },
    });
    await kit.putIntegration('org_a', {
      integration: 'sms',
      provider: 'twilio',
      settings: { accountSid: 'AC123', from: '+15550001111' },
      secrets: { authToken: 'tw_tok' },
    });
    expect((await delivery(await send('org_a', email))).source).toBe('org');
    const sms = await delivery(
      await send('org_a', {
        channel: 'sms',
        to: '+15552223333',
        message: 'Hi',
      }),
    );
    expect(sms).toMatchObject({
      status: 'sent',
      provider: 'twilio',
      source: 'org',
    });
    expect(http.calls[0]?.url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acc_1/email/sending/send',
    );
    expect(http.calls[0]?.auth).toBe('Bearer cf_tok');
    expect(http.calls[1]?.url).toBe(
      'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json',
    );
    expect(http.calls[1]?.auth).toBe(`Basic ${btoa('AC123:tw_tok')}`);
  });

  test('Settings routes: GET is display-safe; test connection sends / verifies', async () => {
    const { http, call } = setup();
    const list = await call('GET', '/integrations');
    const body = (await list.json()) as {
      integrations: Array<{
        definition: { id: string };
        platformDefault: { provider: string };
      }>;
    };
    expect(body.integrations.map((i) => i.definition.id)).toEqual([
      'email.send',
      'sms',
    ]);
    expect(body.integrations[0]?.platformDefault.provider).toBe('log');

    const emailTest = await call('POST', '/integrations/email.send/test', {
      provider: 'resend',
      settings: { from: 'a@acme.test' },
      secrets: { apiKey: 're_draft_key' },
    });
    const emailResult = await emailTest.text();
    expect(JSON.parse(emailResult)).toMatchObject({
      ok: true,
      source: 'draft',
    });
    expect(emailResult).not.toContain('re_draft_key');
    expect(JSON.parse(http.calls[0]!.body).to).toEqual(['admin@example.com']);

    const smsTest = await call('POST', '/integrations/sms/test', {
      provider: 'twilio',
      settings: { accountSid: 'AC9' },
      secrets: { authToken: 'tw' },
    });
    expect(await smsTest.json()).toMatchObject({ ok: true });
    expect(http.calls[1]?.url).toBe(
      'https://api.twilio.com/2010-04-01/Accounts/AC9/IncomingPhoneNumbers.json?PageSize=200',
    );
    expect(http.calls[1]?.auth).toBe(`Basic ${btoa('AC9:tw')}`);

    const platformSms = await call('POST', '/integrations/sms/test', {});
    expect(await platformSms.json()).toMatchObject({
      ok: true,
      source: 'platform',
    });
  });

  test('per-user email from preference overrides org default on send', async () => {
    const backend = createMemoryIntegrationsBackend();
    const kit = createIntegrationsKit(backend);
    const store = createNotifyStore(memoryDb());
    const userPrefs = createMemoryUserEmailPrefsStore();
    const platform = createProviders();
    const http = mockFetch(200);

    await kit.putIntegration('org_a', {
      integration: 'email.send',
      provider: 'resend',
      settings: { from: 'org@acme.test' },
      secrets: { apiKey: 're_org_key' },
    });

    const opts = {
      integrations: kit,
      userPrefs,
      fetchImpl: http.impl,
      resolveOrg: async () => ({
        ok: true as const,
        orgId: 'org_a',
        via: 'session' as const,
        userId: 'user_1',
      }),
      checkPermission: async () => 'ok' as const,
    };

    const getInitial = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/preferences/email'),
      platform,
      opts,
    );
    expect(getInitial.status).toBe(200);
    expect(await getInitial.json()).toEqual({
      from: null,
      orgFrom: 'org@acme.test',
    });

    const invalid = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/preferences/email', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: 'not-an-email' }),
      }),
      platform,
      opts,
    );
    expect(invalid.status).toBe(400);

    const saved = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/preferences/email', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: 'Jane <jane@acme.test>' }),
      }),
      platform,
      opts,
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      from: 'Jane <jane@acme.test>',
      orgFrom: 'org@acme.test',
    });

    const sent = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: 'email',
          to: 'client@example.com',
          subject: 'Hello',
          message: 'Body',
        }),
      }),
      platform,
      opts,
    );
    expect(sent.status).toBe(200);
    expect(JSON.parse(http.calls[0]!.body).from).toBe('Jane <jane@acme.test>');

    // Clearing reverts to org default
    const cleared = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/preferences/email', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: '' }),
      }),
      platform,
      opts,
    );
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({
      from: null,
      orgFrom: 'org@acme.test',
    });

    await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: 'email',
          to: 'client@example.com',
          subject: 'Hello 2',
          message: 'Body 2',
        }),
      }),
      platform,
      opts,
    );
    expect(JSON.parse(http.calls[1]!.body).from).toBe('org@acme.test');
  });

  test('Twilio: credential validation, number listing, and per-user from number', async () => {
    const backend = createMemoryIntegrationsBackend();
    const kit = createIntegrationsKit(backend);
    const store = createNotifyStore(memoryDb());
    const userSmsPrefs = createMemoryUserSmsPrefsStore();
    const platform = createProviders();
    const sent: Array<{ auth: string | null; body: URLSearchParams }> = [];

    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/IncomingPhoneNumbers.json')) {
        return Response.json({
          incoming_phone_numbers: [
            {
              phone_number: '+15550002222',
              friendly_name: '(555) 000-2222',
              capabilities: { sms: true },
            },
            {
              phone_number: '+15550009999',
              friendly_name: 'Voice only',
              capabilities: { sms: false },
            },
            {
              phone_number: '+15550001111',
              friendly_name: '+15550001111',
              capabilities: { sms: true },
            },
          ],
        });
      }
      sent.push({
        auth: new Headers(init?.headers).get('authorization'),
        body: new URLSearchParams(String(init?.body ?? '')),
      });
      return Response.json({ sid: 'SM1' }, { status: 201 });
    }) as typeof fetch;

    let permission: 'ok' | 'denied' = 'ok';
    const integrationRoutes: IntegrationRoutesContext = {
      kit,
      definitions: notificationIntegrationDefinitions({ platform, fetchImpl }),
      resolveOrg: async () => ({
        ok: true,
        orgId: 'org_sms',
        via: 'session',
        actor: 'admin@example.com',
      }),
      checkPermission: async () => 'ok',
    };
    const opts = {
      integrations: kit,
      userSmsPrefs,
      integrationRoutes,
      fetchImpl,
      resolveOrg: async () => ({
        ok: true as const,
        orgId: 'org_sms',
        via: 'session' as const,
        userId: 'user_1',
      }),
      checkPermission: async () => permission,
    };
    const call = (method: string, path: string, body?: unknown) =>
      handleNotificationsRequest(
        store,
        new Request(`http://127.0.0.1:6117${path}`, {
          method,
          headers: { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        platform,
        opts,
      );

    // A malformed account SID is rejected.
    const bad = await call('PUT', '/integrations/sms', {
      provider: 'twilio',
      settings: { accountSid: 'not_an_account_sid' },
      secrets: { authToken: 'secret' },
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain(
      'Account SID must start with "AC"',
    );

    // No Twilio connected: the dropdown source reports "not configured".
    const none = await call('GET', '/sms/numbers');
    expect(await none.json()).toMatchObject({
      configured: false,
      numbers: [],
    });

    const saved = await call('PUT', '/integrations/sms', {
      provider: 'twilio',
      settings: { accountSid: 'AC1', from: '+15550001111' },
      secrets: { authToken: 'secret' },
    });
    expect(saved.status).toBe(201);
    expect(await saved.text()).not.toContain('secret"');

    const listed = await call('GET', '/sms/numbers');
    expect(await listed.json()).toEqual({
      configured: true,
      source: 'org',
      error: null,
      numbers: [
        { phoneNumber: '+15550001111', friendlyName: '+15550001111' },
        { phoneNumber: '+15550002222', friendlyName: '(555) 000-2222' },
      ],
    });

    // Members without email.send cannot list the org's numbers.
    permission = 'denied';
    expect((await call('GET', '/sms/numbers')).status).toBe(403);
    permission = 'ok';

    expect(await (await call('GET', '/preferences/sms')).json()).toEqual({
      from: null,
      orgFrom: '+15550001111',
    });
    expect(
      (await call('PUT', '/preferences/sms', { from: '555-0002' })).status,
    ).toBe(400);
    expect(
      await (
        await call('PUT', '/preferences/sms', { from: '+15550002222' })
      ).json(),
    ).toEqual({ from: '+15550002222', orgFrom: '+15550001111' });

    const sms = { channel: 'sms', to: '+15553334444', message: 'Hi' };
    await call('POST', '/notify', sms);
    expect(sent.at(-1)?.auth).toBe(`Basic ${btoa('AC1:secret')}`);
    expect(sent.at(-1)?.body.get('From')).toBe('+15550002222');

    await call('PUT', '/preferences/sms', { from: '' });
    await call('POST', '/notify', sms);
    expect(sent.at(-1)?.body.get('From')).toBe('+15550001111');
  });

  test('Cloudflare email.send auto-pulls accountId from API token when omitted', async () => {
    const backend = createMemoryIntegrationsBackend();
    const kit = createIntegrationsKit(backend);
    const store = createNotifyStore(memoryDb());
    const platform = createProviders();

    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('https://api.cloudflare.com/client/v4/accounts?')) {
        return Response.json({
          success: true,
          result: [{ id: 'cf_auto_acc_99', name: 'Acme CF' }],
        });
      }
      return Response.json({ success: true });
    }) as typeof fetch;

    const integrationRoutes: IntegrationRoutesContext = {
      kit,
      definitions: notificationIntegrationDefinitions({ platform, fetchImpl }),
      resolveOrg: async () => ({
        ok: true,
        orgId: 'org_cf',
        via: 'session',
        actor: 'admin@example.com',
      }),
      checkPermission: async () => 'ok',
    };

    const res = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/integrations/email.send', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'cloudflare',
          settings: { from: 'noreply@acme.test' },
          secrets: { apiToken: 'cf_token_abc' },
        }),
      }),
      platform,
      { integrations: kit, integrationRoutes, fetchImpl },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      instance: { settings: Record<string, unknown> };
    };
    expect(body.instance.settings.accountId).toBe('cf_auto_acc_99');
  });
});
