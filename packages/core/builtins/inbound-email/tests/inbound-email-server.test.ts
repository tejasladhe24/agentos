import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hmacSha256Hex } from '@agentos/core/api/hmac';

import type { AddressDb } from '../api/lib/address-store';
import { createAddressStore } from '../api/lib/address-store';
import { handleInboundEmailRequest } from '../api/lib/handle-request';
import type { MessageDb } from '../api/lib/message-store';
import { createBlobStore } from '@agentos/core/builtins/files/api/lib/blob-store';
import {
  handleFilesRequest,
  type FilesContext,
} from '@agentos/core/builtins/files/api/lib/handle-request';
import { createMemoryMountStore } from '@agentos/core/builtins/files/api/lib/mount-store';
import { createMemoryObjectIndex } from '@agentos/core/builtins/files/api/lib/object-index';

import {
  createFilesClient,
  createMemoryIdempotencyStore,
} from '../api/lib/peers';
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
    async getById(orgId, id) {
      return backing.find((m) => m.orgId === orgId && m.id === id);
    },
    async list(query) {
      return backing
        .filter((m) => m.orgId === query.orgId)
        .filter((m) => {
          if (
            query.from &&
            !m.from.toLowerCase().includes(query.from.toLowerCase())
          ) {
            return false;
          }
          if (
            query.to &&
            !m.to.some((a) => a.toLowerCase().includes(query.to!.toLowerCase()))
          ) {
            return false;
          }
          if (query.q) {
            const hay = `${m.subject} ${m.from}`.toLowerCase();
            if (!hay.includes(query.q.toLowerCase())) return false;
          }
          return true;
        })
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
        .slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 50));
    },
    async markRead(orgId, id) {
      const row = backing.find((m) => m.orgId === orgId && m.id === id);
      if (!row) return undefined;
      if (!row.readAt) row.readAt = new Date().toISOString();
      return row;
    },
  };
}

function mockFiles(
  blobs: Map<string, Uint8Array> = new Map(),
): FilesClient & { blobs: Map<string, Uint8Array> } {
  return {
    blobs,
    async putBlob(path, data, orgId) {
      const key = `orgs/${orgId}/${path}`;
      blobs.set(key, data);
      return {
        key,
        ref: `files://platform/${path}`,
        mountId: 'platform',
        bytes: data.byteLength,
      };
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
    deps.resolveOrg = async () => ({
      ok: true,
      orgId: 'org_1',
      via: 'header',
    });
    const provision = await handleInboundEmailRequest(
      deps,
      new Request('http://127.0.0.1:6121/addresses', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-agentos-org-id': 'org_1',
        },
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
      new Request('http://127.0.0.1:6121/addresses', {
        headers: { 'x-agentos-org-id': 'org_1' },
      }),
    );
    const body = (await list.json()) as { addresses: unknown[] };
    expect(body.addresses).toHaveLength(1);
  });

  test('list + get + mark read messages (org-scoped)', async () => {
    const { deps, messages } = createDeps({ addressMap: new Map() });
    deps.resolveOrg = async () => ({
      ok: true,
      orgId: 'org_a',
      via: 'header',
    });
    const now = new Date().toISOString();
    messages.backing.push(
      {
        id: 'm1',
        orgId: 'org_a',
        deliveryId: 'd1',
        provider: 'fixture',
        from: 'alice@example.com',
        to: ['inbox@example.com'],
        subject: 'Hello Alice',
        text: 'hi',
        attachments: [],
        receivedAt: now,
      },
      {
        id: 'm2',
        orgId: 'org_b',
        deliveryId: 'd2',
        provider: 'fixture',
        from: 'bob@example.com',
        to: ['other@example.com'],
        subject: 'Other org',
        attachments: [],
        receivedAt: now,
      },
    );

    const listed = await handleInboundEmailRequest(
      deps,
      new Request('http://127.0.0.1:6121/messages?q=Alice', {
        headers: { 'x-agentos-org-id': 'org_a' },
      }),
    );
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as {
      messages: Array<{ id: string }>;
    };
    expect(listBody.messages).toHaveLength(1);
    expect(listBody.messages[0]!.id).toBe('m1');

    const detail = await handleInboundEmailRequest(
      deps,
      new Request('http://127.0.0.1:6121/messages/m1', {
        headers: { 'x-agentos-org-id': 'org_a' },
      }),
    );
    expect(detail.status).toBe(200);

    const cross = await handleInboundEmailRequest(
      deps,
      new Request('http://127.0.0.1:6121/messages/m2', {
        headers: { 'x-agentos-org-id': 'org_a' },
      }),
    );
    expect(cross.status).toBe(404);

    const patch = await handleInboundEmailRequest(
      deps,
      new Request('http://127.0.0.1:6121/messages/m1', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-agentos-org-id': 'org_a',
        },
        body: JSON.stringify({ read: true }),
      }),
    );
    expect(patch.status).toBe(200);
    const patched = (await patch.json()) as { message: { readAt?: string } };
    expect(typeof patched.message.readAt).toBe('string');
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
      message: {
        orgId: string;
        attachments: Array<{ key: string; ref?: string }>;
      };
      eventId?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.message.orgId).toBe('org_demo');
    expect(body.message.attachments).toHaveLength(1);
    expect(body.message.attachments[0]!.key).toContain(
      'orgs/org_demo/inbound/',
    );
    expect(body.message.attachments[0]!.ref).toMatch(
      /^files:\/\/platform\/inbound\/.+-acord25\.pdf$/,
    );
    expect(files.blobs.size).toBe(1);
    expect(messages.backing).toHaveLength(1);
    expect(events.published).toHaveLength(1);
    expect(events.published[0]!.topic).toBe('email.received');
    const payload = events.published[0]!.payload as {
      orgId: string;
      attachmentKeys: string[];
      attachmentRefs: string[];
    };
    expect(payload.orgId).toBe('org_demo');
    expect(payload.attachmentKeys).toHaveLength(1);
    expect(payload.attachmentRefs[0]).toBe(body.message.attachments[0]!.ref!);
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

  test('attachments land in the files builtin with a files://platform ref', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentos-inbound-files-'));
    const filesCtx: FilesContext = {
      store: await createBlobStore(root),
      index: createMemoryObjectIndex(),
      mounts: createMemoryMountStore(),
    };
    const server = Bun.serve({
      port: 0,
      fetch: (request) => handleFilesRequest(filesCtx, request),
    });
    try {
      const secret = 'e2e-secret';
      const { deps } = createDeps({ secret });
      deps.files = createFilesClient(`http://127.0.0.1:${server.port}`);
      const res = await handleInboundEmailRequest(
        deps,
        await signedFixtureRequest(secret, {
          deliveryId: 'msg_e2e',
          to: 'coi@inbound.example.com',
          from: 'vendor@example.com',
          subject: 'COI',
          attachments: [
            {
              filename: 'coi.pdf',
              contentType: 'application/pdf',
              base64: btoa('%PDF'),
            },
          ],
        }),
      );
      expect(res.status).toBe(200);
      const att = (
        (await res.json()) as {
          message: { attachments: Array<{ key: string; ref: string }> };
        }
      ).message.attachments[0]!;
      expect(att.key).toStartWith('orgs/org_demo/inbound/');
      expect(att.ref).toStartWith('files://platform/inbound/');

      const fetched = await handleFilesRequest(
        filesCtx,
        new Request(`http://127.0.0.1/blobs/${encodeURIComponent(att.ref)}`, {
          headers: { 'x-agentos-org-id': 'org_demo' },
        }),
      );
      expect(fetched.status).toBe(200);
      expect(await fetched.text()).toBe('%PDF');
    } finally {
      server.stop(true);
    }
  });
});
