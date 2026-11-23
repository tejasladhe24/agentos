import { describe, expect, test } from 'bun:test';

import { hmacSha256Hex } from '@agentos/core/api/hmac';

import type { AddressDb } from '../api/lib/address-store';
import { createAddressStore } from '../api/lib/address-store';
import { handleInboundEmailRequest } from '../api/lib/handle-request';
import type { MessageDb } from '../api/lib/message-store';
import { createMemoryIdempotencyStore } from '../api/lib/peers';
import { createInboundProvider } from '../api/lib/providers/create-provider';
import type {
  EventsClient,
  FilesClient,
  InboundAddress,
  InboundMessage,
} from '../api/lib/types';
import type { InboundEmailDeps } from '../api/lib/routes';

function mockAddressDb(
  backing: InboundAddress[] = [],
): AddressDb & { backing: InboundAddress[] } {
  return {
    backing,
    async insertAddress(row) {
      backing.push(row);
      return row;
    },
    async listAddresses() {
      return [...backing];
    },
    async findByAddress(address) {
      return backing.find((r) => r.address === address.toLowerCase());
    },
  };
}

function mockMessageDb(
  backing: InboundMessage[] = [],
): MessageDb & { backing: InboundMessage[] } {
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
  };
}

function mockFiles(
  blobs: Map<string, Uint8Array> = new Map(),
): FilesClient & { blobs: Map<string, Uint8Array> } {
  return {
    blobs,
    async putBlob(key, data) {
      blobs.set(key, data);
      return { key, bytes: data.byteLength };
    },
  };
}

function mockEvents(
  published: Array<{ topic: string; payload: unknown }> = [],
): EventsClient & { published: Array<{ topic: string; payload: unknown }> } {
  return {
    published,
    async publish(topic, payload) {
      published.push({ topic, payload });
      return { ok: true, event: { id: `evt_${published.length}` } };
    },
  };
}

async function signedFixtureRequest(
  secret: string,
  body: unknown,
  deliveryHeader?: string,
): Promise<Request> {
  const raw = JSON.stringify(body);
  const sig = await hmacSha256Hex(secret, raw);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-signature': sig,
    'x-timestamp': String(Math.floor(Date.now() / 1000)),
  };
  if (deliveryHeader) headers['x-delivery-id'] = deliveryHeader;
  return new Request('http://127.0.0.1:6121/webhooks/fixture', {
    method: 'POST',
    headers,
    body: raw,
  });
}

function createDeps(overrides?: {
  addressMap?: Map<string, string>;
  secret?: string;
}): {
  deps: InboundEmailDeps;
  files: ReturnType<typeof mockFiles>;
  events: ReturnType<typeof mockEvents>;
  messages: ReturnType<typeof mockMessageDb>;
} {
  const secret = overrides?.secret ?? 'test-webhook-secret';
  const files = mockFiles();
  const events = mockEvents();
  const messages = mockMessageDb();
  const addresses = createAddressStore(
    mockAddressDb(),
    overrides?.addressMap ?? new Map([['coi@inbound.example.com', 'org_demo']]),
  );
  const deps: InboundEmailDeps = {
    addresses,
    messages,
    files,
    events,
    provider: createInboundProvider({
      provider: 'fixture',
      webhookSecret: secret,
    }),
    idempotency: createMemoryIdempotencyStore(),
  };
  return { deps, files, events, messages };
}

describe('builtin inbound-email server', () => {
  test('health reports provider', async () => {
    const { deps } = createDeps();
    const res = await handleInboundEmailRequest(
      deps,
      new Request('http://127.0.0.1:6121/health'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      provider: 'fixture',
      backend: 'db-store',
    });
  });

  test('provision + list addresses', async () => {
    const { deps } = createDeps({ addressMap: new Map() });
    const provision = await handleInboundEmailRequest(
      deps,
      new Request('http://127.0.0.1:6121/addresses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          address: 'COI@Inbound.Example.com',
          orgId: 'org_1',
          purpose: 'coi',
        }),
      }),
    );
    expect(provision.status).toBe(200);
    const provisioned = (await provision.json()) as {
      address: { address: string; orgId: string };
    };
    expect(provisioned.address.address).toBe('coi@inbound.example.com');
    expect(provisioned.address.orgId).toBe('org_1');

    const list = await handleInboundEmailRequest(
      deps,
      new Request('http://127.0.0.1:6121/addresses'),
    );
    const body = (await list.json()) as { addresses: unknown[] };
    expect(body.addresses).toHaveLength(1);
  });

  test('fixture webhook ingests attachments and publishes email.received', async () => {
    const secret = 'fixture-secret';
    const { deps, files, events, messages } = createDeps({ secret });
    const pdf = btoa('%PDF-1.4 mock');
    const req = await signedFixtureRequest(secret, {
      deliveryId: 'msg_1',
      to: 'coi@inbound.example.com',
      from: 'vendor@example.com',
      subject: 'COI for Acme',
      text: 'Please find attached',
      attachments: [
        {
          filename: 'acord25.pdf',
          contentType: 'application/pdf',
          base64: pdf,
        },
      ],
    });

    const res = await handleInboundEmailRequest(deps, req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      message: { orgId: string; attachments: Array<{ key: string }> };
      eventId?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.message.orgId).toBe('org_demo');
    expect(body.message.attachments).toHaveLength(1);
    expect(body.message.attachments[0]!.key).toContain(
      'orgs/org_demo/inbound/',
    );
    expect(files.blobs.size).toBe(1);
    expect(messages.backing).toHaveLength(1);
    expect(events.published).toHaveLength(1);
    expect(events.published[0]!.topic).toBe('email.received');
    const payload = events.published[0]!.payload as {
      orgId: string;
      attachmentKeys: string[];
    };
    expect(payload.orgId).toBe('org_demo');
    expect(payload.attachmentKeys).toHaveLength(1);
    expect(body.eventId).toBe('evt_1');
  });

  test('bad signature → 401', async () => {
    const { deps } = createDeps({ secret: 'real-secret' });
    const res = await handleInboundEmailRequest(
      deps,
      new Request('http://127.0.0.1:6121/webhooks/fixture', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-signature': 'deadbeef',
        },
        body: JSON.stringify({
          deliveryId: 'x',
          to: 'coi@inbound.example.com',
          from: 'a@b.c',
          subject: 'nope',
        }),
      }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'signature' });
  });

  test('unknown recipient → 404', async () => {
    const secret = 's';
    const { deps } = createDeps({
      secret,
      addressMap: new Map(),
    });
    const req = await signedFixtureRequest(secret, {
      deliveryId: 'msg_unknown',
      to: 'nobody@inbound.example.com',
      from: 'a@b.c',
      subject: 'hi',
    });
    const res = await handleInboundEmailRequest(deps, req);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'unknown_recipient' });
  });

  test('duplicate delivery is idempotent', async () => {
    const secret = 'dup-secret';
    const { deps, events, messages } = createDeps({ secret });
    const payload = {
      deliveryId: 'msg_dup',
      to: ['coi@inbound.example.com'],
      from: 'vendor@example.com',
      subject: 'again',
    };
    const first = await handleInboundEmailRequest(
      deps,
      await signedFixtureRequest(secret, payload),
    );
    expect(first.status).toBe(200);
    const second = await handleInboundEmailRequest(
      deps,
      await signedFixtureRequest(secret, payload),
    );
    expect(second.status).toBe(200);
    const body = (await second.json()) as { duplicate?: boolean };
    expect(body.duplicate).toBe(true);
    expect(messages.backing).toHaveLength(1);
    expect(events.published).toHaveLength(1);
  });

  test('mailgun webhook verifies signature and ingests', async () => {
    const signingKey = 'mailgun-key';
    const files = mockFiles();
    const events = mockEvents();
    const messages = mockMessageDb();
    const addresses = createAddressStore(
      mockAddressDb(),
      new Map([['coi@inbound.example.com', 'org_mg']]),
    );
    const deps: InboundEmailDeps = {
      addresses,
      messages,
      files,
      events,
      provider: createInboundProvider({
        provider: 'mailgun',
        mailgunSigningKey: signingKey,
      }),
      idempotency: createMemoryIdempotencyStore(),
    };

    const timestamp = String(Math.floor(Date.now() / 1000));
    const token = 'tok_abc';
    const signature = await hmacSha256Hex(signingKey, `${timestamp}${token}`);

    const form = new FormData();
    form.set('timestamp', timestamp);
    form.set('token', token);
    form.set('signature', signature);
    form.set('recipient', 'coi@inbound.example.com');
    form.set('sender', 'vendor@example.com');
    form.set('subject', 'Mailgun COI');
    form.set('body-plain', 'attached');
    form.set('Message-Id', '<mg-1@mailgun>');
    form.set('attachment-count', '1');
    form.set(
      'attachment-1',
      new File([Uint8Array.from([1, 2, 3, 4])], 'coi.pdf', {
        type: 'application/pdf',
      }),
    );

    const res = await handleInboundEmailRequest(
      deps,
      new Request('http://127.0.0.1:6121/webhooks/mailgun', {
        method: 'POST',
        body: form,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      message: { orgId: string; attachments: unknown[] };
    };
    expect(body.ok).toBe(true);
    expect(body.message.orgId).toBe('org_mg');
    expect(body.message.attachments).toHaveLength(1);
    expect(events.published[0]!.topic).toBe('email.received');
  });
});
