import { describe, expect, test } from 'bun:test';

import type {
  DbStoreClient,
  JobRecord,
  OutboxRecord,
  OutboxStatus,
} from '@agentos/core/builtins/events/api/lib/db-store-client';
import { createEventBus } from '@agentos/core/builtins/events/api/lib/event-bus';
import { handleEventsRequest } from '@agentos/core/builtins/events/api/lib/handle-request';
import { createJobsStore } from '@agentos/core/builtins/events/api/lib/jobs-store';
import { createOutboxStore } from '@agentos/core/builtins/events/api/lib/outbox-store';
import { runSchedulerTick } from '@agentos/core/builtins/events/api/lib/scheduler';

function mockDb(fail = false): DbStoreClient & {
  outbox: Map<string, OutboxRecord>;
  jobs: Map<string, JobRecord>;
} {
  const outbox = new Map<string, OutboxRecord>();
  const jobs = new Map<string, JobRecord>();
  return {
    outbox,
    jobs,
    async insertOutbox(record) {
      if (fail) throw new Error('connection refused');
      outbox.set(record.id, structuredClone(record));
      return structuredClone(record);
    },
    async updateOutbox(record) {
      if (fail) throw new Error('connection refused');
      outbox.set(record.id, structuredClone(record));
      return structuredClone(record);
    },
    async listOutbox(status?: OutboxStatus) {
      if (fail) throw new Error('connection refused');
      const all = [...outbox.values()].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      );
      if (!status) return all.map((r) => structuredClone(r));
      return all
        .filter((r) => r.status === status)
        .map((r) => structuredClone(r));
    },
    async getOutbox(id) {
      if (fail) throw new Error('connection refused');
      const row = outbox.get(id);
      return row ? structuredClone(row) : undefined;
    },
    async insertJob(record) {
      if (fail) throw new Error('connection refused');
      jobs.set(record.id, structuredClone(record));
      return structuredClone(record);
    },
    async updateJob(record) {
      if (fail) throw new Error('connection refused');
      jobs.set(record.id, structuredClone(record));
      return structuredClone(record);
    },
    async listJobs() {
      if (fail) throw new Error('connection refused');
      return [...jobs.values()]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((r) => structuredClone(r));
    },
    async getJob(id) {
      if (fail) throw new Error('connection refused');
      const row = jobs.get(id);
      return row ? structuredClone(row) : undefined;
    },
    async deleteJob(id) {
      if (fail) throw new Error('connection refused');
      return jobs.delete(id);
    },
  };
}

function makeDeps(
  opts: {
    fail?: boolean;
    clock?: { now: Date };
    maxAttempts?: number;
    leaseMs?: number;
    fetchImpl?: typeof fetch;
  } = {},
) {
  const db = mockDb(opts.fail);
  const clockState = opts.clock ?? {
    now: new Date('2026-01-01T00:00:00.000Z'),
  };
  const clock = () => new Date(clockState.now);
  const bus = createEventBus();
  const outbox = createOutboxStore(db, clock);
  const jobs = createJobsStore(db, clock);
  return {
    db,
    clockState,
    bus,
    outbox,
    jobs,
    deps: {
      bus,
      outbox,
      jobs,
      workerId: 'test-worker',
      leaseMs: opts.leaseMs ?? 30_000,
      maxAttempts: opts.maxAttempts ?? 5,
      fetchImpl: opts.fetchImpl,
    },
  };
}

describe('builtin events server', () => {
  test('health + durable publish', async () => {
    const { deps, db } = makeDeps();

    const health = await handleEventsRequest(
      deps,
      new Request('http://127.0.0.1:6115/health'),
    );
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({
      ok: true,
      backend: 'db-store',
      subscribers: 0,
    });

    const published = await handleEventsRequest(
      deps,
      new Request('http://127.0.0.1:6115/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic: 'demo', payload: { n: 1 } }),
      }),
    );
    expect(published.status).toBe(200);
    const body = (await published.json()) as {
      ok: boolean;
      event: { id: string; topic: string; payload: unknown };
    };
    expect(body.ok).toBe(true);
    expect(body.event.topic).toBe('demo');
    expect(body.event.payload).toEqual({ n: 1 });
    expect(body.event.id).toBeTruthy();
    expect(db.outbox.size).toBe(1);
  });

  test('SSE subscribe receives publish', async () => {
    const { deps } = makeDeps();

    const subRes = await handleEventsRequest(
      deps,
      new Request('http://127.0.0.1:6115/subscribe?topic=demo'),
    );
    expect(subRes.status).toBe(200);
    expect(subRes.headers.get('content-type')).toContain('text/event-stream');

    const reader = subRes.body!.getReader();
    const decoder = new TextDecoder();
    await reader.read();

    const published = handleEventsRequest(
      deps,
      new Request('http://127.0.0.1:6115/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic: 'demo', payload: { hello: true } }),
      }),
    );

    const { value } = await reader.read();
    await published;
    const text = decoder.decode(value);
    expect(text).toContain('event: message');
    expect(text).toContain('"topic":"demo"');
    await reader.cancel();
  });

  test('publish without topic → 400; db down → 502', async () => {
    const ok = makeDeps();
    const bad = await handleEventsRequest(
      ok.deps,
      new Request('http://127.0.0.1:6115/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(bad.status).toBe(400);

    const down = makeDeps({ fail: true });
    const fail = await handleEventsRequest(
      down.deps,
      new Request('http://127.0.0.1:6115/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic: 'x' }),
      }),
    );
    expect(fail.status).toBe(502);
  });

  test('restart mid-queue keeps undelivered events; claim / ack', async () => {
    const clock = { now: new Date('2026-01-01T00:00:00.000Z') };
    const first = makeDeps({ clock });
    const published = await handleEventsRequest(
      first.deps,
      new Request('http://127.0.0.1:6115/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic: 'orders', payload: { id: 1 } }),
      }),
    );
    const { event } = (await published.json()) as { event: { id: string } };

    // Simulate new process over same durable backing.
    const clock2 = { now: new Date('2026-01-01T00:00:00.000Z') };
    const bus = createEventBus();
    const outbox = createOutboxStore(first.db, () => new Date(clock2.now));
    const jobs = createJobsStore(first.db, () => new Date(clock2.now));
    const deps = {
      bus,
      outbox,
      jobs,
      workerId: 'worker-b',
      leaseMs: 30_000,
      maxAttempts: 5,
    };

    const claimed = await handleEventsRequest(
      deps,
      new Request('http://127.0.0.1:6115/queue/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit: 10 }),
      }),
    );
    expect(claimed.status).toBe(200);
    const claimBody = (await claimed.json()) as {
      messages: Array<{ id: string; status: string }>;
    };
    expect(claimBody.messages).toHaveLength(1);
    expect(claimBody.messages[0]?.id).toBe(event.id);
    expect(claimBody.messages[0]?.status).toBe('leased');

    const acked = await handleEventsRequest(
      deps,
      new Request('http://127.0.0.1:6115/queue/ack', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: event.id }),
      }),
    );
    expect(acked.status).toBe(200);
    expect(await acked.json()).toMatchObject({
      message: { id: event.id, status: 'acked' },
    });
  });
});

describe('events outbox nack → dead', () => {
  test('reaches dead after maxAttempts', async () => {
    const clock = { now: new Date('2026-01-01T00:00:00.000Z') };
    const { deps, outbox } = makeDeps({ clock, maxAttempts: 2 });
    const record = await outbox.publish('t', { x: 1 });

    let claimed = await outbox.claim({
      limit: 1,
      workerId: 'w',
      leaseMs: 1000,
    });
    expect(claimed).toHaveLength(1);
    let nacked = await outbox.nack(record.id, { maxAttempts: 2, error: 'e1' });
    expect(nacked?.status).toBe('pending');
    expect(nacked?.attempts).toBe(1);

    clock.now = new Date('2026-01-01T00:10:00.000Z');
    claimed = await outbox.claim({
      limit: 1,
      workerId: 'w',
      leaseMs: 1000,
    });
    expect(claimed).toHaveLength(1);
    nacked = await outbox.nack(record.id, { maxAttempts: 2, error: 'e2' });
    expect(nacked?.status).toBe('dead');
    expect(nacked?.attempts).toBe(2);
    expect(nacked?.lastError).toBe('e2');

    const listed = await handleEventsRequest(
      deps,
      new Request('http://127.0.0.1:6115/queue/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit: 10 }),
      }),
    );
    const claimBody = (await listed.json()) as { messages: unknown[] };
    expect(claimBody.messages).toHaveLength(0);
  });
});

describe('events scheduler', () => {
  test('cron @every fires on tick with test clock', async () => {
    const clock = { now: new Date('2026-01-01T00:00:00.000Z') };
    const httpCalls: Array<{ url: string; body: unknown }> = [];
    const { deps, jobs, outbox, bus } = makeDeps({
      clock,
      fetchImpl: (async (input, init) => {
        httpCalls.push({
          url: String(input),
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return new Response('{}', { status: 200 });
      }) as typeof fetch,
    });

    const created = await handleEventsRequest(
      deps,
      new Request('http://127.0.0.1:6115/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'cron',
          cron: '@every 5s',
          action: 'publish',
          topic: 'heartbeat',
          payload: { tick: true },
        }),
      }),
    );
    expect(created.status).toBe(201);
    const job = (await created.json()) as { id: string; nextRunAt: string };
    expect(job.nextRunAt).toBe('2026-01-01T00:00:05.000Z');

    // Not due yet.
    expect(await runSchedulerTick({ jobs, outbox, bus })).toBe(0);

    clock.now = new Date('2026-01-01T00:00:05.000Z');
    expect(await runSchedulerTick({ jobs, outbox, bus })).toBe(1);

    const claimed = await outbox.claim({
      limit: 10,
      workerId: 'w',
      leaseMs: 1000,
    });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.topic).toBe('heartbeat');

    const listed = await handleEventsRequest(
      deps,
      new Request('http://127.0.0.1:6115/jobs'),
    );
    const listBody = (await listed.json()) as {
      jobs: Array<{ nextRunAt: string; lastRunAt?: string }>;
    };
    expect(listBody.jobs[0]?.lastRunAt).toBe('2026-01-01T00:00:05.000Z');
    expect(listBody.jobs[0]?.nextRunAt).toBe('2026-01-01T00:00:10.000Z');

    // HTTP one-shot at
    const atJob = await handleEventsRequest(
      deps,
      new Request('http://127.0.0.1:6115/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'at',
          runAt: '2026-01-01T00:00:06.000Z',
          action: 'http',
          url: 'http://hooks.test/run',
          body: { hello: 1 },
        }),
      }),
    );
    expect(atJob.status).toBe(201);
    clock.now = new Date('2026-01-01T00:00:06.000Z');
    await runSchedulerTick({
      jobs,
      outbox,
      bus,
      fetchImpl: deps.fetchImpl,
    });
    expect(httpCalls).toEqual([
      { url: 'http://hooks.test/run', body: { hello: 1 } },
    ]);
  });

  test('jobs/tick endpoint runs due jobs', async () => {
    const clock = { now: new Date('2026-01-01T00:00:00.000Z') };
    const { deps } = makeDeps({ clock });
    await handleEventsRequest(
      deps,
      new Request('http://127.0.0.1:6115/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'at',
          runAt: '2026-01-01T00:00:00.000Z',
          action: 'publish',
          topic: 'now',
        }),
      }),
    );
    const tick = await handleEventsRequest(
      deps,
      new Request('http://127.0.0.1:6115/jobs/tick', { method: 'POST' }),
    );
    expect(tick.status).toBe(200);
    expect(await tick.json()).toEqual({ ok: true, ran: 1 });
  });
});
