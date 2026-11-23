import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BlobStoreError,
  createBlobStore,
} from '@agentos/core/builtins/files/api/lib/blob-store';
import { ORG_ID_HEADER } from '@agentos/core/builtins/files/api/lib/constants';
import {
  handleFilesRequest,
  type FilesContext,
} from '@agentos/core/builtins/files/api/lib/handle-request';
import { createMemoryObjectIndex } from '@agentos/core/builtins/files/api/lib/object-index';
import type { S3ClientLike } from '@agentos/core/builtins/files/api/lib/s3-blob-store';
import type { BlobStore } from '@agentos/core/builtins/files/api/lib/types';

const TEST_ORG = 'org_test';

function createMemoryS3Client(): S3ClientLike {
  const objects = new Map<string, Uint8Array>();
  return {
    file(key: string) {
      return {
        async write(data) {
          const bytes =
            typeof data === 'string'
              ? new TextEncoder().encode(data)
              : data instanceof Uint8Array
                ? data
                : data instanceof ArrayBuffer
                  ? new Uint8Array(data)
                  : new Uint8Array(await (data as Blob).arrayBuffer());
          objects.set(key, bytes);
          return bytes.byteLength;
        },
        async arrayBuffer() {
          const bytes = objects.get(key);
          if (!bytes) throw new Error('not found');
          const copy = new ArrayBuffer(bytes.byteLength);
          new Uint8Array(copy).set(bytes);
          return copy;
        },
        async exists() {
          return objects.has(key);
        },
        async delete() {
          objects.delete(key);
        },
      };
    },
    async list(options = {}) {
      const prefix = options.prefix ?? '';
      const delimiter = options.delimiter;
      const maxKeys = options.maxKeys ?? 1000;
      const keys = [...objects.keys()]
        .filter((k) => k.startsWith(prefix))
        .sort();
      if (delimiter === '/') {
        const contents: Array<{ key: string; size: number }> = [];
        const prefixSet = new Set<string>();
        for (const key of keys) {
          const rest = key.slice(prefix.length);
          const slash = rest.indexOf('/');
          if (slash === -1) {
            contents.push({ key, size: objects.get(key)!.byteLength });
          } else {
            prefixSet.add(`${prefix}${rest.slice(0, slash + 1)}`);
          }
        }
        return {
          contents: contents.slice(0, maxKeys),
          commonPrefixes: [...prefixSet].map((p) => ({ prefix: p })),
          isTruncated: false,
        };
      }
      return {
        contents: keys.slice(0, maxKeys).map((key) => ({
          key,
          size: objects.get(key)!.byteLength,
        })),
        commonPrefixes: [],
        isTruncated: keys.length > maxKeys,
      };
    },
  };
}

function ctxFor(store: BlobStore, orgId: string = TEST_ORG): FilesContext {
  return {
    store,
    index: createMemoryObjectIndex(),
    resolveOrg: async () => ({ ok: true, orgId, via: 'header' }),
    checkPermission: async () => 'ok',
  };
}

function orgRequest(
  url: string,
  init: RequestInit = {},
  orgId: string = TEST_ORG,
): Request {
  const headers = new Headers(init.headers);
  headers.set(ORG_ID_HEADER, orgId);
  return new Request(url, { ...init, headers });
}

describe('builtin files server', () => {
  test('filesystem: put → get binary and json; reject traversal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentos-files-test-'));
    const store = await createBlobStore(root);
    const ctx = ctxFor(store);

    expect(store.backend).toBe('filesystem');

    const health = await handleFilesRequest(
      ctx,
      new Request('http://127.0.0.1:6116/health'),
    );
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      ok: true,
      backend: 'filesystem',
      label: store.label,
    });

    const put = await handleFilesRequest(
      ctx,
      orgRequest('http://127.0.0.1:6116/blobs/notes/hello.txt', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          base64: btoa('hello'),
          contentType: 'text/plain',
        }),
      }),
    );
    expect(put.status).toBe(200);
    const putBody = (await put.json()) as { key: string };
    expect(putBody.key).toBe(`orgs/${TEST_ORG}/notes/hello.txt`);

    const get = await handleFilesRequest(
      ctx,
      orgRequest('http://127.0.0.1:6116/blobs/notes/hello.txt'),
    );
    expect(get.status).toBe(200);
    expect(await get.text()).toBe('hello');
    expect(get.headers.get('content-type')).toContain('text/plain');

    const getJson = await handleFilesRequest(
      ctx,
      orgRequest('http://127.0.0.1:6116/blobs/notes/hello.txt?format=json'),
    );
    expect(getJson.status).toBe(200);
    expect(await getJson.json()).toMatchObject({
      key: `orgs/${TEST_ORG}/notes/hello.txt`,
      base64: btoa('hello'),
      contentType: 'text/plain',
    });

    const traversal = await handleFilesRequest(
      ctx,
      orgRequest(
        `http://127.0.0.1:6116/blobs/${encodeURIComponent('../etc/passwd')}`,
        {
          method: 'PUT',
          body: 'x',
        },
      ),
    );
    expect(traversal.status).toBe(400);

    const missing = await handleFilesRequest(
      ctx,
      orgRequest('http://127.0.0.1:6116/blobs/missing.bin'),
    );
    expect(missing.status).toBe(404);

    const del = await handleFilesRequest(
      ctx,
      orgRequest('http://127.0.0.1:6116/blobs/notes/hello.txt', {
        method: 'DELETE',
      }),
    );
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({
      ok: true,
      key: `orgs/${TEST_ORG}/notes/hello.txt`,
    });

    const afterDel = await handleFilesRequest(
      ctx,
      orgRequest('http://127.0.0.1:6116/blobs/notes/hello.txt'),
    );
    expect(afterDel.status).toBe(404);

    const delMissing = await handleFilesRequest(
      ctx,
      orgRequest('http://127.0.0.1:6116/blobs/notes/hello.txt', {
        method: 'DELETE',
      }),
    );
    expect(delMissing.status).toBe(200);
  });

  test('list / move / metadata round-trip', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentos-files-list-'));
    const store = await createBlobStore(root);
    const ctx = ctxFor(store);

    await handleFilesRequest(
      ctx,
      orgRequest('http://127.0.0.1:6116/blobs/docs/a.txt', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          base64: btoa('aaa'),
          contentType: 'text/plain',
        }),
      }),
    );
    await handleFilesRequest(
      ctx,
      orgRequest('http://127.0.0.1:6116/blobs/docs/sub/b.txt', {
        method: 'PUT',
        body: 'bbb',
      }),
    );

    const list = await handleFilesRequest(
      ctx,
      orgRequest('http://127.0.0.1:6116/blobs?prefix=docs/'),
    );
    expect(list.status).toBe(200);
    const listed = (await list.json()) as {
      items: Array<{ name: string; kind: string }>;
    };
    const names = listed.items.map((i) => i.name).sort();
    expect(names).toContain('a.txt');
    expect(names).toContain('sub');

    const move = await handleFilesRequest(
      ctx,
      orgRequest('http://127.0.0.1:6116/blobs/move', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: 'docs/a.txt', to: 'docs/renamed.txt' }),
      }),
    );
    expect(move.status).toBe(200);

    const oldGone = await handleFilesRequest(
      ctx,
      orgRequest('http://127.0.0.1:6116/blobs/docs/a.txt'),
    );
    expect(oldGone.status).toBe(404);
    const renamed = await handleFilesRequest(
      ctx,
      orgRequest('http://127.0.0.1:6116/blobs/docs/renamed.txt'),
    );
    expect(renamed.status).toBe(200);
    expect(await renamed.text()).toBe('aaa');

    const delFolder = await handleFilesRequest(
      ctx,
      orgRequest('http://127.0.0.1:6116/blobs?prefix=docs/', {
        method: 'DELETE',
      }),
    );
    expect(delFolder.status).toBe(200);
    const after = (await delFolder.json()) as { deleted: number };
    expect(after.deleted).toBeGreaterThanOrEqual(1);
  });

  test('rejects cross-org keys and requires org', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentos-files-org-'));
    const store = await createBlobStore(root);
    const ctx = ctxFor(store, 'org_a');

    const cross = await handleFilesRequest(
      ctx,
      orgRequest(
        `http://127.0.0.1:6116/blobs/${encodeURIComponent('orgs/org_b/secret.txt')}`,
        { method: 'PUT', body: 'x' },
        'org_a',
      ),
    );
    expect(cross.status).toBe(403);

    const noOrg: FilesContext = {
      store,
      resolveOrg: async () => ({
        ok: false,
        status: 401,
        error: 'org context required (session or X-AgentOS-Org-Id)',
      }),
    };
    const unauth = await handleFilesRequest(
      noOrg,
      new Request('http://127.0.0.1:6116/blobs/x', {
        method: 'PUT',
        body: 'x',
      }),
    );
    expect(unauth.status).toBe(401);
  });

  test('s3 backend: put → get, list, reject traversal (mocked client)', async () => {
    const store = await createBlobStore({
      path: '/tmp/ignored-when-s3',
      s3: {
        bucket: 'agentos-files',
        accessKeyId: 'test',
        secretAccessKey: 'test',
        endpoint: 'https://example.r2.cloudflarestorage.com',
        region: 'auto',
        client: createMemoryS3Client(),
      },
    });
    const ctx = ctxFor(store);

    expect(store.backend).toBe('s3');
    expect(store.label).toBe('s3://agentos-files');

    const put = await handleFilesRequest(
      ctx,
      orgRequest('http://127.0.0.1:6116/blobs/docs/a.txt', {
        method: 'PUT',
        body: 's3-hello',
      }),
    );
    expect(put.status).toBe(200);

    const get = await handleFilesRequest(
      ctx,
      orgRequest('http://127.0.0.1:6116/blobs/docs/a.txt'),
    );
    expect(get.status).toBe(200);
    expect(await get.text()).toBe('s3-hello');

    const list = await handleFilesRequest(
      ctx,
      orgRequest('http://127.0.0.1:6116/blobs?prefix=docs/'),
    );
    expect(list.status).toBe(200);
    const body = (await list.json()) as { items: Array<{ name: string }> };
    expect(body.items.some((i) => i.name === 'a.txt')).toBe(true);

    const traversal = await handleFilesRequest(
      ctx,
      orgRequest(
        `http://127.0.0.1:6116/blobs/${encodeURIComponent('foo/../../etc/passwd')}`,
        { method: 'PUT', body: 'x' },
      ),
    );
    expect(traversal.status).toBe(400);

    const missing = await handleFilesRequest(
      ctx,
      orgRequest('http://127.0.0.1:6116/blobs/missing.bin'),
    );
    expect(missing.status).toBe(404);

    const del = await handleFilesRequest(
      ctx,
      orgRequest('http://127.0.0.1:6116/blobs/docs/a.txt', {
        method: 'DELETE',
      }),
    );
    expect(del.status).toBe(200);
    const afterDel = await handleFilesRequest(
      ctx,
      orgRequest('http://127.0.0.1:6116/blobs/docs/a.txt'),
    );
    expect(afterDel.status).toBe(404);
  });

  test('s3 requires credentials when bucket is set', async () => {
    await expect(
      createBlobStore({
        s3: {
          bucket: 'agentos-files',
          accessKeyId: '',
          secretAccessKey: '',
        },
      }),
    ).rejects.toBeInstanceOf(BlobStoreError);
  });
});
