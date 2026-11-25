import { describe, expect, test } from 'bun:test';

import type {
  DbStoreClient,
  NotificationEntry,
} from '@agentos/core/builtins/notifications/api/lib/db-store-client';
import { handleNotificationsRequest } from '@agentos/core/builtins/notifications/api/lib/handle-request';
import { createNotifyStore } from '@agentos/core/builtins/notifications/api/lib/notify-store';
import { createProviders } from '@agentos/core/builtins/notifications/api/lib/providers/create-providers';
import type { ChannelProvider } from '@agentos/core/builtins/notifications/api/lib/providers/types';

function mockDb(
  fail = false,
  backing: NotificationEntry[] = [],
): DbStoreClient & { backing: NotificationEntry[] } {
  return {
    backing,
    async insert(entry) {
      if (fail) throw new Error('connection refused');
      backing.unshift(entry);
      return entry;
    },
    async query() {
      if (fail) throw new Error('connection refused');
      return [...backing].sort((a, b) => b.at.localeCompare(a.at));
    },
    async get(id) {
      if (fail) throw new Error('connection refused');
      return backing.find((e) => e.id === id);
    },
    async update(entry) {
      if (fail) throw new Error('connection refused');
      const idx = backing.findIndex((e) => e.id === entry.id);
      if (idx < 0) throw new Error(`missing ${entry.id}`);
      backing[idx] = entry;
      return entry;
    },
    async delete(ids) {
      if (fail) throw new Error('connection refused');
      const set = new Set(ids);
      let deleted = 0;
      for (let i = backing.length - 1; i >= 0; i--) {
        if (set.has(backing[i]!.id)) {
          backing.splice(i, 1);
          deleted += 1;
        }
      }
      return deleted;
    },
  };
}

describe('builtin notifications server', () => {
  test('notify → recent; bad input → 400', async () => {
    const store = createNotifyStore(mockDb());
    const providers = createProviders();

    const health = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/health'),
      providers,
    );
    expect(await health.json()).toEqual({ ok: true, backend: 'db-store' });

    const notify = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Saved', type: 'success' }),
      }),
      providers,
    );
    expect(notify.status).toBe(200);
    expect(await notify.json()).toMatchObject({
      ok: true,
      notification: {
        message: 'Saved',
        type: 'success',
        channel: 'in_app',
        status: 'sent',
      },
    });

    const recent = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/recent'),
      providers,
    );
    const body = (await recent.json()) as { notifications: unknown[] };
    expect(body.notifications).toHaveLength(1);

    const bad = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      providers,
    );
    expect(bad.status).toBe(400);
  });

  test('notify → restart → recent', async () => {
    const backing: NotificationEntry[] = [];
    const storeA = createNotifyStore(mockDb(false, backing));
    const providers = createProviders();

    const notify = await handleNotificationsRequest(
      storeA,
      new Request('http://127.0.0.1:6117/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Durable toast' }),
      }),
      providers,
    );
    expect(notify.status).toBe(200);

    const storeB = createNotifyStore(mockDb(false, backing));
    const recent = await handleNotificationsRequest(
      storeB,
      new Request('http://127.0.0.1:6117/recent'),
      providers,
    );
    const body = (await recent.json()) as {
      notifications: NotificationEntry[];
    };
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0]?.message).toBe('Durable toast');
  });

  test('max trim deletes oldest in_app only', async () => {
    const backing: NotificationEntry[] = [];
    const store = createNotifyStore(mockDb(false, backing), 2);
    const providers = createProviders();

    await store.add('one');
    await store.add('two');
    await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: 'email',
          to: 'a@example.com',
          message: 'keep me',
        }),
      }),
      providers,
    );
    await store.add('three');

    const listed = await store.list();
    expect(listed).toHaveLength(2);
    expect(listed.map((e) => e.message)).toEqual(['three', 'two']);
    expect(backing.some((e) => e.channel === 'email')).toBe(true);
  });

  test('db-store down → 502', async () => {
    const store = createNotifyStore(mockDb(true));
    const fail = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Nope' }),
      }),
      createProviders(),
    );
    expect(fail.status).toBe(502);
  });

  test('email via log sink → sent; recent excludes email', async () => {
    const store = createNotifyStore(mockDb());
    const providers = createProviders();

    const notify = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: 'email',
          to: 'client@example.com',
          message: 'Please upload receipts',
          subject: 'Close reminder',
        }),
      }),
      providers,
    );
    expect(notify.status).toBe(200);
    const payload = (await notify.json()) as {
      notification: NotificationEntry;
    };
    expect(payload.notification).toMatchObject({
      channel: 'email',
      status: 'sent',
      to: 'client@example.com',
      provider: 'log:email',
    });

    const recent = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/recent'),
      providers,
    );
    const body = (await recent.json()) as { notifications: unknown[] };
    expect(body.notifications).toHaveLength(0);

    const delivery = await handleNotificationsRequest(
      store,
      new Request(
        `http://127.0.0.1:6117/deliveries/${payload.notification.id}`,
      ),
      providers,
    );
    expect(delivery.status).toBe(200);
    expect(await delivery.json()).toMatchObject({
      notification: { id: payload.notification.id, status: 'sent' },
    });
  });

  test('list email deliveries is org-scoped', async () => {
    const backing: NotificationEntry[] = [];
    const store = createNotifyStore(mockDb(false, backing));
    const providers = createProviders();

    await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/notify', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-agentos-org-id': 'org_a',
        },
        body: JSON.stringify({
          channel: 'email',
          to: 'a@example.com',
          message: 'for a',
          orgId: 'org_a',
        }),
      }),
      providers,
    );
    await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/notify', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-agentos-org-id': 'org_b',
        },
        body: JSON.stringify({
          channel: 'email',
          to: 'b@example.com',
          message: 'for b',
          orgId: 'org_b',
        }),
      }),
      providers,
    );

    const listed = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/deliveries?channel=email', {
        headers: { 'x-agentos-org-id': 'org_a' },
      }),
      providers,
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      notifications: NotificationEntry[];
    };
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0]?.orgId).toBe('org_a');

    const otherId = backing.find((e) => e.orgId === 'org_b')!.id;
    const cross = await handleNotificationsRequest(
      store,
      new Request(`http://127.0.0.1:6117/deliveries/${otherId}`, {
        headers: { 'x-agentos-org-id': 'org_a' },
      }),
      providers,
    );
    expect(cross.status).toBe(404);
  });

  test('email missing to → 400', async () => {
    const store = createNotifyStore(mockDb());
    const res = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel: 'email', message: 'hi' }),
      }),
      createProviders(),
    );
    expect(res.status).toBe(400);
  });

  test('templateId renders vars for sms log sink', async () => {
    const store = createNotifyStore(mockDb());
    const res = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: 'sms',
          to: '+15551234567',
          templateId: 'client-reminder',
          vars: {
            name: 'Alex',
            title: 'W-9',
            message: 'Please submit your W-9.',
            appName: 'CloseDesk',
          },
        }),
      }),
      createProviders(),
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { notification: NotificationEntry };
    expect(payload.notification.status).toBe('sent');
    expect(payload.notification.provider).toBe('log:sms');
    expect(payload.notification.message).toContain('Alex');
    expect(payload.notification.message).toContain('W-9');
    expect(payload.notification.subject).toBe('Reminder: W-9');
  });

  test('resend mock failure → status failed', async () => {
    const store = createNotifyStore(mockDb());
    const fetchImpl: typeof fetch = (async () =>
      new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const providers = createProviders({
      emailProvider: 'resend',
      emailApiKey: 're_test',
      emailFrom: 'noreply@example.com',
      fetchImpl,
    });

    const res = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/notify', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-agentos-org-id': 'org_1',
        },
        body: JSON.stringify({
          channel: 'email',
          to: 'a@b.com',
          message: 'hello',
        }),
      }),
      providers,
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { notification: NotificationEntry };
    expect(payload.notification.status).toBe('failed');
    expect(payload.notification.provider).toBe('resend');
    expect(payload.notification.error).toContain('500');
    expect(payload.notification.orgId).toBe('org_1');
  });

  test('mocked cloudflare email success → sent', async () => {
    const calls: Array<{ url: string; auth?: string }> = [];
    const fetchImpl: typeof fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(input),
        auth: headers.get('authorization') ?? undefined,
      });
      return new Response(
        JSON.stringify({
          success: true,
          result: { message_id: '<msg@example.com>', delivered: ['a@b.com'] },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const store = createNotifyStore(mockDb());
    const providers = createProviders({
      emailProvider: 'cloudflare',
      emailApiKey: 'cf_token',
      emailFrom: 'noreply@example.com',
      emailAccountId: 'acct_123',
      fetchImpl,
    });

    const res = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: 'email',
          to: 'a@b.com',
          message: 'hello',
          subject: 'Hi',
        }),
      }),
      providers,
    );
    expect(res.status).toBe(200);
    expect(calls[0]?.url).toContain('/accounts/acct_123/email/sending/send');
    expect(calls[0]?.auth).toBe('Bearer cf_token');
    const payload = (await res.json()) as { notification: NotificationEntry };
    expect(payload.notification.status).toBe('sent');
    expect(payload.notification.provider).toBe('cloudflare');
  });

  test('cloudflare API success:false → failed', async () => {
    const fetchImpl: typeof fetch = (async () =>
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ message: 'domain not onboarded' }],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const store = createNotifyStore(mockDb());
    const providers = createProviders({
      emailProvider: 'cloudflare',
      emailApiKey: 'cf_token',
      emailFrom: 'noreply@example.com',
      emailAccountId: 'acct_123',
      fetchImpl,
    });

    const res = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: 'email',
          to: 'a@b.com',
          message: 'hello',
        }),
      }),
      providers,
    );
    const payload = (await res.json()) as { notification: NotificationEntry };
    expect(payload.notification.status).toBe('failed');
    expect(payload.notification.error).toContain('domain not onboarded');
  });

  test('mocked resend success → sent', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      calls.push(String(input));
      expect(init?.method).toBe('POST');
      return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
    }) as unknown as typeof fetch;

    const store = createNotifyStore(mockDb());
    const providers = createProviders({
      emailProvider: 'resend',
      emailApiKey: 're_test',
      emailFrom: 'noreply@example.com',
      fetchImpl,
    });

    const res = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: 'email',
          to: 'a@b.com',
          message: 'hello',
          subject: 'Hi',
        }),
      }),
      providers,
    );
    expect(res.status).toBe(200);
    expect(calls[0]).toContain('api.resend.com');
    const payload = (await res.json()) as { notification: NotificationEntry };
    expect(payload.notification.status).toBe('sent');
    expect(payload.notification.provider).toBe('resend');
  });

  test('mocked twilio success → sent', async () => {
    const fetchImpl: typeof fetch = (async () =>
      new Response(JSON.stringify({ sid: 'SM1' }), {
        status: 201,
      })) as unknown as typeof fetch;

    const store = createNotifyStore(mockDb());
    const providers = createProviders({
      smsProvider: 'twilio',
      smsAccountSid: 'ACxxx',
      smsApiKeySid: 'SKxxx',
      smsApiKeySecret: 'secret',
      smsFrom: '+15550001111',
      fetchImpl,
    });

    const res = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: 'sms',
          to: '+15551234567',
          message: 'ping',
        }),
      }),
      providers,
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { notification: NotificationEntry };
    expect(payload.notification.status).toBe('sent');
    expect(payload.notification.provider).toBe('twilio');
  });

  test('custom failing provider marks failed', async () => {
    const store = createNotifyStore(mockDb());
    const failing: ChannelProvider = {
      name: 'boom',
      async send() {
        return { ok: false, provider: 'boom', error: 'nope' };
      },
    };
    const res = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: 'email',
          to: 'a@b.com',
          message: 'x',
        }),
      }),
      { email: failing, sms: failing },
    );
    const payload = (await res.json()) as { notification: NotificationEntry };
    expect(payload.notification.status).toBe('failed');
    expect(payload.notification.error).toBe('nope');
  });
});
