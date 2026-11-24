import { describe, expect, test } from 'bun:test';

import {
  createIntegrationsKit,
  createMemoryIntegrationsBackend,
  type IntegrationRoutesContext,
} from '@agentos/core/api/integrations';

import { createAddressStore } from '../api/lib/address-store';
import { createMemoryConnectionStore } from '../api/lib/connection-store';
import { handleInboundEmailRequest } from '../api/lib/handle-request';
import { inboundIntegrationDefinitions } from '../api/lib/integrations';
import type { MessageDb } from '../api/lib/message-store';
import { createMemoryIdempotencyStore } from '../api/lib/peers';
import { createInboundProvider } from '../api/lib/providers/create-provider';
import {
  signResendWebhook,
  verifyResendWebhook,
} from '../api/lib/providers/resend';
import type { InboundEmailDeps } from '../api/lib/routes';
import type { InboundMessage } from '../api/lib/types';

const SECRET = `whsec_${btoa('0123456789abcdef0123456789abcdef')}`;
const ORG_SECRET = `whsec_${btoa('org-secret-org-secret-org-secret')}`;
const ORIGIN = 'https://app.example.com';

type Call = {
  method: string;
  url: string;
  auth: string | null;
  body?: unknown;
};

/** Mock Resend API: received email, attachments, downloads, webhooks. */
function mockResend(options: { webhookStatus?: number } = {}) {
  const calls: Call[] = [];
  const fetchImpl = async (input: string, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      method,
      url: input,
      auth: headers.get('authorization'),
      body,
    });
    const url = new URL(input);
    const reply = (status: number, data?: unknown) =>
      new Response(data === undefined ? null : JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      });

    if (url.hostname === 'files.resend.test') {
      return new Response(Uint8Array.from([7, 8, 9]));
    }
    if (url.pathname === '/emails/receiving/em_fail') {
      return reply(500, { message: 'boom' });
    }
    if (url.pathname.match(/^\/emails\/receiving\/[^/]+\/attachments$/)) {
      return reply(200, {
        object: 'list',
        data: [
          {
            id: 'att_1',
            filename: 'coi.pdf',
            content_type: 'application/pdf',
            size: 3,
            download_url: 'https://files.resend.test/att_1',
          },
        ],
      });
    }
    const email = url.pathname.match(/^\/emails\/receiving\/([^/]+)$/);
    if (email) {
      return reply(200, {
        object: 'email',
        id: email[1],
        from: 'Vendor <vendor@example.com>',
        to: ['coi@inbound.example.com'],
        subject: 'Certificate',
        text: 'see attached',
        html: '<p>see attached</p>',
      });
    }
    if (url.pathname === '/webhooks' && method === 'POST') {
      if (options.webhookStatus && options.webhookStatus !== 200) {
        return reply(options.webhookStatus, { message: 'restricted key' });
      }
      return reply(200, {
        object: 'webhook',
        id: 'wh_1',
        signing_secret: ORG_SECRET,
      });
    }
    if (url.pathname.startsWith('/webhooks/')) {
      if (method === 'GET')
        return reply(200, { id: 'wh_1', status: 'enabled' });
      return reply(200, { object: 'webhook', id: 'wh_1' });
    }
    return reply(404, { message: 'not found' });
  };
  return { calls, fetchImpl };
}

function memoryMessages(): MessageDb & { backing: InboundMessage[] } {
  const backing: InboundMessage[] = [];
  return {
    backing,
    async insertMessage(row) {
      backing.push(row);
      return row;
    },
    async getByDeliveryId(orgId, deliveryId) {
      return backing.find(
        (m) => m.orgId === orgId && m.deliveryId === deliveryId,
      );
    },
    async getById(orgId, id) {
      return backing.find((m) => m.orgId === orgId && m.id === id);
    },
    async list(query) {
      return backing.filter((m) => m.orgId === query.orgId);
    },
    async markRead() {
      return undefined;
    },
  };
}

function setup(
  options: { provider?: 'fixture' | 'resend'; webhookStatus?: number } = {},
) {
  const resend = mockResend({ webhookStatus: options.webhookStatus });
  const messages = memoryMessages();
  const blobs = new Map<string, Uint8Array>();
  const published: Array<{ topic: string; payload: unknown }> = [];
  const backend = createMemoryIntegrationsBackend();
  const kit = createIntegrationsKit(backend);
  const connections = createMemoryConnectionStore();
  const deps: InboundEmailDeps = {
    addresses: createAddressStore(
      {
        async insertAddress(row) {
          return row;
        },
        async listAddresses() {
          return [];
        },
        async findByAddress() {
          return undefined;
        },
      },
      new Map([['coi@inbound.example.com', 'org_platform']]),
    ),
    messages,
    files: {
      async putBlob(key, data) {
        blobs.set(key, data);
        return { key, bytes: data.byteLength };
      },
    },
    events: {
      async publish(topic, payload) {
        published.push({ topic, payload });
        return { ok: true, event: { id: `evt_${published.length}` } };
      },
    },
    provider: createInboundProvider({
      provider: options.provider ?? 'resend',
      resendApiKey: 're_platform',
      resendSigningSecret: SECRET,
      webhookSecret: 'fixture-secret',
      fetchImpl: resend.fetchImpl,
    }),
    connections,
    integrations: kit,
    fetchImpl: resend.fetchImpl,
    idempotency: createMemoryIdempotencyStore(),
  };
  const integrationRoutes: IntegrationRoutesContext = {
    kit,
    definitions: inboundIntegrationDefinitions({
      kit,
      connections,
      publicOrigin: ORIGIN,
      platform: { provider: 'resend', configured: true },
      fetchImpl: resend.fetchImpl,
    }),
    async resolveOrg(request) {
      const orgId = request.headers.get('x-agentos-org-id');
      return orgId
        ? { ok: true, orgId, via: 'header' }
        : { ok: false, status: 401, error: 'unauthenticated' };
    },
    async checkPermission() {
      return 'ok';
    },
  };
  const call = (request: Request) =>
    handleInboundEmailRequest(deps, request, { integrationRoutes });
  return {
    call,
    deps,
    kit,
    connections,
    messages,
    blobs,
    published,
    resend,
  };
}

async function signedResendRequest(
  path: string,
  event: unknown,
  secret = SECRET,
  id = 'msg_1',
): Promise<Request> {
  const body = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await signResendWebhook({ secret, id, timestamp, body });
  return new Request(`http://127.0.0.1:6121${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': signature,
    },
    body,
  });
}

function receivedEvent(emailId: string, to = 'coi@inbound.example.com') {
  return {
    type: 'email.received',
    created_at: new Date().toISOString(),
    data: {
      email_id: emailId,
      from: 'vendor@example.com',
      to: [to],
      subject: 'Certificate',
      attachments: [{ id: 'att_1', filename: 'coi.pdf' }],
    },
  };
}

function putIntegration(
  call: (r: Request) => Promise<Response>,
  orgId: string,
  body: unknown,
) {
  return call(
    new Request('http://127.0.0.1:6121/integrations/email.receive', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-agentos-org-id': orgId,
      },
      body: JSON.stringify(body),
    }),
  );
}

describe('resend webhook signature', () => {
  test('accepts a valid signature and any rotated candidate', async () => {
    const body = '{"type":"email.received"}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = await signResendWebhook({
      secret: SECRET,
      id: 'm1',
      timestamp,
      body,
    });
    const headers = new Headers({
      'svix-id': 'm1',
      'svix-timestamp': timestamp,
      'svix-signature': `v1,AAAA ${sig}`,
    });
    expect(
      await verifyResendWebhook({ secret: SECRET, headers, rawBody: body }),
    ).toBe(true);
    expect(
      await verifyResendWebhook({
        secret: SECRET,
        headers,
        rawBody: `${body} `,
      }),
    ).toBe(false);
  });

  test('rejects stale timestamps and missing headers', async () => {
    const body = '{}';
    const timestamp = String(Math.floor(Date.now() / 1000) - 3600);
    const sig = await signResendWebhook({
      secret: SECRET,
      id: 'm1',
      timestamp,
      body,
    });
    const stale = new Headers({
      'svix-id': 'm1',
      'svix-timestamp': timestamp,
      'svix-signature': sig,
    });
    expect(
      await verifyResendWebhook({
        secret: SECRET,
        headers: stale,
        rawBody: body,
      }),
    ).toBe(false);
    expect(
      await verifyResendWebhook({
        secret: SECRET,
        headers: new Headers(),
        rawBody: body,
      }),
    ).toBe(false);
  });
});

describe('platform resend inbound', () => {
  test('fetches content + attachments, stores in files, publishes', async () => {
    const env = setup();
    const res = await env.call(
      await signedResendRequest('/webhooks/resend', receivedEvent('em_1')),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: InboundMessage };
    expect(body.message.orgId).toBe('org_platform');
    expect(body.message.provider).toBe('resend');
    expect(body.message.deliveryId).toBe('em_1');
    expect(body.message.text).toBe('see attached');
    expect(body.message.from).toBe('vendor@example.com');
    expect(body.message.attachments).toHaveLength(1);
    const key = body.message.attachments[0]!.key;
    expect(key).toMatch(/^inbound\//);
    expect([...env.blobs.get(key)!]).toEqual([7, 8, 9]);
    expect(env.published[0]!.topic).toBe('email.received');
    const auth = env.resend.calls.find((c) =>
      c.url.endsWith('/emails/receiving/em_1'),
    )?.auth;
    expect(auth).toBe('Bearer re_platform');
  });

  test('bad signature → 401', async () => {
    const env = setup();
    const res = await env.call(
      await signedResendRequest(
        '/webhooks/resend',
        receivedEvent('em_1'),
        ORG_SECRET,
      ),
    );
    expect(res.status).toBe(401);
    expect(env.messages.backing).toHaveLength(0);
  });

  test('other event types are acknowledged and ignored', async () => {
    const env = setup();
    const res = await env.call(
      await signedResendRequest('/webhooks/resend', {
        type: 'email.delivered',
        data: { email_id: 'em_x' },
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ignored?: boolean }).ignored).toBe(true);
    expect(env.messages.backing).toHaveLength(0);
  });

  test('Resend API failure → 502 so the delivery is retried', async () => {
    const env = setup();
    const res = await env.call(
      await signedResendRequest('/webhooks/resend', receivedEvent('em_fail')),
    );
    expect(res.status).toBe(502);
  });

  test('route is 404 when the platform provider is not resend', async () => {
    const env = setup({ provider: 'fixture' });
    const res = await env.call(
      await signedResendRequest('/webhooks/resend', receivedEvent('em_1')),
    );
    expect(res.status).toBe(404);
  });
});

describe('BYOK resend inbound', () => {
  test('saving a key registers the webhook; deliveries land in that org only', async () => {
    const env = setup();
    const saved = await putIntegration(env.call, 'org_a', {
      provider: 'resend',
      settings: { receivingDomain: 'in.acme.test', webhookStatus: 'forged' },
      secrets: { apiKey: 're_org_a' },
    });
    expect(saved.status).toBe(201);
    const { instance } = (await saved.json()) as {
      instance: {
        settings: Record<string, string>;
        secrets: Record<string, { set: boolean }>;
      };
    };
    expect(instance.settings.webhookStatus).toBe('registered');
    expect(instance.settings.webhookId).toBe('wh_1');
    expect(instance.settings.receivingDomain).toBe('in.acme.test');
    expect(instance.secrets.signingSecret?.set).toBe(true);
    const connectionId = instance.settings.connectionId!;
    expect(connectionId).toMatch(/^rc_/);

    const create = env.resend.calls.find(
      (c) => c.method === 'POST' && c.url.endsWith('/webhooks'),
    )!;
    expect(create.auth).toBe('Bearer re_org_a');
    expect(create.body).toEqual({
      endpoint: `${ORIGIN}/api/ext/inbound-email/webhooks/resend/${connectionId}`,
      events: ['email.received'],
    });

    const res = await env.call(
      await signedResendRequest(
        `/webhooks/resend/${connectionId}`,
        receivedEvent('em_2', 'anyone@in.acme.test'),
        ORG_SECRET,
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: InboundMessage };
    expect(body.message.orgId).toBe('org_a');
    expect(body.message.attachments).toHaveLength(1);
    expect(env.messages.backing.map((m) => m.orgId)).toEqual(['org_a']);
    const fetchAuth = env.resend.calls.find((c) =>
      c.url.endsWith('/emails/receiving/em_2'),
    )?.auth;
    expect(fetchAuth).toBe('Bearer re_org_a');

    const platformSigned = await env.call(
      await signedResendRequest(
        `/webhooks/resend/${connectionId}`,
        receivedEvent('em_3'),
        SECRET,
      ),
    );
    expect(platformSigned.status).toBe(401);
  });

  test('unknown connection id → 404', async () => {
    const env = setup();
    for (const id of ['nope', `rc_${'0'.repeat(32)}`]) {
      const res = await env.call(
        await signedResendRequest(
          `/webhooks/resend/${id}`,
          receivedEvent('em_1'),
        ),
      );
      expect(res.status).toBe(404);
    }
  });

  test('key without webhook permission falls back to manual setup', async () => {
    const env = setup({ webhookStatus: 403 });
    const first = await putIntegration(env.call, 'org_b', {
      provider: 'resend',
      secrets: { apiKey: 're_restricted' },
    });
    const view = (
      (await first.json()) as {
        instance: { settings: Record<string, string> };
      }
    ).instance;
    expect(view.settings.webhookStatus).toBe('manual');
    expect(view.settings.webhookError).toContain('cannot manage webhooks');
    const connectionId = view.settings.connectionId!;

    const second = await putIntegration(env.call, 'org_b', {
      provider: 'resend',
      secrets: { signingSecret: ORG_SECRET },
    });
    expect(second.status).toBe(200);
    const again = (
      (await second.json()) as {
        instance: { settings: Record<string, string> };
      }
    ).instance;
    expect(again.settings.connectionId).toBe(connectionId);
    expect(again.settings.webhookStatus).toBe('manual');

    const res = await env.call(
      await signedResendRequest(
        `/webhooks/resend/${connectionId}`,
        receivedEvent('em_4'),
        ORG_SECRET,
      ),
    );
    expect(res.status).toBe(200);
    expect(env.messages.backing[0]!.orgId).toBe('org_b');
  });

  test('"use the same key" copies the Resend sending key', async () => {
    const env = setup();
    await env.kit.putIntegration('org_c', {
      integration: 'email.send',
      provider: 'resend',
      settings: { from: 'ops@acme.test' },
      secrets: { apiKey: 're_shared' },
    });
    const res = await putIntegration(env.call, 'org_c', {
      provider: 'resend',
      useSendingKey: true,
    });
    expect(res.status).toBe(201);
    const create = env.resend.calls.find(
      (c) => c.method === 'POST' && c.url.endsWith('/webhooks'),
    )!;
    expect(create.auth).toBe('Bearer re_shared');
    const resolved = await env.kit.getIntegration('org_c', 'email.receive');
    expect(resolved?.secrets.apiKey).toBe('re_shared');
  });

  test('rotation updates the webhook; removal deletes it and the connection', async () => {
    const env = setup();
    const saved = await putIntegration(env.call, 'org_d', {
      provider: 'resend',
      secrets: { apiKey: 're_old' },
    });
    const connectionId = (
      (await saved.json()) as {
        instance: { settings: Record<string, string> };
      }
    ).instance.settings.connectionId!;

    await putIntegration(env.call, 'org_d', {
      provider: 'resend',
      secrets: { apiKey: 're_new' },
    });
    const patch = env.resend.calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toContain('/webhooks/wh_1');
    expect(patch.auth).toBe('Bearer re_new');

    const del = await env.call(
      new Request('http://127.0.0.1:6121/integrations/email.receive', {
        method: 'DELETE',
        headers: { 'x-agentos-org-id': 'org_d' },
      }),
    );
    expect(del.status).toBe(200);
    const remove = env.resend.calls.find((c) => c.method === 'DELETE')!;
    expect(remove.url).toContain('/webhooks/wh_1');
    expect(remove.auth).toBe('Bearer re_new');
    expect(env.connections.rows.has(connectionId)).toBe(false);

    const res = await env.call(
      await signedResendRequest(
        `/webhooks/resend/${connectionId}`,
        receivedEvent('em_5'),
        ORG_SECRET,
      ),
    );
    expect(res.status).toBe(404);
  });

  test('test endpoint checks the registered webhook', async () => {
    const env = setup();
    await putIntegration(env.call, 'org_e', {
      provider: 'resend',
      settings: { receivingDomain: 'in.e.test' },
      secrets: { apiKey: 're_e' },
    });
    const res = await env.call(
      new Request('http://127.0.0.1:6121/integrations/email.receive/test', {
        method: 'POST',
        headers: { 'x-agentos-org-id': 'org_e' },
      }),
    );
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(true);
    expect(body.message).toContain('in.e.test');
  });
});
