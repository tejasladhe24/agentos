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
import {
  describeS3Error,
  type S3ClientLike,
} from '@agentos/core/builtins/files/api/lib/s3-blob-store';
import {
  createS3MountProvider,
  type S3MountClientInput,
} from '@agentos/core/builtins/files/api/lib/s3-mount-provider';
import {
  pathStyleEndpoint,
  resolveS3Location,
} from '@agentos/core/builtins/files/api/lib/s3-presets';
import {
  EMPTY_PAYLOAD_SHA256,
  signS3Request,
} from '@agentos/core/builtins/files/api/lib/s3-sign';
import { createStorageProviderRegistry } from '@agentos/core/builtins/files/api/lib/storage-providers';

const ORG = 'org_s3';
const BASE = 'http://127.0.0.1:6116';

type Bucket = Map<string, Uint8Array>;
type FailOn = Partial<Record<'list' | 'write' | 'delete', string>>;

function s3Error(code: string): Error {
  return Object.assign(new Error(`${code}: denied`), { code });
}

function memoryClient(objects: Bucket, failOn: FailOn = {}): S3ClientLike {
  return {
    file(key) {
      return {
        async write(data) {
          if (failOn.write) throw s3Error(failOn.write);
          const bytes =
            typeof data === 'string'
              ? new TextEncoder().encode(data)
              : data instanceof Uint8Array
                ? data
                : new Uint8Array(data as ArrayBuffer);
          objects.set(key, bytes);
          return bytes.byteLength;
        },
        async arrayBuffer() {
          const bytes = objects.get(key);
          if (!bytes) throw new Error('not found');
          return bytes.slice().buffer;
        },
        async exists() {
          return objects.has(key);
        },
        async delete() {
          if (failOn.delete) throw s3Error(failOn.delete);
          objects.delete(key);
        },
      };
    },
    async list(options = {}) {
      if (failOn.list) throw s3Error(failOn.list);
      const prefix = options.prefix ?? '';
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix));
      if (options.delimiter !== '/') {
        return {
          contents: keys.map((key) => ({
            key,
            size: objects.get(key)!.byteLength,
          })),
          isTruncated: false,
        };
      }
      const contents: Array<{ key: string; size: number }> = [];
      const prefixes = new Set<string>();
      for (const key of keys) {
        const rest = key.slice(prefix.length);
        const slash = rest.indexOf('/');
        if (slash === -1) {
          contents.push({ key, size: objects.get(key)!.byteLength });
        } else prefixes.add(`${prefix}${rest.slice(0, slash + 1)}`);
      }
      return {
        contents,
        commonPrefixes: [...prefixes].map((p) => ({ prefix: p })),
        isTruncated: false,
      };
    },
  };
}

async function setup(failOn: FailOn = {}) {
  const buckets = new Map<string, Bucket>();
  const clientInputs: S3MountClientInput[] = [];
  const bucketFor = (endpoint: string, bucket: string) => {
    const id = `${endpoint}|${bucket}`;
    let objects = buckets.get(id);
    if (!objects) {
      objects = new Map();
      buckets.set(id, objects);
    }
    return objects;
  };
  const copyCalls: Array<{ url: string; headers: Record<string, string> }> = [];
  const copyFetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = new URL(String(input));
    const headers = init?.headers as Record<string, string>;
    copyCalls.push({ url: url.toString(), headers });
    const [, bucket, ...rest] = decodeURIComponent(url.pathname).split('/');
    const source = decodeURIComponent(headers['x-amz-copy-source']!)
      .split('/')
      .slice(2)
      .join('/');
    const objects = bucketFor(url.origin, bucket!);
    const bytes = objects.get(source);
    if (!bytes) {
      return new Response('<Error><Code>NoSuchKey</Code></Error>', {
        status: 404,
      });
    }
    objects.set(rest.join('/'), bytes);
    return new Response('<CopyObjectResult></CopyObjectResult>');
  }) as typeof fetch;

  const providers = createStorageProviderRegistry([
    createS3MountProvider({
      createClient(input) {
        clientInputs.push(input);
        const endpoint = pathStyleEndpoint(input);
        return memoryClient(bucketFor(endpoint, input.bucket), failOn);
      },
      fetch: copyFetch,
    }),
  ]);
  const root = await mkdtemp(join(tmpdir(), 'agentos-files-s3-mounts-'));
  const ctx: FilesContext = {
    store: await createBlobStore(root),
    index: createMemoryObjectIndex(),
    settings: createMemoryOrgSettingsStore(),
    mounts: createMemoryMountStore(),
    providers,
    resolveOrg: async () => ({
      ok: true,
      orgId: ORG,
      via: 'session',
      userId: 'u_admin',
    }),
    checkPermission: async () => 'ok',
  };
  const call = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (typeof init.body === 'string') {
      headers.set('content-type', 'application/json');
    }
    return handleFilesRequest(
      ctx,
      new Request(`${BASE}${path}`, { ...init, headers }),
    );
  };
  return { call, buckets, bucketFor, clientInputs, copyCalls };
}

const KEYS = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'shhh' };

async function addMount(
  call: Awaited<ReturnType<typeof setup>>['call'],
  name: string,
  config: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const res = await call('/mounts', {
    method: 'POST',
    body: JSON.stringify({
      provider: 's3',
      name,
      config: { ...config, ...KEYS },
      ...extra,
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { mount: { id: string } }).mount.id;
}

function upload(text: string) {
  return {
    method: 'PUT',
    body: JSON.stringify({ base64: btoa(text), contentType: 'text/plain' }),
  };
}

describe('S3 SigV4', () => {
  test('matches the AWS GET Object example signature', () => {
    const headers = signS3Request({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: { range: 'bytes=0-9' },
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      },
      now: new Date('2013-05-24T00:00:00Z'),
      payloadHash: EMPTY_PAYLOAD_SHA256,
    });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });
});

describe('S3 presets', () => {
  test('resolve endpoint, region, and URL style per preset', () => {
    expect(
      resolveS3Location({ preset: 'aws', bucket: 'b-1', region: 'eu-west-1' }),
    ).toEqual({
      preset: 'aws',
      bucket: 'b-1',
      endpoint: undefined,
      region: 'eu-west-1',
      virtualHostedStyle: true,
    });
    expect(
      resolveS3Location({
        preset: 'r2',
        bucket: 'files',
        accountId: 'abc123def456',
      }),
    ).toMatchObject({
      endpoint: 'https://abc123def456.r2.cloudflarestorage.com',
      region: 'auto',
      virtualHostedStyle: false,
    });
    expect(resolveS3Location({ preset: 'gcs', bucket: 'g-1' })).toMatchObject({
      endpoint: 'https://storage.googleapis.com',
      region: 'auto',
    });
    expect(
      resolveS3Location({ preset: 'b2', bucket: 'b2b', region: 'us-west-004' }),
    ).toMatchObject({ endpoint: 'https://s3.us-west-004.backblazeb2.com' });
    expect(
      resolveS3Location({ preset: 'wasabi', bucket: 'w-1' }),
    ).toMatchObject({
      endpoint: 'https://s3.us-east-1.wasabisys.com',
      region: 'us-east-1',
    });
    expect(
      resolveS3Location({
        preset: 'do-spaces',
        bucket: 'space',
        region: 'nyc3',
      }),
    ).toMatchObject({
      endpoint: 'https://nyc3.digitaloceanspaces.com',
      virtualHostedStyle: true,
    });
    expect(
      resolveS3Location({
        preset: 'minio',
        bucket: 'local',
        endpoint: 'http://127.0.0.1:9000/',
      }),
    ).toMatchObject({
      endpoint: 'http://127.0.0.1:9000',
      region: 'us-east-1',
      virtualHostedStyle: false,
    });
    expect(
      resolveS3Location({
        preset: 'supabase',
        bucket: 'docs',
        region: 'us-east-1',
        projectRef: 'abcdefghijklmnop',
      }),
    ).toMatchObject({
      endpoint: 'https://abcdefghijklmnop.supabase.co/storage/v1/s3',
    });
    expect(
      pathStyleEndpoint({ region: 'eu-west-1', virtualHostedStyle: true }),
    ).toBe('https://s3.eu-west-1.amazonaws.com');
  });

  test('reject missing or unsafe settings', () => {
    expect(() => resolveS3Location({ preset: 'aws', bucket: 'b-1' })).toThrow(
      'region is required',
    );
    expect(() => resolveS3Location({ preset: 'r2', bucket: 'b-1' })).toThrow(
      'accountId is required',
    );
    expect(() => resolveS3Location({ preset: 'minio', bucket: 'b-1' })).toThrow(
      'endpoint is required',
    );
    expect(() =>
      resolveS3Location({
        preset: 'aws',
        bucket: 'b-1',
        region: 'us-east-1',
        endpoint: 'http://insecure.example.com',
      }),
    ).toThrow('https');
    expect(() =>
      resolveS3Location({
        preset: 'minio',
        bucket: 'b-1',
        endpoint: 'http://user:pw@host:9000',
      }),
    ).toThrow('credentials');
    expect(() => resolveS3Location({ preset: 'nope', bucket: 'b-1' })).toThrow(
      'unknown S3 preset',
    );
    expect(() => resolveS3Location({ preset: 'gcs', bucket: '../x' })).toThrow(
      'bucket name',
    );
  });

  test('describe S3 errors with the missing permission', () => {
    expect(describeS3Error(s3Error('AccessDenied'), 'write')).toContain(
      's3:PutObject',
    );
    expect(describeS3Error(s3Error('AccessDenied'), 'list')).toContain(
      's3:ListBucket',
    );
    expect(describeS3Error(s3Error('InvalidAccessKeyId'), 'list')).toContain(
      'access key ID',
    );
    expect(describeS3Error(s3Error('SignatureDoesNotMatch'), 'list')).toContain(
      'secret access key',
    );
    expect(describeS3Error(s3Error('NoSuchBucket'), 'list')).toContain(
      'bucket not found',
    );
  });
});

describe('S3 org mounts', () => {
  test('multiple bucket mounts stay isolated; default receives uploads', async () => {
    const { call, bucketFor, clientInputs } = await setup();
    const r2 = await addMount(call, 'R2 archive', {
      preset: 'r2',
      bucket: 'archive',
      accountId: 'acct00000001',
    });
    const minio = await addMount(
      call,
      'Team MinIO',
      {
        preset: 'minio',
        bucket: 'team',
        endpoint: 'http://minio.local:9000',
        prefix: 'agentos/',
      },
      { isDefault: true },
    );

    const listed = (await (await call('/mounts')).json()) as {
      mounts: Array<{
        id: string;
        isDefault: boolean;
        config?: Record<string, unknown>;
      }>;
      providers: Array<{
        id: string;
        orgAddable: boolean;
        presets?: unknown[];
      }>;
    };
    expect(listed.mounts.map((m) => m.id)).toEqual(['platform', r2, minio]);
    expect(listed.mounts.find((m) => m.isDefault)?.id).toBe(minio);
    expect(JSON.stringify(listed)).not.toContain('shhh');
    const s3 = listed.providers.find((p) => p.id === 's3');
    expect(s3?.orgAddable).toBe(true);
    expect(s3?.presets?.length).toBe(8);

    expect(
      (await call(`/blobs/a.txt?mount=${r2}`, upload('in r2'))).status,
    ).toBe(200);
    expect(
      (await call('/blobs/b.txt?mount=default', upload('in minio'))).status,
    ).toBe(200);

    const r2Bucket = bucketFor(
      'https://acct00000001.r2.cloudflarestorage.com',
      'archive',
    );
    const minioBucket = bucketFor('http://minio.local:9000', 'team');
    expect([...r2Bucket.keys()]).toEqual(['a.txt']);
    expect([...minioBucket.keys()]).toEqual(['agentos/b.txt']);
    expect(clientInputs.every((i) => i.accessKeyId === 'AKIDEXAMPLE')).toBe(
      true,
    );

    const r2List = (await (
      await call(`/blobs?prefix=&mount=${r2}`)
    ).json()) as {
      items: Array<{ name: string; ref?: string }>;
    };
    expect(r2List.items.map((i) => i.name)).toEqual(['a.txt']);
    expect(r2List.items[0]?.ref).toBe(`files://${r2}/a.txt`);
    const platformList = (await (await call('/blobs?prefix=')).json()) as {
      items: unknown[];
    };
    expect(platformList.items).toEqual([]);
  });

  test('test connection names the missing permission; failed add is rejected', async () => {
    const { call } = await setup({ write: 'AccessDenied' });
    const draft = {
      provider: 's3',
      config: { preset: 'gcs', bucket: 'g-bucket', ...KEYS },
    };
    const res = await call('/mounts/test', {
      method: 'POST',
      body: JSON.stringify(draft),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('s3:PutObject');

    const add = await call('/mounts', {
      method: 'POST',
      body: JSON.stringify({ ...draft, name: 'GCS' }),
    });
    expect(add.status).toBe(400);
    expect(((await add.json()) as { error: string }).error).toContain(
      's3:PutObject',
    );

    const missingKeys = await call('/mounts/test', {
      method: 'POST',
      body: JSON.stringify({
        provider: 's3',
        config: { preset: 'gcs', bucket: 'g-bucket' },
      }),
    });
    expect(((await missingKeys.json()) as { error: string }).error).toContain(
      'access key ID and secret access key are required',
    );
  });

  test('copy within a bucket uses signed server-side CopyObject', async () => {
    const { call, bucketFor, copyCalls } = await setup();
    const id = await addMount(call, 'AWS', {
      preset: 'aws',
      bucket: 'docs',
      region: 'us-east-1',
    });
    await call(`/blobs/a.txt?mount=${id}`, upload('hello'));
    const res = await call('/blobs/copy', {
      method: 'POST',
      body: JSON.stringify({ from: 'a.txt', to: 'copy/a.txt', mount: id }),
    });
    expect(res.status).toBe(200);
    expect(copyCalls).toHaveLength(1);
    expect(copyCalls[0]?.url).toBe(
      'https://s3.us-east-1.amazonaws.com/docs/copy/a.txt',
    );
    expect(copyCalls[0]?.headers['x-amz-copy-source']).toBe('/docs/a.txt');
    expect(copyCalls[0]?.headers.authorization).toContain(
      'Credential=AKIDEXAMPLE/',
    );
    const objects = bucketFor('https://s3.us-east-1.amazonaws.com', 'docs');
    expect(new TextDecoder().decode(objects.get('copy/a.txt'))).toBe('hello');
  });
});
