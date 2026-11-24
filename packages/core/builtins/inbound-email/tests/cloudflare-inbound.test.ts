import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createAddressStore,
  orgAddressSlug,
  type AddressDb,
} from '../api/lib/address-store';
import { handleInboundEmailRequest } from '../api/lib/handle-request';
import type { MessageDb } from '../api/lib/message-store';
import { createMemoryIdempotencyStore } from '../api/lib/peers';
import {
  CLOUDFLARE_EMAIL_HEADERS,
  parseCloudflareAuthentication,
  signCloudflareEmail,
} from '../api/lib/providers/cloudflare';
import { createInboundProvider } from '../api/lib/providers/create-provider';
import type { InboundEmailDeps } from '../api/lib/routes';
import type { InboundAddress, InboundMessage } from '../api/lib/types';

const SECRET = 'cf-test-secret';
const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dir, 'fixtures', name)));

function memoryAddressDb(rows: InboundAddress[] = []): AddressDb & {
  rows: InboundAddress[];
} {
  return {
    rows,
    async insertAddress(row) {
      rows.push(row);
      return row;
    },
    async listAddresses() {
      return [...rows];
    },
    async findByAddress(address) {
      return rows.find((r) => r.address === address.toLowerCase());
    },
  };
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

function setup(rows: InboundAddress[] = []) {
  const addressDb = memoryAddressDb(rows);
  const messages = memoryMessages();
  const blobs = new Map<string, Uint8Array>();
  const published: Array<{ topic: string; payload: unknown }> = [];
  const deps: InboundEmailDeps = {
    addresses: createAddressStore(
      addressDb,
      new Map([['acme@in.example.com', 'org_acme']]),
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
      provider: 'cloudflare',
      cloudflareSecret: SECRET,
    }),
    inboundDomain: 'in.example.com',
    idempotency: createMemoryIdempotencyStore(),
  };
  return { deps, addressDb, messages, blobs, published };
}

async function workerRequest(
  raw: Uint8Array,
  envelope: { from?: string; to: string },
  options: { secret?: string; timestamp?: number } = {},
): Promise<Request> {
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const from = envelope.from ?? 'bounce@example.com';
  const signature = await signCloudflareEmail({
    secret: options.secret ?? SECRET,
    timestamp,
    from,
    to: envelope.to,
    raw,
  });
  return new Request('http://127.0.0.1:6121/webhooks/cloudflare', {
    method: 'POST',
    headers: {
      'content-type': 'message/rfc822',
      [CLOUDFLARE_EMAIL_HEADERS.timestamp]: timestamp,
      [CLOUDFLARE_EMAIL_HEADERS.from]: from,
      [CLOUDFLARE_EMAIL_HEADERS.to]: envelope.to,
      [CLOUDFLARE_EMAIL_HEADERS.signature]: signature,
    },
    body: raw,
  });
}

describe('cloudflare inbound provider', () => {
  test('signature matches the Email Worker test vector', async () => {
    const raw = 'From: a@example.com\r\nTo: acme@in.example.com\r\n\r\nhi\r\n';
    expect(
      await signCloudflareEmail({
        secret: SECRET,
        timestamp: '1700000000',
        from: 'a@example.com',
        to: 'acme@in.example.com',
        raw: new TextEncoder().encode(raw),
      }),
    ).toBe(
      'v1=4a157ef63b7bf9367aa226718ec4ca4a414d64ac6210552636d86dccc2daa133',
    );
  });

  test('plain text message lands in the mapped org with auth verdicts', async () => {
    const env = setup();
    const res = await handleInboundEmailRequest(
      env.deps,
      await workerRequest(fixture('plain.eml'), { to: 'acme@in.example.com' }),
    );
    expect(res.status).toBe(200);
    const { message } = (await res.json()) as { message: InboundMessage };
    expect(message.orgId).toBe('org_acme');
    expect(message.provider).toBe('cloudflare');
    expect(message.deliveryId).toBe('plain-1@example.com');
    expect(message.from).toBe('vendor@example.com');
    expect(message.subject).toBe('Plain hello');
    expect(message.text).toContain('café');
    expect(message.attachments).toEqual([]);
    expect(message.authentication).toEqual({
      spf: 'pass',
      dkim: 'pass',
      dmarc: 'pass',
    });
    const event = env.published[0]!;
    expect(event.topic).toBe('email.received');
    expect(
      (event.payload as { authentication?: unknown }).authentication,
    ).toEqual({ spf: 'pass', dkim: 'pass', dmarc: 'pass' });
  });

  test('HTML + attachments are parsed and stored in files', async () => {
    const env = setup();
    const res = await handleInboundEmailRequest(
      env.deps,
      await workerRequest(fixture('html-attachments.eml'), {
        to: 'acme@in.example.com',
      }),
    );
    expect(res.status).toBe(200);
    const { message } = (await res.json()) as { message: InboundMessage };
    expect(message.subject).toBe('Certificate ✓');
    expect(message.html).toContain('<b>attached</b> certificate.');
    expect(message.text).toContain('See the attached certificate.');
    expect(message.to).toEqual(['acme@in.example.com', 'other@elsewhere.test']);
    expect(message.attachments.map((a) => [a.filename, a.contentType])).toEqual(
      [
        ['coi.pdf', 'application/pdf'],
        ['logo.png', 'image/png'],
      ],
    );
    const pdf = env.blobs.get(message.attachments[0]!.key)!;
    expect(new TextDecoder().decode(pdf)).toStartWith('%PDF-1.4');
    expect(message.authentication).toEqual({
      spf: 'softfail',
      dkim: 'fail',
      dmarc: 'fail',
    });
  });

  test('bad signature, tampered body, and stale timestamp → 401', async () => {
    const env = setup();
    const raw = fixture('plain.eml');
    const wrongSecret = await workerRequest(
      raw,
      { to: 'acme@in.example.com' },
      { secret: 'other' },
    );
    expect(
      (await handleInboundEmailRequest(env.deps, wrongSecret)).status,
    ).toBe(401);

    const signed = await workerRequest(raw, { to: 'acme@in.example.com' });
    const swapped = new Request(signed, {
      headers: new Headers({
        ...Object.fromEntries(signed.headers),
        [CLOUDFLARE_EMAIL_HEADERS.to]: 'victim@in.example.com',
      }),
    });
    expect((await handleInboundEmailRequest(env.deps, swapped)).status).toBe(
      401,
    );

    const stale = await workerRequest(
      raw,
      { to: 'acme@in.example.com' },
      { timestamp: Math.floor(Date.now() / 1000) - 3600 },
    );
    expect((await handleInboundEmailRequest(env.deps, stale)).status).toBe(401);
    expect(env.messages.backing).toHaveLength(0);
  });

  test('routing uses the envelope recipient; unknown → 404 (Worker rejects)', async () => {
    const env = setup();
    const res = await handleInboundEmailRequest(
      env.deps,
      await workerRequest(fixture('plain.eml'), {
        to: 'nobody@in.example.com',
      }),
    );
    expect(res.status).toBe(404);
    expect(env.messages.backing).toHaveLength(0);
  });

  test('ignores Authentication-Results from other authserv-ids', () => {
    expect(
      parseCloudflareAuthentication([
        {
          key: 'authentication-results',
          value: 'evil.example; spf=pass; dkim=pass; dmarc=pass',
        },
      ]),
    ).toBeUndefined();
  });
});

describe('default org addresses', () => {
  test('slug from org name, falling back to the org id', () => {
    expect(orgAddressSlug('Acme Corp, Inc.', 'x')).toBe('acme-corp-inc');
    expect(orgAddressSlug('Café Ünïcode', 'x')).toBe('cafe-unicode');
    expect(orgAddressSlug('!!!', 'ABCDEF12-3456')).toBe('org-abcdef123456');
  });

  test('session visit provisions <slug>@domain once; collisions get a suffix', async () => {
    const env = setup([
      {
        id: 'taken',
        address: 'acme-corp@in.example.com',
        orgId: 'org_other',
        createdAt: new Date(0).toISOString(),
      },
    ]);
    env.deps.resolveOrg = async () => ({
      ok: true,
      orgId: 'org_acme2',
      via: 'session',
      orgName: 'Acme Corp',
    });
    env.deps.checkPermission = async () => 'ok';
    const list = () =>
      handleInboundEmailRequest(
        env.deps,
        new Request('http://127.0.0.1:6121/addresses'),
      );
    const first = (await (await list()).json()) as {
      addresses: InboundAddress[];
    };
    expect(first.addresses.map((a) => [a.address, a.purpose])).toEqual([
      ['acme-corp-orgacm@in.example.com', 'default'],
    ]);
    await list();
    expect(env.addressDb.rows).toHaveLength(2);

    const res = await handleInboundEmailRequest(
      env.deps,
      await workerRequest(fixture('plain.eml'), {
        to: 'acme-corp-orgacm@in.example.com',
      }),
    );
    expect(res.status).toBe(200);
    expect(env.messages.backing[0]!.orgId).toBe('org_acme2');
  });

  test('peer (header) requests do not provision', async () => {
    const env = setup();
    env.deps.resolveOrg = async () => ({
      ok: true,
      orgId: 'org_peer',
      via: 'header',
    });
    await handleInboundEmailRequest(
      env.deps,
      new Request('http://127.0.0.1:6121/messages'),
    );
    expect(env.addressDb.rows).toHaveLength(0);
  });
});
