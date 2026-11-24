import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBlobStore } from '@agentos/core/builtins/files/api/lib/blob-store';
import {
  handleFilesRequest,
  type FilesContext,
} from '@agentos/core/builtins/files/api/lib/handle-request';
import { createMemoryMountStore } from '@agentos/core/builtins/files/api/lib/mount-store';
import { createMemoryObjectIndex } from '@agentos/core/builtins/files/api/lib/object-index';
import { createOneDriveProvider } from '@agentos/core/builtins/files/api/lib/onedrive-provider';
import { UPLOAD_CHUNK_BYTES } from '@agentos/core/builtins/files/api/lib/onedrive-store';
import { createMemoryPersonalTokenStore } from '@agentos/core/builtins/files/api/lib/personal-tokens';
import type { ResolveOrgResult } from '@agentos/core/builtins/files/api/lib/resolve-org';
import { createStorageProviderRegistry } from '@agentos/core/builtins/files/api/lib/storage-providers';

const ORG = 'org_ms';
const BASE = 'http://127.0.0.1:6116';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const LOGIN = 'https://login.microsoftonline.com/common/oauth2/v2.0';

beforeAll(() => {
  Bun.env.AGENT_OS_GLOBAL_OAUTH_STATE_SECRET ??=
    'test-oauth-state-secret-0123456789';
});

type MockItem = {
  id: string;
  name: string;
  driveId: string;
  parentId: string | null;
  folder?: boolean;
  data?: Uint8Array;
  mimeType?: string;
  versions: number;
  deleted?: boolean;
  modified: string;
};

/** In-memory Microsoft identity + Graph drive API (only what the adapter calls). */
function mockGraph() {
  const drives = new Map([
    ['b!me', { site: null as string | null, name: 'OneDrive' }],
    ['b!docs', { site: 'site-mkt', name: 'Documents' }],
    ['b!assets', { site: 'site-mkt', name: 'Brand Assets' }],
  ]);
  const sites = [
    {
      id: 'contoso.sharepoint.com,site-mkt',
      siteId: 'site-mkt',
      displayName: 'Marketing',
      webUrl: 'https://contoso.sharepoint.com/sites/marketing',
    },
  ];
  const items = new Map<string, MockItem>();
  const accounts = new Map([
    ['code-a', { id: 'oid-a', mail: 'a@contoso.com' }],
    ['code-a2', { id: 'oid-a', mail: 'a@contoso.com' }],
    ['code-other', { id: 'oid-z', mail: 'z@contoso.com' }],
  ]);
  const accessTokens = new Map<string, string>();
  const refreshTokens = new Map<string, string>();
  const calls: string[] = [];
  const unsigned: Array<{ url: string; authorization: string | null }> = [];
  const sessions = new Map<
    string,
    { parentId: string; driveId: string; name: string; parts: Uint8Array[] }
  >();
  const monitors = new Map<string, { polls: number; done: () => void }>();
  const state = {
    throttle: 0,
    nextId: 1,
    tokenSeq: 0,
    refreshScope: '' as string | null,
  };
  const now = () => new Date().toISOString();
  const newId = () => `i${state.nextId++}`;

  for (const [driveId] of drives) {
    items.set(`root-${driveId}`, {
      id: `root-${driveId}`,
      name: 'root',
      driveId,
      parentId: null,
      folder: true,
      versions: 1,
      modified: now(),
    });
  }

  function seed(input: Partial<MockItem> & { name: string }): MockItem {
    const driveId = input.driveId ?? 'b!me';
    const item: MockItem = {
      id: newId(),
      parentId: `root-${driveId}`,
      driveId,
      versions: 1,
      modified: now(),
      ...input,
    };
    items.set(item.id, item);
    return item;
  }

  function children(parentId: string): MockItem[] {
    return [...items.values()].filter(
      (i) => i.parentId === parentId && !i.deleted,
    );
  }

  function childNamed(parentId: string, name: string): MockItem | undefined {
    return children(parentId).find(
      (i) => i.name.toLowerCase() === name.toLowerCase(),
    );
  }

  function pathOf(item: MockItem): string {
    const parts: string[] = [];
    let cur = item.parentId ? items.get(item.parentId) : undefined;
    while (cur && cur.parentId) {
      parts.unshift(encodeURIComponent(cur.name));
      cur = items.get(cur.parentId);
    }
    return `/drives/${item.driveId}/root:${parts.length ? `/${parts.join('/')}` : ''}`;
  }

  function view(item: MockItem) {
    return {
      id: item.id,
      name: item.name,
      lastModifiedDateTime: item.modified,
      webUrl: `https://contoso-my.sharepoint.com/${item.id}`,
      parentReference: {
        driveId: item.driveId,
        id: item.parentId,
        path: pathOf(item),
      },
      ...(item.folder
        ? { folder: { childCount: children(item.id).length } }
        : {
            size: item.data?.byteLength ?? 0,
            file: { mimeType: item.mimeType ?? 'application/octet-stream' },
          }),
    };
  }

  const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  const notFound = () =>
    json({ error: { code: 'itemNotFound', message: 'not found' } }, 404);

  function issue(accountId: string) {
    state.tokenSeq += 1;
    const access = `at-${accountId}-${state.tokenSeq}`;
    const refresh = `rt-${accountId}-${state.tokenSeq}`;
    accessTokens.set(access, accountId);
    refreshTokens.set(refresh, accountId);
    return {
      access_token: access,
      refresh_token: refresh,
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'Files.ReadWrite.All Sites.Read.All User.Read',
    };
  }

  function resolvePath(driveId: string, path: string): MockItem | undefined {
    let cur = items.get(`root-${driveId}`);
    for (const seg of path.split('/').filter(Boolean)) {
      if (!cur) return undefined;
      cur = childNamed(cur.id, decodeURIComponent(seg));
    }
    return cur;
  }

  function write(
    driveId: string,
    parentId: string,
    name: string,
    data: Uint8Array,
    mimeType?: string,
  ): MockItem {
    const existing = childNamed(parentId, name);
    if (existing) {
      existing.data = data;
      existing.versions += 1;
      existing.modified = now();
      if (mimeType) existing.mimeType = mimeType;
      return existing;
    }
    return seed({
      name,
      driveId,
      parentId,
      data,
      ...(mimeType ? { mimeType } : {}),
    });
  }

  async function handler(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const method = request.method;
    calls.push(`${method} ${url.origin}${url.pathname}`);

    if (`${url.origin}${url.pathname}` === `${LOGIN}/token`) {
      const form = new URLSearchParams(await request.text());
      if (form.get('client_id') !== 'msid') return json({}, 401);
      if (form.get('grant_type') === 'authorization_code') {
        const account = accounts.get(form.get('code') ?? '');
        if (!account) return json({ error: 'invalid_grant' }, 400);
        return json(issue(account.id));
      }
      state.refreshScope = form.get('scope');
      const accountId = refreshTokens.get(form.get('refresh_token') ?? '');
      if (!accountId) return json({ error: 'invalid_grant' }, 400);
      refreshTokens.delete(form.get('refresh_token')!);
      return json(issue(accountId));
    }

    if (url.origin !== 'https://graph.microsoft.com') {
      unsigned.push({
        url: request.url,
        authorization: request.headers.get('authorization'),
      });
      if (url.host === 'upload.mock') {
        const session = sessions.get(url.pathname);
        if (!session) return notFound();
        if (method === 'DELETE') {
          sessions.delete(url.pathname);
          return new Response(null, { status: 204 });
        }
        const range = request.headers.get('content-range') ?? '';
        const match = range.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
        if (!match) return json({ error: { code: 'invalidRange' } }, 400);
        session.parts.push(new Uint8Array(await request.arrayBuffer()));
        if (Number(match[2]) + 1 < Number(match[3])) {
          return json(
            { nextExpectedRanges: [`${Number(match[2]) + 1}-`] },
            202,
          );
        }
        const total = new Uint8Array(Number(match[3]));
        let offset = 0;
        for (const part of session.parts) {
          total.set(part, offset);
          offset += part.byteLength;
        }
        sessions.delete(url.pathname);
        return json(
          view(write(session.driveId, session.parentId, session.name, total)),
          201,
        );
      }
      if (url.host === 'download.mock') {
        const item = items.get(url.pathname.slice(1));
        return item?.data
          ? new Response(item.data, { status: 200 })
          : notFound();
      }
      if (url.host === 'monitor.mock') {
        const monitor = monitors.get(url.pathname);
        if (!monitor) return notFound();
        monitor.polls += 1;
        if (monitor.polls < 2) return json({ status: 'inProgress' }, 202);
        monitor.done();
        return json({ status: 'completed', resourceId: 'x' });
      }
      return notFound();
    }

    const accountId = accessTokens.get(
      (request.headers.get('authorization') ?? '').replace(/^Bearer /, ''),
    );
    if (!accountId) {
      return json({ error: { code: 'InvalidAuthenticationToken' } }, 401);
    }
    if (state.throttle > 0) {
      state.throttle -= 1;
      return json({ error: { code: 'activityLimitReached' } }, 429, {
        'retry-after': '1',
      });
    }
    const path = url.pathname.replace(/^\/v1\.0/, '');

    if (path === '/me') {
      const account = [...accounts.values()].find((a) => a.id === accountId)!;
      return json({
        id: account.id,
        displayName: 'A',
        mail: account.mail,
        userPrincipalName: account.mail,
      });
    }
    if (path === '/me/drive') {
      return json({
        id: 'b!me',
        quota: { used: 2048, total: 1099511627776 },
      });
    }
    if (path === '/me/followedSites') {
      return json({
        value: sites.map((s) => ({
          id: s.id,
          displayName: s.displayName,
          webUrl: s.webUrl,
        })),
      });
    }
    const siteDrives = path.match(/^\/sites\/([^/]+)\/drives$/);
    if (siteDrives) {
      const site = sites.find(
        (s) => s.id === decodeURIComponent(siteDrives[1]!),
      );
      if (!site) return notFound();
      return json({
        value: [...drives]
          .filter(([, d]) => d.site === site.siteId)
          .map(([id, d]) => ({ id, name: d.name })),
      });
    }

    const byPath = path.match(/^\/drives\/([^/]+)\/root(?::(.*))?$/);
    if (byPath && method === 'GET') {
      const driveId = decodeURIComponent(byPath[1]!);
      const item = resolvePath(driveId, byPath[2] ?? '');
      return item && !item.deleted ? json(view(item)) : notFound();
    }

    const byName = path.match(
      /^\/drives\/([^/]+)\/items\/([^/:]+):\/([^:]+):\/(content|createUploadSession)$/,
    );
    if (byName) {
      const driveId = decodeURIComponent(byName[1]!);
      const parentId = decodeURIComponent(byName[2]!);
      const name = decodeURIComponent(byName[3]!);
      if (!items.get(parentId)?.folder) return notFound();
      if (byName[4] === 'content' && method === 'PUT') {
        const data = new Uint8Array(await request.arrayBuffer());
        if (data.byteLength > 4 * 1024 * 1024) {
          return json({ error: { code: 'requestTooLarge' } }, 413);
        }
        return json(
          view(
            write(
              driveId,
              parentId,
              name,
              data,
              request.headers.get('content-type') ?? undefined,
            ),
          ),
          201,
        );
      }
      const key = `/session/${sessions.size + 1}`;
      sessions.set(key, { parentId, driveId, name, parts: [] });
      return json({ uploadUrl: `https://upload.mock${key}` });
    }

    const byId = path.match(
      /^\/drives\/([^/]+)\/items\/([^/]+)(?:\/(children|content|copy|restore|permanentDelete))?$/,
    );
    if (byId) {
      const item = items.get(decodeURIComponent(byId[2]!));
      const action = byId[3];
      if (!item) return notFound();
      if (action === 'restore' && method === 'POST') {
        if (!item.deleted) return notFound();
        item.deleted = false;
        return json(view(item));
      }
      if (item.deleted) return notFound();
      if (action === 'children' && method === 'GET') {
        const top = Number(url.searchParams.get('$top') ?? 200);
        const skip = Number(url.searchParams.get('$skiptoken') ?? 0);
        const list = children(item.id);
        const page = list.slice(skip, skip + top);
        const next =
          skip + top < list.length
            ? `${GRAPH}${url.pathname.replace(/^\/v1\.0/, '')}?$top=${top}&$skiptoken=${skip + top}`
            : undefined;
        return json({
          value: page.map(view),
          ...(next ? { '@odata.nextLink': next } : {}),
        });
      }
      if (action === 'children' && method === 'POST') {
        const body = (await request.json()) as { name: string };
        if (childNamed(item.id, body.name)) {
          return json({ error: { code: 'nameAlreadyExists' } }, 409);
        }
        return json(
          view(
            seed({
              name: body.name,
              driveId: item.driveId,
              parentId: item.id,
              folder: true,
            }),
          ),
          201,
        );
      }
      if (action === 'content' && method === 'GET') {
        return new Response(null, {
          status: 302,
          headers: { location: `https://download.mock/${item.id}` },
        });
      }
      if (action === 'copy' && method === 'POST') {
        const body = (await request.json()) as {
          parentReference: { driveId: string; id: string };
          name: string;
        };
        const key = `/monitor/${monitors.size + 1}`;
        monitors.set(key, {
          polls: 0,
          done: () => {
            write(
              body.parentReference.driveId,
              body.parentReference.id,
              body.name,
              item.data ?? new Uint8Array(),
              item.mimeType,
            );
          },
        });
        return new Response(null, {
          status: 202,
          headers: { location: `https://monitor.mock${key}` },
        });
      }
      if (action === 'permanentDelete' && method === 'POST') {
        items.delete(item.id);
        return new Response(null, { status: 204 });
      }
      if (!action && method === 'DELETE') {
        item.deleted = true;
        return new Response(null, { status: 204 });
      }
      if (!action && method === 'PATCH') {
        const body = (await request.json()) as {
          name?: string;
          parentReference?: { id?: string };
        };
        if (body.parentReference?.id) {
          const parent = items.get(body.parentReference.id);
          if (!parent || parent.driveId !== item.driveId) {
            return json({ error: { code: 'invalidRequest' } }, 400);
          }
          item.parentId = parent.id;
        }
        if (body.name) item.name = body.name;
        return json(view(item));
      }
    }
    return json({ error: { code: 'unhandled', message: path } }, 501);
  }

  return {
    items,
    calls,
    unsigned,
    state,
    seed,
    accessTokens,
    refreshTokens,
    fetch: handler as unknown as typeof fetch,
  };
}

type Org = Extract<ResolveOrgResult, { ok: true }>;

async function setup() {
  const graph = mockGraph();
  const root = await mkdtemp(join(tmpdir(), 'agentos-files-onedrive-'));
  const tokens = createMemoryPersonalTokenStore();
  const mounts = createMemoryMountStore();
  const sleeps: number[] = [];
  const index = createMemoryObjectIndex();
  let org: Org = { ok: true, orgId: ORG, via: 'session', userId: 'u_a' };
  const ctx: FilesContext = {
    store: await createBlobStore(root),
    index,
    mounts,
    tokens,
    providers: createStorageProviderRegistry([
      createOneDriveProvider({
        fetch: graph.fetch,
        tenant: 'common',
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }),
    ]),
    runtimeEnv: {
      AGENT_OS_EXT_FILES_MICROSOFT_CLIENT_ID: 'msid',
      AGENT_OS_EXT_FILES_MICROSOFT_CLIENT_SECRET: 'mssecret',
      AGENT_OS_GLOBAL_APP_ORIGIN: 'https://app.example.com',
    },
    oauthFetch: graph.fetch,
    resolveOrg: async () => org,
    checkPermission: async () => 'ok',
  };
  const call = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (typeof init.body === 'string' && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return handleFilesRequest(
      ctx,
      new Request(`${BASE}${path}`, { ...init, headers }),
    );
  };
  const as = (next: Partial<Org>) => {
    org = { ok: true, orgId: ORG, via: 'session', ...next } as Org;
  };

  async function connect(code = 'code-a', mountId?: string) {
    const start = await call('/personal-mounts/onedrive/connect', {
      method: 'POST',
      body: JSON.stringify(mountId ? { mountId } : {}),
    });
    expect(start.status).toBe(200);
    const { url } = (await start.json()) as { url: string };
    const authorize = new URL(url);
    const res = await call(
      `/personal-mounts/onedrive/callback?code=${code}&state=${encodeURIComponent(authorize.searchParams.get('state')!)}`,
    );
    expect(res.status).toBe(302);
    return { authorize, location: res.headers.get('location')! };
  }

  async function mountId(): Promise<string> {
    const list = (await (await call('/mounts')).json()) as {
      mounts: Array<{ id: string; kind: string }>;
    };
    return list.mounts.find((m) => m.kind === 'personal')!.id;
  }

  return { graph, ctx, call, as, connect, mountId, tokens, sleeps, index };
}

const put = (body: string | Uint8Array, contentType = 'text/plain') => ({
  method: 'PUT',
  body,
  headers: { 'content-type': contentType },
});

type Listing = {
  items: Array<{ name: string; kind: string; relativeKey: string }>;
  cursor?: string | null;
};

describe('OneDrive / SharePoint personal mounts', () => {
  test('connect with the platform Entra app; owner-only mount with quota', async () => {
    const { call, as, connect, tokens } = await setup();
    const { authorize, location } = await connect();
    expect(authorize.origin + authorize.pathname).toBe(`${LOGIN}/authorize`);
    expect(authorize.searchParams.get('client_id')).toBe('msid');
    expect(authorize.searchParams.get('scope')).toBe(
      'offline_access User.Read Files.ReadWrite.All Sites.Read.All',
    );
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/api/ext/files/personal-mounts/onedrive/callback',
    );
    expect(location).toBe('/?files_drive=connected');

    const list = (await (await call('/mounts?usage=1')).json()) as {
      mounts: Array<Record<string, unknown>>;
      providers: Array<Record<string, unknown>>;
    };
    const drive = list.mounts.find((m) => m.kind === 'personal')!;
    expect(drive).toMatchObject({
      provider: 'onedrive',
      ownerUserId: 'u_a',
      name: 'OneDrive (a@contoso.com)',
      indexMode: 'live',
      quota: { usedBytes: 2048, limitBytes: 1099511627776 },
    });
    expect(list.providers.find((p) => p.id === 'onedrive')).toMatchObject({
      personal: true,
      connectable: true,
    });
    expect(
      (await tokens.get(ORG, 'u_a', drive.id as string))?.refreshToken,
    ).toStartWith('rt-oid-a');

    as({ userId: 'u_admin' });
    expect((await call(`/blobs?mount=${drive.id}`)).status).toBe(404);
  });

  test('browse OneDrive and followed SharePoint libraries; paging stays on Graph', async () => {
    const { call, connect, mountId, graph } = await setup();
    await connect();
    const id = await mountId();
    const list = async (prefix: string, extra = '') =>
      (await (
        await call(
          `/blobs?mount=${id}&prefix=${encodeURIComponent(prefix)}${extra}`,
        )
      ).json()) as Listing;

    expect((await list('')).items.map((i) => i.name)).toEqual([
      'OneDrive',
      'SharePoint',
    ]);
    expect((await list('SharePoint/')).items.map((i) => i.name)).toEqual([
      'Marketing',
    ]);
    expect(
      (await list('SharePoint/Marketing/')).items.map((i) => i.name).sort(),
    ).toEqual(['Brand Assets', 'Documents']);

    graph.seed({
      name: 'brief.docx',
      driveId: 'b!docs',
      data: new TextEncoder().encode('brief'),
    });
    const docs = await list('SharePoint/Marketing/Documents/');
    expect(docs.items.map((i) => i.relativeKey)).toEqual([
      'SharePoint/Marketing/Documents/brief.docx',
    ]);
    expect(
      await (
        await call(
          `/blobs/SharePoint/Marketing/Documents/brief.docx?mount=${id}`,
        )
      ).text(),
    ).toBe('brief');

    for (let i = 0; i < 3; i += 1) graph.seed({ name: `f${i}.txt` });
    const first = await list('OneDrive/', '&limit=2');
    expect(first.items).toHaveLength(2);
    expect(first.cursor).toStartWith(GRAPH);
    const second = await list(
      'OneDrive/',
      `&limit=2&cursor=${encodeURIComponent(first.cursor!)}`,
    );
    expect(second.items.map((i) => i.name)).toEqual(['f2.txt']);
    const evil = await call(
      `/blobs?mount=${id}&prefix=OneDrive/&cursor=${encodeURIComponent('https://evil.example/v1.0/x')}`,
    );
    expect(evil.status).toBe(400);
    expect(graph.unsigned.some((u) => u.url.includes('evil'))).toBe(false);
  });

  test('small and large uploads, overwrite as a version, downloads without the token', async () => {
    const { call, connect, mountId, graph } = await setup();
    await connect();
    const id = await mountId();
    const q = `mount=${id}`;

    expect(
      (await call(`/blobs/OneDrive/Reports/q1.txt?${q}`, put('v1'))).status,
    ).toBe(200);
    expect(
      (await call(`/blobs/OneDrive/Reports/q1.txt?${q}`, put('v2'))).status,
    ).toBe(200);
    const q1 = [...graph.items.values()].find((i) => i.name === 'q1.txt')!;
    expect(q1.versions).toBe(2);
    expect(
      [...graph.items.values()].find((i) => i.name === 'Reports')?.folder,
    ).toBe(true);
    expect(
      await (await call(`/blobs/OneDrive/Reports/q1.txt?${q}`)).text(),
    ).toBe('v2');

    const big = new Uint8Array(UPLOAD_CHUNK_BYTES * 2 + 1234);
    for (let i = 0; i < big.length; i += 1) big[i] = i % 251;
    const res = await call(
      `/blobs/SharePoint/Marketing/Documents/video.bin?${q}`,
      put(big, 'application/octet-stream'),
    );
    expect(res.status).toBe(200);
    const uploads = graph.unsigned.filter((u) => u.url.includes('upload.mock'));
    expect(uploads).toHaveLength(3);
    expect(uploads.every((u) => u.authorization === null)).toBe(true);
    const stored = [...graph.items.values()].find(
      (i) => i.name === 'video.bin',
    )!;
    expect(stored.driveId).toBe('b!docs');
    expect(stored.data).toEqual(big);

    const back = new Uint8Array(
      await (
        await call(`/blobs/SharePoint/Marketing/Documents/video.bin?${q}`)
      ).arrayBuffer(),
    );
    expect(back).toEqual(big);
    const downloads = graph.unsigned.filter((u) =>
      u.url.includes('download.mock'),
    );
    expect(downloads.length).toBeGreaterThan(0);
    expect(downloads.every((u) => u.authorization === null)).toBe(true);

    expect(
      (await call(`/blobs/SharePoint/Marketing/loose.txt?${q}`, put('x')))
        .status,
    ).toBe(400);
  });

  test('copy within and across drives, move, copy to org storage', async () => {
    const { call, connect, mountId, graph, index } = await setup();
    await connect();
    const id = await mountId();
    const q = `mount=${id}`;
    await call(`/blobs/OneDrive/a.txt?${q}`, put('a'));

    const post = (path: string, body: Record<string, unknown>) =>
      call(path, { method: 'POST', body: JSON.stringify(body) });
    expect(
      (
        await post('/blobs/copy', {
          from: 'OneDrive/a.txt',
          to: 'OneDrive/b.txt',
          mount: id,
        })
      ).status,
    ).toBe(200);
    expect(graph.calls.some((c) => c.endsWith('/copy'))).toBe(true);
    expect(await (await call(`/blobs/OneDrive/b.txt?${q}`)).text()).toBe('a');

    expect(
      (
        await post('/blobs/move', {
          from: 'OneDrive/b.txt',
          to: 'OneDrive/Archive/b.txt',
          mount: id,
        })
      ).status,
    ).toBe(200);
    const b = [...graph.items.values()].find((i) => i.name === 'b.txt')!;
    expect(graph.items.get(b.parentId!)?.name).toBe('Archive');

    expect(
      (
        await post('/blobs/move', {
          from: 'OneDrive/Archive/b.txt',
          to: 'SharePoint/Marketing/Documents/b.txt',
          mount: id,
        })
      ).status,
    ).toBe(200);
    expect(b.deleted).toBe(true);
    expect(
      await (
        await call(`/blobs/SharePoint/Marketing/Documents/b.txt?${q}`)
      ).text(),
    ).toBe('a');

    const toOrg = await post('/blobs/copy', {
      from: 'OneDrive/a.txt',
      fromMount: id,
      to: 'imports/a.txt',
      toMount: 'platform',
    });
    expect(toOrg.status).toBe(200);
    expect(await (await call('/blobs/imports/a.txt')).text()).toBe('a');
    const records = await index.listByPrefix(ORG, '', 1000);
    expect(records.some((r) => r.mountId === id)).toBe(false);
  });

  test('delete goes to the recycle bin; restore where Graph supports it', async () => {
    const { call, connect, mountId, graph } = await setup();
    await connect();
    const id = await mountId();
    const q = `mount=${id}`;
    await call(`/blobs/OneDrive/Docs/a.txt?${q}`, put('a'));
    const del = await call(`/blobs/OneDrive/Docs/a.txt?${q}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(200);
    const a = [...graph.items.values()].find((i) => i.name === 'a.txt')!;
    expect(a.deleted).toBe(true);
    expect((await call(`/blobs/OneDrive/Docs/a.txt?${q}`)).status).toBe(404);

    const { trashKey } = (await del.json()) as { trashKey: string };
    const restored = await call('/blobs/restore', {
      method: 'POST',
      body: JSON.stringify({ key: trashKey, mountId: id }),
    });
    expect(restored.status).toBe(200);
    expect(
      ((await restored.json()) as { relativeKey: string }).relativeKey,
    ).toBe('OneDrive/Docs/a.txt');
    expect(a.deleted).toBe(false);
  });

  test('throttling honors Retry-After', async () => {
    const { call, connect, mountId, graph, sleeps } = await setup();
    await connect();
    const id = await mountId();
    graph.state.throttle = 2;
    const res = await call(`/blobs?mount=${id}&prefix=OneDrive/`);
    expect(res.status).toBe(200);
    expect(sleeps.slice(0, 2)).toEqual([1000, 1000]);
  });

  test('refresh rotates tokens with the scope; revoked consent asks to reconnect', async () => {
    const { call, connect, mountId, tokens, graph } = await setup();
    await connect();
    const id = await mountId();
    const stored = (await tokens.get(ORG, 'u_a', id))!;
    await tokens.put(ORG, 'u_a', id, {
      ...stored,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect((await call(`/blobs?mount=${id}&prefix=OneDrive/`)).status).toBe(
      200,
    );
    const refreshed = (await tokens.get(ORG, 'u_a', id))!;
    expect(refreshed.accessToken).not.toBe(stored.accessToken);
    expect(refreshed.refreshToken).not.toBe(stored.refreshToken);
    expect(graph.state.refreshScope).toContain('Files.ReadWrite.All');

    graph.accessTokens.clear();
    graph.refreshTokens.clear();
    const failed = await call(`/blobs?mount=${id}&prefix=OneDrive/Other/`);
    expect(failed.status).toBe(409);
    expect(((await failed.json()) as { code: string }).code).toBe(
      'reconnect_required',
    );
    const mounts = (await (await call('/mounts')).json()) as {
      mounts: Array<{ id: string; status: string }>;
    };
    expect(mounts.mounts.find((m) => m.id === id)?.status).toBe('disconnected');

    const wrong = await connect('code-other', id);
    expect(decodeURIComponent(wrong.location)).toContain('a@contoso.com');
    expect((await connect('code-a2', id)).location).toBe(
      '/?files_drive=connected',
    );
    expect((await call(`/blobs?mount=${id}&prefix=OneDrive/`)).status).toBe(
      200,
    );
  });

  test('disconnect forgets tokens; connect is disabled without the Entra app', async () => {
    const { call, connect, mountId, tokens, ctx } = await setup();
    await connect();
    const id = await mountId();
    expect((await call(`/mounts/${id}`, { method: 'DELETE' })).status).toBe(
      200,
    );
    expect(await tokens.get(ORG, 'u_a', id)).toBeUndefined();

    ctx.runtimeEnv = {};
    const res = await call('/personal-mounts/onedrive/connect', {
      method: 'POST',
      body: '{}',
    });
    expect(res.status).toBe(503);
  });
});
