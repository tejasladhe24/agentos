import { describe, expect, test } from 'bun:test';
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
import { createMemoryOrgSettingsStore } from '@agentos/core/builtins/files/api/lib/org-settings';
import { createStorageProviderRegistry } from '@agentos/core/builtins/files/api/lib/storage-providers';
import {
  createUploadThingProvider,
  createVercelBlobProvider,
} from '@agentos/core/builtins/files/api/lib/upload-service-providers';
import { parseUploadThingToken } from '@agentos/core/builtins/files/api/lib/uploadthing-store';
import { storeIdFromToken } from '@agentos/core/builtins/files/api/lib/vercel-blob-store';

const ORG = 'org_us';
const BASE = 'http://127.0.0.1:6116';
const UT_API_KEY = 'sk_test_abc123';
const UT_APP = 'app123xyz';
const UT_TOKEN = btoa(
  JSON.stringify({ apiKey: UT_API_KEY, appId: UT_APP, regions: ['sea1'] }),
);
const VB_STORE = 'AbCd1234EfGh';
const VB_TOKEN = `vercel_blob_rw_${VB_STORE}_s3cr3t`;

type Stored = { bytes: Uint8Array; uploadedAt: number };

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload),
  );
  return Buffer.from(sig).toString('hex');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** UploadThing API + ingest + CDN, as the official SDK calls them. */
function mockUploadThing() {
  const files = new Map<
    string,
    Stored & { name: string; customId: string | null; type: string }
  >();
  const calls: string[] = [];
  let counter = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as string, init);
    const url = new URL(req.url);
    calls.push(`${req.method} ${url.host}${url.pathname}`);

    if (url.host === 'api.uploadthing.com') {
      if (req.headers.get('x-uploadthing-api-key') !== UT_API_KEY) {
        return json({ error: 'Invalid API key' }, 401);
      }
      const body = (await req.json()) as Record<string, unknown>;
      if (url.pathname === '/v6/listFiles') {
        const offset = Number(body.offset ?? 0);
        const limit = Number(body.limit ?? 500);
        const all = [...files.entries()];
        return json({
          hasMore: offset + limit < all.length,
          files: all.slice(offset, offset + limit).map(([key, f]) => ({
            id: key,
            key,
            name: f.name,
            customId: f.customId,
            size: f.bytes.byteLength,
            status: 'Uploaded',
            uploadedAt: f.uploadedAt,
          })),
        });
      }
      if (url.pathname === '/v6/deleteFiles') {
        const keys = (body.fileKeys as string[]) ?? [];
        let deletedCount = 0;
        for (const key of keys) if (files.delete(key)) deletedCount += 1;
        return json({ success: true, deletedCount });
      }
      if (url.pathname === '/v6/renameFiles') {
        for (const u of body.updates as Array<{
          fileKey: string;
          newName: string;
        }>) {
          const file = files.get(u.fileKey);
          if (file) file.name = u.newName;
        }
        return json({ success: true });
      }
      return json({ error: 'not found' }, 404);
    }

    if (url.host === 'sea1.ingest.uploadthing.com' && req.method === 'PUT') {
      const signature = url.searchParams.get('signature') ?? '';
      const unsigned = new URL(url);
      unsigned.searchParams.delete('signature');
      const expected = `hmac-sha256=${await hmacHex(UT_API_KEY, unsigned.toString())}`;
      if (signature !== expected) return json({ error: 'bad signature' }, 403);
      const form = await req.formData();
      const file = form.get('file') as File;
      const key = url.pathname.slice(1);
      const param = (name: string) =>
        decodeURIComponent(url.searchParams.get(name) ?? '');
      files.set(key, {
        name: param('x-ut-file-name'),
        customId: param('x-ut-custom-id') || null,
        type: param('x-ut-file-type'),
        bytes: new Uint8Array(await file.arrayBuffer()),
        uploadedAt: Date.now() + counter++,
      });
      const ufsUrl = `https://${UT_APP}.ufs.sh/f/${key}`;
      return json({ ufsUrl, url: ufsUrl, appUrl: ufsUrl, fileHash: 'h' });
    }

    if (url.host === `${UT_APP.toLowerCase()}.ufs.sh`) {
      if (!url.searchParams.get('signature'))
        return new Response('', { status: 403 });
      const file = files.get(url.pathname.replace(/^\/f\//, ''));
      return file
        ? new Response(file.bytes)
        : new Response('not found', { status: 404 });
    }
    return new Response('unexpected', { status: 500 });
  }) as typeof fetch;
  return { files, calls, fetch: fetchImpl };
}

/** Vercel Blob API + store host, as `@vercel/blob` calls them. */
function mockVercelBlob() {
  const blobs = new Map<string, Stored>();
  const calls: string[] = [];
  const blobUrl = (p: string) =>
    `https://${VB_STORE}.public.blob.vercel-storage.com/${p}`;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as string, init);
    const url = new URL(req.url);
    calls.push(`${req.method} ${url.host}${url.pathname}${url.search}`);
    if (req.headers.get('authorization') !== `Bearer ${VB_TOKEN}`) {
      return json({ error: { code: 'forbidden', message: 'denied' } }, 403);
    }
    if (url.host === 'vercel.com' && url.pathname.startsWith('/api/blob')) {
      expect(req.headers.get('x-api-version')).toBe('13');
      const pathname = url.searchParams.get('pathname');
      if (req.method === 'PUT' && pathname) {
        expect(req.headers.get('x-vercel-blob-access')).toBe('public');
        const fromUrl = url.searchParams.get('fromUrl');
        const bytes = fromUrl
          ? blobs.get(fromUrl)?.bytes
          : new Uint8Array(await req.arrayBuffer());
        if (!bytes) return json({ error: { code: 'not_found' } }, 404);
        blobs.set(pathname, { bytes, uploadedAt: Date.now() });
        return json({ url: blobUrl(pathname), pathname });
      }
      if (req.method === 'POST' && url.pathname === '/api/blob/delete') {
        const { urls } = (await req.json()) as { urls: string[] };
        for (const u of urls) blobs.delete(u);
        return json({});
      }
      if (req.method === 'GET') {
        const prefix = url.searchParams.get('prefix') ?? '';
        const folded = url.searchParams.get('mode') === 'folded';
        const folders = new Set<string>();
        const list: Array<{ pathname: string } & Stored> = [];
        for (const [p, b] of blobs) {
          if (!p.startsWith(prefix)) continue;
          const slash = p.slice(prefix.length).indexOf('/');
          if (folded && slash >= 0) {
            folders.add(p.slice(0, prefix.length + slash + 1));
          } else list.push({ pathname: p, ...b });
        }
        return json({
          blobs: list.map((b) => ({
            url: blobUrl(b.pathname),
            pathname: b.pathname,
            size: b.bytes.byteLength,
            uploadedAt: new Date(b.uploadedAt).toISOString(),
          })),
          folders: [...folders],
          hasMore: false,
        });
      }
    }
    if (
      url.host === `${VB_STORE.toLowerCase()}.public.blob.vercel-storage.com`
    ) {
      const blob = blobs.get(decodeURIComponent(url.pathname.slice(1)));
      return blob
        ? new Response(blob.bytes)
        : new Response('', { status: 404 });
    }
    return new Response('unexpected', { status: 500 });
  }) as typeof fetch;
  return { blobs, calls, fetch: fetchImpl };
}

async function setup(fetchImpl: typeof fetch) {
  const root = await mkdtemp(join(tmpdir(), 'agentos-files-upload-'));
  const ctx: FilesContext = {
    store: await createBlobStore(root),
    index: createMemoryObjectIndex(),
    settings: createMemoryOrgSettingsStore(),
    mounts: createMemoryMountStore(),
    providers: createStorageProviderRegistry([
      createUploadThingProvider({ fetch: fetchImpl }),
      createVercelBlobProvider({ fetch: fetchImpl }),
    ]),
    resolveOrg: async () => ({
      ok: true,
      orgId: ORG,
      via: 'session',
      userId: 'u_admin',
    }),
    checkPermission: async () => 'ok',
  };
  return (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (typeof init.body === 'string') {
      headers.set('content-type', 'application/json');
    }
    return handleFilesRequest(
      ctx,
      new Request(`${BASE}${path}`, { ...init, headers }),
    );
  };
}

function upload(text: string, contentType = 'text/plain'): RequestInit {
  return {
    method: 'PUT',
    body: JSON.stringify({ base64: btoa(text), contentType }),
  };
}

async function names(res: Response): Promise<string[]> {
  const body = (await res.json()) as {
    items: Array<{ name: string; kind: string }>;
  };
  return body.items.map((i) => `${i.kind}:${i.name}`).sort();
}

describe('provider tokens', () => {
  test('parse UploadThing and Vercel Blob tokens', () => {
    expect(parseUploadThingToken(UT_TOKEN)).toEqual({
      apiKey: UT_API_KEY,
      appId: UT_APP,
      regions: ['sea1'],
    });
    expect(() => parseUploadThingToken('nope')).toThrow(
      'invalid UploadThing token',
    );
    expect(() =>
      parseUploadThingToken(btoa(JSON.stringify({ apiKey: 'x', appId: 'a' }))),
    ).toThrow('expected { apiKey, appId, regions }');
    expect(storeIdFromToken(VB_TOKEN)).toBe(VB_STORE);
  });
});

describe('UploadThing mounts', () => {
  test('add → virtual folders → upload → rename-in-place move → download', async () => {
    const ut = mockUploadThing();
    const call = await setup(ut.fetch);
    const add = await call('/mounts', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'uploadthing',
        name: 'UT',
        config: { appId: UT_APP },
        secrets: { token: UT_TOKEN },
      }),
    });
    expect(add.status).toBe(201);
    const { mount } = (await add.json()) as { mount: { id: string } };
    expect(ut.files.size).toBe(0);

    const q = `mount=${mount.id}`;
    expect((await call(`/blobs/docs/a.txt?${q}`, upload('alpha'))).status).toBe(
      200,
    );
    expect((await call(`/blobs/top.txt?${q}`, upload('top'))).status).toBe(200);
    const [stored] = [...ut.files.values()].filter(
      (f) => f.name === 'docs/a.txt',
    );
    expect(stored?.customId?.startsWith('agentos_')).toBe(true);
    expect(stored?.type).toStartWith('text/plain');

    expect(await names(await call(`/blobs?prefix=&${q}`))).toEqual([
      'file:top.txt',
      'folder:docs',
    ]);

    const keyBefore = [...ut.files.entries()].find(
      ([, f]) => f.name === 'docs/a.txt',
    )![0];
    const uploadsBefore = ut.calls.filter((c) => c.startsWith('PUT')).length;
    const move = await call('/blobs/move', {
      method: 'POST',
      body: JSON.stringify({
        from: 'docs/a.txt',
        to: 'archive/a.txt',
        mount: mount.id,
      }),
    });
    expect(move.status).toBe(200);
    expect(ut.files.get(keyBefore)?.name).toBe('archive/a.txt');
    expect(ut.calls.filter((c) => c.startsWith('PUT')).length).toBe(
      uploadsBefore,
    );
    expect(ut.calls).toContain('POST api.uploadthing.com/v6/renameFiles');

    expect(await names(await call(`/blobs?prefix=&${q}`))).toEqual([
      'file:top.txt',
      'folder:archive',
    ]);
    const get = await call(`/blobs/archive/a.txt?${q}`);
    expect(get.status).toBe(200);
    expect(await get.text()).toBe('alpha');
    expect((await call(`/blobs/docs/a.txt?${q}`)).status).toBe(404);

    expect((await call(`/blobs/top.txt?${q}`, upload('top v2'))).status).toBe(
      200,
    );
    const tops = [...ut.files.values()].filter((f) => f.name === 'top.txt');
    expect(tops).toHaveLength(1);
    expect(await (await call(`/blobs/top.txt?${q}`)).text()).toBe('top v2');
  });

  test('test connection rejects a bad key and a token for another app', async () => {
    const ut = mockUploadThing();
    const call = await setup(ut.fetch);
    const badKey = btoa(
      JSON.stringify({
        apiKey: 'sk_test_wrong',
        appId: UT_APP,
        regions: ['sea1'],
      }),
    );
    const res = await call('/mounts/test', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'uploadthing',
        config: { appId: UT_APP },
        secrets: { token: badKey },
      }),
    });
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('UploadThing');

    const otherApp = await call('/mounts/test', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'uploadthing',
        config: { appId: 'someoneelse' },
        secrets: { token: UT_TOKEN },
      }),
    });
    expect(((await otherApp.json()) as { error: string }).error).toContain(
      `token belongs to app ${UT_APP}`,
    );
  });
});

describe('Vercel Blob mounts', () => {
  test('add → upload → folded list → server-side copy → download → delete', async () => {
    const vb = mockVercelBlob();
    const call = await setup(vb.fetch);
    const add = await call('/mounts', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'vercel-blob',
        name: 'Blob',
        config: {
          access: 'public',
          storeId: `store_${VB_STORE}`,
          prefix: 'agentos',
        },
        secrets: { readWriteToken: VB_TOKEN },
      }),
    });
    expect(add.status).toBe(201);
    const { mount } = (await add.json()) as { mount: { id: string } };
    expect(vb.blobs.size).toBe(0);

    const q = `mount=${mount.id}`;
    expect((await call(`/blobs/docs/a.txt?${q}`, upload('hello'))).status).toBe(
      200,
    );
    expect([...vb.blobs.keys()]).toEqual(['agentos/docs/a.txt']);
    expect(await names(await call(`/blobs?prefix=&${q}`))).toEqual([
      'folder:docs',
    ]);

    const copy = await call('/blobs/copy', {
      method: 'POST',
      body: JSON.stringify({
        from: 'docs/a.txt',
        to: 'b.txt',
        mount: mount.id,
      }),
    });
    expect(copy.status).toBe(200);
    expect(
      vb.calls.some(
        (c) =>
          c.startsWith('PUT vercel.com/api/blob') && c.includes('fromUrl='),
      ),
    ).toBe(true);
    expect(await (await call(`/blobs/b.txt?${q}`)).text()).toBe('hello');

    expect((await call(`/blobs/b.txt?${q}`, { method: 'DELETE' })).status).toBe(
      200,
    );
    const listed = await names(await call(`/blobs?prefix=&${q}`));
    expect(listed).toEqual(['folder:docs']);
  });

  test('bad token and mismatched store are rejected with clear errors', async () => {
    const vb = mockVercelBlob();
    const call = await setup(vb.fetch);
    const bad = await call('/mounts/test', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'vercel-blob',
        config: { access: 'public' },
        secrets: { readWriteToken: `vercel_blob_rw_${VB_STORE}_wrong` },
      }),
    });
    expect(((await bad.json()) as { error: string }).error).toContain(
      'read-write token was rejected',
    );
    const mismatch = await call('/mounts/test', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'vercel-blob',
        config: { access: 'public', storeId: 'OtherStore1' },
        secrets: { readWriteToken: VB_TOKEN },
      }),
    });
    expect(((await mismatch.json()) as { error: string }).error).toContain(
      `token belongs to store ${VB_STORE}`,
    );
    const notToken = await call('/mounts/test', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'vercel-blob',
        config: {},
        secrets: { readWriteToken: 'abc' },
      }),
    });
    expect(((await notToken.json()) as { error: string }).error).toContain(
      'vercel_blob_rw_',
    );
  });
});
