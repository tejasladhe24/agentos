import { describe, expect, test } from 'bun:test';

import type {
  DbStoreClient,
  NotificationEntry,
} from '@agentos/core/builtins/notifications/api/lib/db-store-client';
import { handleNotificationsRequest } from '@agentos/core/builtins/notifications/api/lib/handle-request';
import { createNotifyStore } from '@agentos/core/builtins/notifications/api/lib/notify-store';

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

    const health = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/health'),
    );
    expect(await health.json()).toEqual({ ok: true, backend: 'db-store' });

    const notify = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Saved', type: 'success' }),
      }),
    );
    expect(notify.status).toBe(200);
    expect(await notify.json()).toMatchObject({
      ok: true,
      notification: { message: 'Saved', type: 'success' },
    });

    const recent = await handleNotificationsRequest(
      store,
      new Request('http://127.0.0.1:6117/recent'),
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
    );
    expect(bad.status).toBe(400);
  });

  test('notify → restart → recent', async () => {
    const backing: NotificationEntry[] = [];
    const storeA = createNotifyStore(mockDb(false, backing));

    const notify = await handleNotificationsRequest(
      storeA,
      new Request('http://127.0.0.1:6117/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Durable toast' }),
      }),
    );
    expect(notify.status).toBe(200);

    const storeB = createNotifyStore(mockDb(false, backing));
    const recent = await handleNotificationsRequest(
      storeB,
      new Request('http://127.0.0.1:6117/recent'),
    );
    const body = (await recent.json()) as {
      notifications: NotificationEntry[];
    };
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0]?.message).toBe('Durable toast');
  });

  test('max trim deletes oldest', async () => {
    const backing: NotificationEntry[] = [];
    const store = createNotifyStore(mockDb(false, backing), 2);

    await store.add('one');
    await store.add('two');
    await store.add('three');

    const listed = await store.list();
    expect(listed).toHaveLength(2);
    expect(listed.map((e) => e.message)).toEqual(['three', 'two']);
    expect(backing).toHaveLength(2);
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
    );
    expect(fail.status).toBe(502);
  });
});
