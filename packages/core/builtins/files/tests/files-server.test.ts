import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BlobStoreError,
  createBlobStore,
} from '@agentos/core/builtins/files/api/lib/blob-store';
import { handleFilesRequest } from '@agentos/core/builtins/files/api/lib/handle-request';
import type { S3ClientLike } from '@agentos/core/builtins/files/api/lib/s3-blob-store';

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
  };
}

describe('builtin files server', () => {
  test('filesystem: put → get binary and json; reject traversal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentos-files-test-'));
    const store = await createBlobStore(root);

    expect(store.backend).toBe('filesystem');

    const health = await handleFilesRequest(
      store,
      new Request('http://127.0.0.1:6116/health'),
    );
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      ok: true,
      backend: 'filesystem',
      label: store.label,
    });

    const put = await handleFilesRequest(
      store,
      new Request('http://127.0.0.1:6116/blobs/notes/hello.txt', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ base64: btoa('hello') }),
      }),
    );
    expect(put.status).toBe(200);

    const get = await handleFilesRequest(
      store,
      new Request('http://127.0.0.1:6116/blobs/notes/hello.txt'),
    );
    expect(get.status).toBe(200);
    expect(await get.text()).toBe('hello');

    const getJson = await handleFilesRequest(
      store,
      new Request('http://127.0.0.1:6116/blobs/notes/hello.txt?format=json'),
    );
    expect(getJson.status).toBe(200);
    expect(await getJson.json()).toMatchObject({
      key: 'notes/hello.txt',
      base64: btoa('hello'),
    });

    // Encoded `../` so the URL parser does not normalize the key away.
    const traversal = await handleFilesRequest(
      store,
      new Request(
        `http://127.0.0.1:6116/blobs/${encodeURIComponent('../etc/passwd')}`,
        {
          method: 'PUT',
          body: 'x',
        },
      ),
    );
    expect(traversal.status).toBe(400);

    const missing = await handleFilesRequest(
      store,
      new Request('http://127.0.0.1:6116/blobs/missing.bin'),
    );
    expect(missing.status).toBe(404);

    const del = await handleFilesRequest(
      store,
      new Request('http://127.0.0.1:6116/blobs/notes/hello.txt', {
        method: 'DELETE',
      }),
    );
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true, key: 'notes/hello.txt' });

    const afterDel = await handleFilesRequest(
      store,
      new Request('http://127.0.0.1:6116/blobs/notes/hello.txt'),
    );
    expect(afterDel.status).toBe(404);

    const delMissing = await handleFilesRequest(
      store,
      new Request('http://127.0.0.1:6116/blobs/notes/hello.txt', {
        method: 'DELETE',
      }),
    );
    expect(delMissing.status).toBe(200);
  });

  test('s3 backend: put → get and reject traversal (mocked client)', async () => {
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

    expect(store.backend).toBe('s3');
    expect(store.label).toBe('s3://agentos-files');

    const health = await handleFilesRequest(
      store,
      new Request('http://127.0.0.1:6116/health'),
    );
    expect(await health.json()).toMatchObject({
      ok: true,
      backend: 's3',
      label: 's3://agentos-files',
    });

    const put = await handleFilesRequest(
      store,
      new Request('http://127.0.0.1:6116/blobs/docs/a.txt', {
        method: 'PUT',
        body: 's3-hello',
      }),
    );
    expect(put.status).toBe(200);

    const get = await handleFilesRequest(
      store,
      new Request('http://127.0.0.1:6116/blobs/docs/a.txt'),
    );
    expect(get.status).toBe(200);
    expect(await get.text()).toBe('s3-hello');

    const traversal = await handleFilesRequest(
      store,
      new Request(
        `http://127.0.0.1:6116/blobs/${encodeURIComponent('foo/../../etc/passwd')}`,
        { method: 'PUT', body: 'x' },
      ),
    );
    expect(traversal.status).toBe(400);

    const missing = await handleFilesRequest(
      store,
      new Request('http://127.0.0.1:6116/blobs/missing.bin'),
    );
    expect(missing.status).toBe(404);

    const del = await handleFilesRequest(
      store,
      new Request('http://127.0.0.1:6116/blobs/docs/a.txt', {
        method: 'DELETE',
      }),
    );
    expect(del.status).toBe(200);
    const afterDel = await handleFilesRequest(
      store,
      new Request('http://127.0.0.1:6116/blobs/docs/a.txt'),
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
