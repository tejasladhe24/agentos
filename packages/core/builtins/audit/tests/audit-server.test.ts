import { describe, expect, test } from 'bun:test';

import type {
  AuditEntry,
  DbStoreClient,
  QueryInput,
} from '@agentos/core/builtins/audit/api/lib/db-store-client';
import { handleAuditRequest } from '@agentos/core/builtins/audit/api/lib/handle-request';
import {
  encodeCursor,
  parseListFilters,
} from '@agentos/core/builtins/audit/api/lib/list-query';
import { redactMeta } from '@agentos/core/builtins/audit/api/lib/redact';

function mockDb(fail = false): DbStoreClient & { entries: AuditEntry[] } {
  const entries: AuditEntry[] = [];
  return {
    entries,
    async insert(entry) {
      if (fail) throw new Error('connection refused');
      entries.push(entry);
      return entry;
    },
    async query(input: QueryInput = {}) {
      if (fail) throw new Error('connection refused');
      let rows = [...entries];
      const where = input.where ?? {};
      if (typeof where.orgId === 'string') {
        rows = rows.filter((e) => e.orgId === where.orgId);
      }
      if (typeof where.action === 'string') {
        rows = rows.filter((e) => e.action === where.action);
      }
      if (typeof where.actor === 'string') {
        rows = rows.filter((e) => e.actor === where.actor);
      }
      if (typeof where.resource === 'string') {
        rows = rows.filter((e) => e.resource === where.resource);
      }
      if (
        where.at &&
        typeof where.at === 'object' &&
        !Array.isArray(where.at)
      ) {
        const at = where.at as { $gte?: string; $lte?: string };
        if (at.$gte) rows = rows.filter((e) => e.at >= at.$gte!);
        if (at.$lte) rows = rows.filter((e) => e.at <= at.$lte!);
      }
      rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
      const offset = input.offset ?? 0;
      const limit = input.limit ?? 50;
      return rows.slice(offset, offset + limit);
    },
  };
}

const peerOrg = {
  ok: true as const,
  orgId: 'org-1',
  via: 'header' as const,
};

describe('builtin audit server', () => {
  test('append + list via db-store client (peer header)', async () => {
    const db = mockDb();

    const health = await handleAuditRequest(
      { db, resolveOrg: async () => peerOrg },
      new Request('http://127.0.0.1:6119/health'),
    );
    expect(await health.json()).toEqual({ ok: true, backend: 'db-store' });

    const created = await handleAuditRequest(
      { db, resolveOrg: async () => peerOrg },
      new Request('http://127.0.0.1:6119/entries', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-agentos-org-id': 'org-1',
        },
        body: JSON.stringify({
          action: 'approval.resolved',
          actor: 'user-1',
          resource: 'approval:abc',
          meta: { decision: 'approved', token: 'secret-value' },
        }),
      }),
    );
    expect(created.status).toBe(201);
    const entry = (await created.json()) as AuditEntry;
    expect(entry.action).toBe('approval.resolved');
    expect(entry.orgId).toBe('org-1');
    expect(entry.meta?.token).toBe('[REDACTED]');
    expect(db.entries).toHaveLength(1);
    expect(db.entries[0]?.meta?.token).toBe('secret-value');

    const listed = await handleAuditRequest(
      { db, resolveOrg: async () => peerOrg },
      new Request('http://127.0.0.1:6119/entries'),
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      entries: AuditEntry[];
      nextCursor?: string;
    };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.meta?.token).toBe('[REDACTED]');
    expect(body.nextCursor).toBeUndefined();
  });

  test('bad input + db-store down + missing org', async () => {
    const okDb = mockDb();
    const bad = await handleAuditRequest(
      { db: okDb, resolveOrg: async () => peerOrg },
      new Request('http://127.0.0.1:6119/entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(bad.status).toBe(400);

    const down = mockDb(true);
    const fail = await handleAuditRequest(
      { db: down, resolveOrg: async () => peerOrg },
      new Request('http://127.0.0.1:6119/entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'x' }),
      }),
    );
    expect(fail.status).toBe(502);

    const noOrg = await handleAuditRequest(
      {
        db: okDb,
        resolveOrg: async () => ({
          ok: false,
          status: 401,
          error: 'org context required',
        }),
      },
      new Request('http://127.0.0.1:6119/entries'),
    );
    expect(noOrg.status).toBe(401);
  });

  test('filters, search, pagination, and session RBAC', async () => {
    const db = mockDb();
    const stamp = async (
      action: string,
      at: string,
      extra?: Partial<AuditEntry>,
    ) => {
      await handleAuditRequest(
        { db, resolveOrg: async () => peerOrg },
        new Request('http://127.0.0.1:6119/entries', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action,
            actor: extra?.actor ?? 'user-1',
            resource: extra?.resource ?? 'res-1',
            meta: extra?.meta ?? { note: action },
          }),
        }),
      );
      const last = db.entries.at(-1);
      if (last) last.at = at;
    };

    await stamp('subject.delete', '2026-03-01T00:00:00.000Z');
    await stamp('subject.anonymize', '2026-03-02T00:00:00.000Z');
    await stamp('doc.view', '2026-03-03T00:00:00.000Z', {
      actor: 'user-2',
      resource: 'doc/9',
      meta: { title: 'Alpha report' },
    });

    const byAction = await handleAuditRequest(
      { db, resolveOrg: async () => peerOrg },
      new Request('http://127.0.0.1:6119/entries?action=subject.delete'),
    );
    expect(byAction.status).toBe(200);
    expect((await byAction.json()).entries).toHaveLength(1);

    const prefix = await handleAuditRequest(
      { db, resolveOrg: async () => peerOrg },
      new Request('http://127.0.0.1:6119/entries?action=subject.*'),
    );
    expect(
      (await prefix.json()).entries.map((e: AuditEntry) => e.action),
    ).toEqual(['subject.anonymize', 'subject.delete']);

    const search = await handleAuditRequest(
      { db, resolveOrg: async () => peerOrg },
      new Request('http://127.0.0.1:6119/entries?q=Alpha'),
    );
    expect((await search.json()).entries).toHaveLength(1);

    const page1 = await handleAuditRequest(
      { db, resolveOrg: async () => peerOrg },
      new Request('http://127.0.0.1:6119/entries?limit=2'),
    );
    const page1Body = (await page1.json()) as {
      entries: AuditEntry[];
      nextCursor?: string;
    };
    expect(page1Body.entries).toHaveLength(2);
    expect(page1Body.nextCursor).toBe(encodeCursor(2));

    const page2 = await handleAuditRequest(
      { db, resolveOrg: async () => peerOrg },
      new Request(
        `http://127.0.0.1:6119/entries?limit=2&cursor=${page1Body.nextCursor}`,
      ),
    );
    const page2Body = (await page2.json()) as {
      entries: AuditEntry[];
      nextCursor?: string;
    };
    expect(page2Body.entries).toHaveLength(1);
    expect(page2Body.nextCursor).toBeUndefined();

    const forbidden = await handleAuditRequest(
      {
        db,
        resolveOrg: async () => ({
          ok: true,
          orgId: 'org-1',
          via: 'session',
        }),
        checkPermission: async () => 'denied',
      },
      new Request('http://127.0.0.1:6119/entries'),
    );
    expect(forbidden.status).toBe(403);

    const allowed = await handleAuditRequest(
      {
        db,
        resolveOrg: async () => ({
          ok: true,
          orgId: 'org-1',
          via: 'session',
        }),
        checkPermission: async () => 'ok',
      },
      new Request('http://127.0.0.1:6119/entries'),
    );
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).entries).toHaveLength(3);

    // Other org sees nothing.
    const other = await handleAuditRequest(
      {
        db,
        resolveOrg: async () => ({
          ok: true,
          orgId: 'org-other',
          via: 'header',
        }),
      },
      new Request('http://127.0.0.1:6119/entries'),
    );
    expect((await other.json()).entries).toHaveLength(0);
  });
});

describe('audit list-query helpers', () => {
  test('parseListFilters clamps limit', () => {
    const parsed = parseListFilters(
      new URL('http://x/entries?limit=999&action=a*&q=hi'),
    );
    expect(parsed).toMatchObject({
      limit: 100,
      action: 'a*',
      q: 'hi',
    });
  });

  test('redactMeta masks secret-shaped keys', () => {
    expect(
      redactMeta({
        password: 'x',
        nested: { apiKey: 'y', ok: 1 },
      }),
    ).toEqual({
      password: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', ok: 1 },
    });
  });
});
