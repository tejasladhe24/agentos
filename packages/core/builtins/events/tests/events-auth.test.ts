import { describe, expect, test } from 'bun:test';

import {
  canManageJobs,
  createEventsAuthenticator,
  readScope,
  resolveAuthApiBase,
  safeEqual,
  writeOrgId,
  type EventsAuthenticator,
  type EventsPrincipal,
} from '@agentos/core/builtins/events/api/lib/auth';
import { createEventBus } from '@agentos/core/builtins/events/api/lib/event-bus';
import { handleEventsRequest } from '@agentos/core/builtins/events/api/lib/handle-request';
import { createJobsStore } from '@agentos/core/builtins/events/api/lib/jobs-store';
import { createOutboxStore } from '@agentos/core/builtins/events/api/lib/outbox-store';
import {
  isServerOnlyTopic,
  jobUrlError,
  topicError,
} from '@agentos/core/builtins/events/api/lib/policy';
import { runSchedulerTick } from '@agentos/core/builtins/events/api/lib/scheduler';

import { mockDb } from './mock-db';

const TOKEN = 'test-service-token-0123456789';
const BASE = 'http://127.0.0.1:6115';

const session = (
  orgId: string,
  roles: string[] = ['viewer'],
): EventsPrincipal => ({
  kind: 'session',
  orgId,
  userId: `user-${orgId}`,
  roles,
});
const admin = (orgId: string) => session(orgId, ['admin']);
const SERVICE_ALL: EventsPrincipal = { kind: 'service', orgId: null };

/** Test authenticator: the principal rides in a header; none → 401. */
const principalAuth: EventsAuthenticator = async (request) => {
  const raw = request.headers.get('x-test-principal');
  if (!raw) return { ok: false, status: 401, error: 'unauthenticated' };
  return { ok: true, principal: JSON.parse(raw) as EventsPrincipal };
};

function makeDeps(
  options: {
    authenticate?: EventsAuthenticator | null;
    fetchImpl?: typeof fetch;
  } = {},
) {
  const db = mockDb();
  const clock = () => new Date('2026-01-01T00:00:00.000Z');
  const bus = createEventBus();
  const outbox = createOutboxStore(db, clock);
  const jobs = createJobsStore(db, clock);
  return {
    db,
    bus,
    outbox,
    jobs,
    deps: {
      bus,
      outbox,
      jobs,
      workerId: 'w',
      leaseMs: 30_000,
      maxAttempts: 5,
      ...(options.authenticate === null
        ? {}
        : { authenticate: options.authenticate ?? principalAuth }),
      fetchImpl: options.fetchImpl,
    },
  };
}

function call(
  deps: ReturnType<typeof makeDeps>['deps'],
  path: string,
  init: {
    method?: string;
    principal?: EventsPrincipal;
    body?: unknown;
  } = {},
) {
  const headers: Record<string, string> = {};
  if (init.principal) {
    headers['x-test-principal'] = JSON.stringify(init.principal);
  }
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  return handleEventsRequest(
    deps,
    new Request(`${BASE}${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    }),
  );
}

/** Read the next SSE chunk, or `null` if none arrives within `ms`. */
async function nextChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms = 60,
): Promise<string | null> {
  const result = await Promise.race([
    reader.read(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
  if (result === null || result.done) return null;
  return new TextDecoder().decode(result.value);
}

describe('createEventsAuthenticator', () => {
  const sessionBody = {
    user: { id: 'u1' },
    roles: ['admin'],
    orgId: 'org-a',
  };

  function authWith(fetchImpl: typeof fetch, serviceToken: string | undefined) {
    return createEventsAuthenticator({
      serviceToken,
      authApiBase: 'http://auth.test/api/ext/auth',
      fetchImpl,
    });
  }

  const neverFetch = (async () => {
    throw new Error('session lookup must not run');
  }) as unknown as typeof fetch;

  test('valid bearer → service principal; org header scopes it', async () => {
    const authenticate = authWith(neverFetch, TOKEN);

    const scoped = await authenticate(
      new Request(BASE, {
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'x-agentos-org-id': 'org-a',
        },
      }),
    );
    expect(scoped).toEqual({
      ok: true,
      principal: { kind: 'service', orgId: 'org-a' },
    });

    const platform = await authenticate(
      new Request(BASE, { headers: { authorization: `Bearer ${TOKEN}` } }),
    );
    expect(platform).toEqual({
      ok: true,
      principal: { kind: 'service', orgId: null },
    });
  });

  test('wrong bearer → 401 and never falls back to the cookie', async () => {
    const authenticate = authWith(neverFetch, TOKEN);
    const res = await authenticate(
      new Request(BASE, {
        headers: { authorization: 'Bearer nope', cookie: 'sid=1' },
      }),
    );
    expect(res).toEqual({
      ok: false,
      status: 401,
      error: 'invalid service credential',
    });
  });

  test('bearer with no token configured → 401 (service path disabled)', async () => {
    const authenticate = authWith(neverFetch, undefined);
    const res = await authenticate(
      new Request(BASE, { headers: { authorization: `Bearer ${TOKEN}` } }),
    );
    expect(res.ok).toBe(false);
  });

  test('no credentials → 401', async () => {
    const res = await authWith(neverFetch, TOKEN)(new Request(BASE));
    expect(res).toEqual({ ok: false, status: 401, error: 'unauthenticated' });
  });

  test('non-bearer authorization header is ignored in favor of the cookie', async () => {
    const authenticate = authWith(
      (async () => Response.json(sessionBody)) as unknown as typeof fetch,
      TOKEN,
    );
    const res = await authenticate(
      new Request(BASE, {
        headers: { authorization: 'Basic abc', cookie: 'sid=1' },
      }),
    );
    expect(res.ok).toBe(true);
  });

  test('cookie → session principal; a spoofed org header is ignored', async () => {
    let seenCookie = '';
    const authenticate = authWith(
      (async (_url: unknown, init?: RequestInit) => {
        seenCookie = new Headers(init?.headers).get('cookie') ?? '';
        return Response.json(sessionBody);
      }) as unknown as typeof fetch,
      TOKEN,
    );
    const res = await authenticate(
      new Request(BASE, {
        headers: { cookie: 'sid=abc', 'x-agentos-org-id': 'org-victim' },
      }),
    );
    expect(seenCookie).toBe('sid=abc');
    expect(res).toEqual({
      ok: true,
      principal: {
        kind: 'session',
        orgId: 'org-a',
        userId: 'u1',
        roles: ['admin'],
      },
    });
  });

  test('session without an active org → 403', async () => {
    const authenticate = authWith(
      (async () =>
        Response.json({
          user: { id: 'u1' },
          roles: [],
          orgId: null,
        })) as unknown as typeof fetch,
      TOKEN,
    );
    const res = await authenticate(
      new Request(BASE, { headers: { cookie: 'sid=1' } }),
    );
    expect(res).toEqual({
      ok: false,
      status: 403,
      error: 'active org required',
    });
  });

  test('auth 401, malformed body, and network failure all → 401', async () => {
    const cases: Array<typeof fetch> = [
      (async () =>
        new Response('no', { status: 401 })) as unknown as typeof fetch,
      (async () => new Response('not json')) as unknown as typeof fetch,
      (async () => Response.json({ roles: [] })) as unknown as typeof fetch,
      (async () => {
        throw new Error('connection refused');
      }) as unknown as typeof fetch,
    ];
    for (const fetchImpl of cases) {
      const res = await authWith(
        fetchImpl,
        TOKEN,
      )(new Request(BASE, { headers: { cookie: 'sid=1' } }));
      expect(res).toMatchObject({ ok: false, status: 401 });
    }
  });

  test('safeEqual and resolveAuthApiBase', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);

    expect(resolveAuthApiBase({ AGENT_OS_AUTH_API_BASE: 'http://a:1/' })).toBe(
      'http://a:1',
    );
    expect(
      resolveAuthApiBase({ AGENT_OS_GLOBAL_GATEWAY_URL: 'http://g:2/' }),
    ).toBe('http://g:2/api/ext/auth');
    expect(resolveAuthApiBase({})).toBe('http://127.0.0.1:6110');
  });

  test('principal helpers', () => {
    expect(readScope(session('o'))).toBe('o');
    expect(readScope(SERVICE_ALL)).toBeNull();
    expect(writeOrgId(session('o'))).toBe('o');
    expect(writeOrgId(SERVICE_ALL)).toBe('__platform__');
    expect(canManageJobs(admin('o'))).toBe(true);
    expect(canManageJobs(session('o', ['owner']))).toBe(true);
    expect(canManageJobs(session('o'))).toBe(false);
    expect(canManageJobs(SERVICE_ALL)).toBe(true);
  });
});

describe('events route access', () => {
  test('health is public; every other route rejects an anonymous caller', async () => {
    const { deps } = makeDeps();
    const health = await call(deps, '/health');
    expect(health.status).toBe(200);

    const routes: Array<[string, string]> = [
      ['POST', '/publish'],
      ['GET', '/subscribe'],
      ['GET', '/jobs'],
      ['POST', '/jobs'],
      ['DELETE', '/jobs/abc'],
      ['POST', '/jobs/tick'],
      ['POST', '/queue/claim'],
      ['POST', '/queue/ack'],
      ['POST', '/queue/nack'],
    ];
    for (const [method, path] of routes) {
      const res = await call(deps, path, { method, body: {} });
      expect({ path, status: res.status }).toEqual({ path, status: 401 });
    }
  });

  test('unknown routes stay 404', async () => {
    const { deps } = makeDeps();
    expect((await call(deps, '/nope')).status).toBe(404);
  });

  test('no authenticator configured → non-public routes fail closed (503)', async () => {
    const { deps } = makeDeps({ authenticate: null });
    expect((await call(deps, '/health')).status).toBe(200);
    const res = await call(deps, '/publish', {
      principal: SERVICE_ALL,
      body: { topic: 'demo' },
    });
    expect(res.status).toBe(503);
  });

  test('queue and tick are service-only: a session gets 403', async () => {
    const { deps } = makeDeps();
    for (const path of [
      '/queue/claim',
      '/queue/ack',
      '/queue/nack',
      '/jobs/tick',
    ]) {
      const res = await call(deps, path, {
        principal: admin('org-a'),
        body: { id: 'x' },
      });
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
    const ok = await call(deps, '/queue/claim', {
      principal: SERVICE_ALL,
      body: { limit: 1 },
    });
    expect(ok.status).toBe(200);
  });

  test('job management needs an admin role for a session', async () => {
    const { deps } = makeDeps();
    expect(
      (await call(deps, '/jobs', { principal: session('org-a') })).status,
    ).toBe(403);
    expect(
      (
        await call(deps, '/jobs', {
          method: 'POST',
          principal: session('org-a'),
          body: {
            kind: 'at',
            runAt: '2026-02-01T00:00:00Z',
            action: 'publish',
            topic: 'x',
          },
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(deps, '/jobs', { principal: admin('org-a') })).status,
    ).toBe(200);
  });
});

describe('events org isolation', () => {
  test('a session only receives its own org events over SSE', async () => {
    const { deps } = makeDeps();
    const sub = await call(deps, '/subscribe', { principal: session('org-a') });
    expect(sub.status).toBe(200);
    const reader = sub.body!.getReader();
    await nextChunk(reader); // ": ok" preamble

    await call(deps, '/publish', {
      principal: session('org-b'),
      body: { topic: 'demo', payload: { from: 'org-b' } },
    });
    await call(deps, '/publish', {
      principal: session('org-a'),
      body: { topic: 'demo', payload: { from: 'org-a' } },
    });

    const chunk = await nextChunk(reader);
    expect(chunk).toContain('"from":"org-a"');
    expect(chunk).not.toContain('org-b');
    expect(await nextChunk(reader)).toBeNull();
    await reader.cancel();
  });

  test('sessions never receive platform-scoped events', async () => {
    const { deps } = makeDeps();
    const sub = await call(deps, '/subscribe', { principal: session('org-a') });
    const reader = sub.body!.getReader();
    await nextChunk(reader);

    // Service publish with no org header → platform scope.
    await call(deps, '/publish', {
      principal: SERVICE_ALL,
      body: { topic: 'hitl.resolved', payload: { secret: 'platform-only' } },
    });
    expect(await nextChunk(reader)).toBeNull();
    await reader.cancel();
  });

  test('a service subscriber without an org sees every org; with one, only it', async () => {
    const { deps } = makeDeps();
    const all = (
      await call(deps, '/subscribe', { principal: SERVICE_ALL })
    ).body!.getReader();
    const onlyB = (
      await call(deps, '/subscribe', {
        principal: { kind: 'service', orgId: 'org-b' },
      })
    ).body!.getReader();
    await nextChunk(all);
    await nextChunk(onlyB);

    await call(deps, '/publish', {
      principal: session('org-a'),
      body: { topic: 'demo', payload: { n: 'a' } },
    });
    await call(deps, '/publish', {
      principal: session('org-b'),
      body: { topic: 'demo', payload: { n: 'b' } },
    });

    expect(await nextChunk(all)).toContain('"n":"a"');
    expect(await nextChunk(all)).toContain('"n":"b"');
    expect(await nextChunk(onlyB)).toContain('"n":"b"');
    expect(await nextChunk(onlyB)).toBeNull();
    await all.cancel();
    await onlyB.cancel();
  });

  test('publish stamps the caller org on the durable record', async () => {
    const { deps, db } = makeDeps();
    await call(deps, '/publish', {
      principal: session('org-a'),
      body: { topic: 'demo' },
    });
    await call(deps, '/publish', {
      principal: { kind: 'service', orgId: 'org-b' },
      body: { topic: 'demo' },
    });
    await call(deps, '/publish', {
      principal: SERVICE_ALL,
      body: { topic: 'demo' },
    });
    expect([...db.outbox.values()].map((r) => r.orgId)).toEqual([
      'org-a',
      'org-b',
      '__platform__',
    ]);
  });

  test('jobs are isolated per org; out-of-scope ids read as 404', async () => {
    const { deps } = makeDeps();
    const created = await call(deps, '/jobs', {
      principal: admin('org-a'),
      body: {
        kind: 'cron',
        cron: '@every 5s',
        action: 'publish',
        topic: 'heartbeat',
      },
    });
    expect(created.status).toBe(201);
    const job = (await created.json()) as { id: string; orgId: string };
    expect(job.orgId).toBe('org-a');

    const listB = (await (
      await call(deps, '/jobs', { principal: admin('org-b') })
    ).json()) as {
      jobs: unknown[];
    };
    expect(listB.jobs).toHaveLength(0);

    const delB = await call(deps, `/jobs/${job.id}`, {
      method: 'DELETE',
      principal: admin('org-b'),
    });
    expect(delB.status).toBe(404);

    const listA = (await (
      await call(deps, '/jobs', { principal: admin('org-a') })
    ).json()) as {
      jobs: unknown[];
    };
    expect(listA.jobs).toHaveLength(1);
    const listService = (await (
      await call(deps, '/jobs', { principal: SERVICE_ALL })
    ).json()) as {
      jobs: unknown[];
    };
    expect(listService.jobs).toHaveLength(1);

    const delA = await call(deps, `/jobs/${job.id}`, {
      method: 'DELETE',
      principal: admin('org-a'),
    });
    expect(delA.status).toBe(200);
  });

  test('scheduled publish jobs deliver into the job org only', async () => {
    const { deps, outbox, bus, jobs } = makeDeps();
    await call(deps, '/jobs', {
      principal: admin('org-a'),
      body: {
        kind: 'at',
        runAt: '2026-01-01T00:00:00Z',
        action: 'publish',
        topic: 'tick',
        payload: { ok: 1 },
      },
    });
    const subA = bus.subscribe(null, 'org-a');
    const subB = bus.subscribe(null, 'org-b');
    const readerA = subA.stream.getReader();
    const readerB = subB.stream.getReader();
    await nextChunk(readerA);
    await nextChunk(readerB);

    expect(await runSchedulerTick({ jobs, outbox, bus })).toBe(1);
    expect(await nextChunk(readerA)).toContain('"topic":"tick"');
    expect(await nextChunk(readerB)).toBeNull();
    await readerA.cancel();
    await readerB.cancel();
  });
});

describe('events publish and job policy', () => {
  test('a session cannot publish server-only topics; a service can', async () => {
    const { deps } = makeDeps();
    for (const topic of [
      'hitl.resolved',
      'email.received',
      'secrets.user_purged',
      'integration.changed',
    ]) {
      expect(isServerOnlyTopic(topic)).toBe(true);
      const denied = await call(deps, '/publish', {
        principal: session('org-a'),
        body: { topic },
      });
      expect({ topic, status: denied.status }).toEqual({ topic, status: 403 });
    }
    const allowed = await call(deps, '/publish', {
      principal: SERVICE_ALL,
      body: { topic: 'hitl.resolved' },
    });
    expect(allowed.status).toBe(200);
  });

  test('malformed topics are rejected for everyone', async () => {
    const { deps } = makeDeps();
    for (const topic of [
      'Has Caps',
      'has space',
      '-lead',
      'x'.repeat(129),
      '',
    ]) {
      const res = await call(deps, '/publish', {
        principal: SERVICE_ALL,
        body: { topic },
      });
      expect({ topic, status: res.status }).toEqual({ topic, status: 400 });
    }
    expect(topicError('files.selection.changed')).toBeNull();
    expect(topicError('demo')).toBeNull();
  });

  test('a session cannot schedule a job that publishes a server-only topic', async () => {
    const { deps } = makeDeps();
    const res = await call(deps, '/jobs', {
      principal: admin('org-a'),
      body: {
        kind: 'at',
        runAt: '2026-02-01T00:00:00Z',
        action: 'publish',
        topic: 'hitl.resolved',
      },
    });
    expect(res.status).toBe(403);
  });

  test('http jobs are service-only and the target is validated', async () => {
    const { deps } = makeDeps();
    const httpJob = (url: string) => ({
      kind: 'at',
      runAt: '2026-02-01T00:00:00Z',
      action: 'http',
      url,
    });

    const asSession = await call(deps, '/jobs', {
      principal: admin('org-a'),
      body: httpJob('https://example.com/hook'),
    });
    expect(asSession.status).toBe(403);

    for (const url of [
      'http://169.254.169.254/latest/meta-data',
      'http://metadata.google.internal/computeMetadata',
      'http://[fd00:ec2::254]/',
      'ftp://example.com/x',
      'file:///etc/passwd',
      'https://user:pass@example.com/',
      'not a url',
    ]) {
      const res = await call(deps, '/jobs', {
        principal: SERVICE_ALL,
        body: httpJob(url),
      });
      expect({ url, status: res.status }).toEqual({ url, status: 400 });
    }

    for (const url of ['https://example.com/hook', 'http://127.0.0.1:6114/x']) {
      const res = await call(deps, '/jobs', {
        principal: SERVICE_ALL,
        body: httpJob(url),
      });
      expect({ url, status: res.status }).toEqual({ url, status: 201 });
    }
  });

  test('jobUrlError covers schemes, credentials, and metadata hosts', () => {
    expect(jobUrlError('https://example.com')).toBeNull();
    expect(jobUrlError('http://localhost:3000/x')).toBeNull();
    expect(jobUrlError('http://169.254.1.1')).toMatch(/blocked/);
    expect(jobUrlError('http://[fe80::1]/')).toMatch(/blocked/);
    expect(jobUrlError('gopher://x')).toMatch(/http or https/);
    expect(jobUrlError('http://a:b@x.test')).toMatch(/credentials/);
    expect(jobUrlError('???')).toMatch(/invalid/);
  });

  test('scheduler refuses a stored http job that targets a blocked address', async () => {
    const { db, jobs, outbox, bus } = makeDeps();
    // Simulates a job stored before validation existed.
    db.jobs.set('legacy', {
      id: 'legacy',
      kind: 'at',
      action: 'http',
      enabled: true,
      nextRunAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      url: 'http://169.254.169.254/latest/meta-data',
    });
    let fetched = false;
    const ran = await runSchedulerTick({
      jobs,
      outbox,
      bus,
      fetchImpl: (async () => {
        fetched = true;
        return new Response('{}');
      }) as unknown as typeof fetch,
    });
    expect(ran).toBe(1);
    expect(fetched).toBe(false);
    expect(db.jobs.get('legacy')?.lastError).toMatch(/blocked/);
  });
});
