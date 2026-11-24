import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBlobStore } from '@agentos/core/builtins/files/api/lib/blob-store';
import { createGoogleDriveProvider } from '@agentos/core/builtins/files/api/lib/google-drive-provider';
import {
  disambiguatedName,
  parseDisambiguated,
} from '@agentos/core/builtins/files/api/lib/google-drive-store';
import {
  handleFilesRequest,
  type FilesContext,
} from '@agentos/core/builtins/files/api/lib/handle-request';
import { createMemoryMountStore } from '@agentos/core/builtins/files/api/lib/mount-store';
import { createMemoryObjectIndex } from '@agentos/core/builtins/files/api/lib/object-index';
import { purgeUserMounts } from '@agentos/core/builtins/files/api/lib/personal-mount-routes';
import { createMemoryPersonalTokenStore } from '@agentos/core/builtins/files/api/lib/personal-tokens';
import type { ResolveOrgResult } from '@agentos/core/builtins/files/api/lib/resolve-org';
import { createStorageProviderRegistry } from '@agentos/core/builtins/files/api/lib/storage-providers';

const ORG = 'org_g';
const BASE = 'http://127.0.0.1:6116';
const FOLDER = 'application/vnd.google-apps.folder';
const GDOC = 'application/vnd.google-apps.document';
const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

beforeAll(() => {
  Bun.env.AGENT_OS_GLOBAL_OAUTH_STATE_SECRET ??=
    'test-oauth-state-secret-0123456789';
});

type MockFile = {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed?: boolean;
  trashedTime?: string;
  driveId?: string;
  data?: Uint8Array;
  revisions: number;
  modifiedTime: string;
};

function unquote(raw: string): string {
  return raw.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

/** In-memory Google OAuth + Drive v3 API (only what the adapter calls). */
function mockGoogle() {
  const ROOT = 'root0000000001';
  const files = new Map<string, MockFile>();
  const drives = [{ id: 'drive0000000001', name: 'Team' }];
  const accounts = new Map([
    ['code-a', { permissionId: 'perm-a', email: 'a@example.com' }],
    ['code-a2', { permissionId: 'perm-a', email: 'a@example.com' }],
    ['code-other', { permissionId: 'perm-z', email: 'z@example.com' }],
  ]);
  const accessTokens = new Map<string, string>();
  const refreshTokens = new Map<string, string>();
  const calls: string[] = [];
  const uploads = new Map<
    string,
    { fileId?: string; name?: string; parents?: string[] }
  >();
  const state = {
    rateLimit: 0,
    nextId: 1,
    tokenSeq: 0,
    revoked: [] as string[],
  };

  const newId = (prefix = 'f') =>
    `${prefix}${String(state.nextId++).padStart(12, '0')}`;
  const now = () => new Date().toISOString();

  function seed(input: Partial<MockFile> & { name: string }): MockFile {
    const file: MockFile = {
      id: input.id ?? newId(),
      mimeType: 'text/plain',
      parents: [ROOT],
      revisions: 1,
      modifiedTime: now(),
      ...input,
    };
    files.set(file.id, file);
    return file;
  }

  function meta(file: MockFile) {
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      parents: file.parents,
      trashed: Boolean(file.trashed),
      ...(file.trashedTime ? { trashedTime: file.trashedTime } : {}),
      ...(file.driveId ? { driveId: file.driveId } : {}),
      ...(file.data ? { size: String(file.data.byteLength) } : {}),
      modifiedTime: file.modifiedTime,
      webViewLink: `https://drive.google.com/file/d/${file.id}/view`,
    };
  }

  function mintTokens(account: string) {
    state.tokenSeq += 1;
    const access = `at-${state.tokenSeq}`;
    accessTokens.set(access, account);
    return access;
  }

  const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
    Response.json(body, { status, headers });

  async function body(init?: RequestInit): Promise<string> {
    if (!init?.body) return '';
    if (typeof init.body === 'string') return init.body;
    return new TextDecoder().decode(init.body as Uint8Array);
  }

  function queryFiles(q: string, driveId?: string): MockFile[] {
    const all = [...files.values()].filter((f) =>
      driveId ? f.driveId === driveId : !f.driveId,
    );
    let m = q.match(
      /^'(.+?)' in parents and name = '((?:[^'\\]|\\.)*)' and trashed = false$/,
    );
    if (m) {
      const name = unquote(m[2]!);
      return all.filter(
        (f) => f.parents.includes(m![1]!) && f.name === name && !f.trashed,
      );
    }
    m = q.match(/^'(.+?)' in parents and trashed = false$/);
    if (m) {
      return all
        .filter((f) => f.parents.includes(m![1]!) && !f.trashed)
        .sort((a, b) =>
          a.mimeType === FOLDER && b.mimeType !== FOLDER
            ? -1
            : b.mimeType === FOLDER && a.mimeType !== FOLDER
              ? 1
              : a.name.localeCompare(b.name),
        );
    }
    if (q.startsWith('trashed = true')) {
      return all.filter((f) => f.trashed && f.mimeType !== FOLDER);
    }
    throw new Error(`unexpected q: ${q}`);
  }

  const fetchImpl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(`${method} ${url.host}${url.pathname}`);

    if (url.host === 'oauth2.googleapis.com' && url.pathname === '/token') {
      const form = new URLSearchParams(await body(init));
      if (
        form.get('client_id') !== 'gid' ||
        form.get('client_secret') !== 'gsecret'
      ) {
        return json({ error: 'invalid_client' }, 401);
      }
      if (form.get('grant_type') === 'authorization_code') {
        const account = accounts.get(form.get('code') ?? '');
        if (!account || !form.get('code_verifier')) {
          return json({ error: 'invalid_grant' }, 400);
        }
        const refresh = `rt-${account.permissionId}-${state.tokenSeq}`;
        refreshTokens.set(refresh, account.permissionId);
        return json({
          access_token: mintTokens(account.permissionId),
          refresh_token: refresh,
          expires_in: 3600,
          token_type: 'Bearer',
        });
      }
      const account = refreshTokens.get(form.get('refresh_token') ?? '');
      if (!account) return json({ error: 'invalid_grant' }, 400);
      return json({ access_token: mintTokens(account), expires_in: 3600 });
    }
    if (url.host === 'oauth2.googleapis.com' && url.pathname === '/revoke') {
      state.revoked.push(new URLSearchParams(await body(init)).get('token')!);
      return new Response(null, { status: 200 });
    }

    const auth = new Headers(init?.headers).get('authorization') ?? '';
    const account = accessTokens.get(auth.replace(/^Bearer /, ''));
    if (!account) {
      return json(
        { error: { code: 401, message: 'Invalid Credentials' } },
        401,
      );
    }
    if (state.rateLimit > 0) {
      state.rateLimit -= 1;
      return json(
        {
          error: {
            code: 403,
            message: 'Rate limit',
            errors: [{ reason: 'userRateLimitExceeded' }],
          },
        },
        403,
      );
    }

    const path = url.pathname;
    if (path === '/drive/v3/about') {
      const user = [...accounts.values()].find(
        (a) => a.permissionId === account,
      )!;
      return json({
        user: {
          permissionId: user.permissionId,
          emailAddress: user.email,
          displayName: 'User',
        },
        storageQuota: { limit: '16106127360', usage: '1048576' },
      });
    }
    if (path === '/drive/v3/files/root') return json({ id: ROOT });
    if (path === '/drive/v3/drives') return json({ drives });
    if (path === '/drive/v3/files' && method === 'GET') {
      const driveId = url.searchParams.get('driveId') ?? undefined;
      if (driveId && url.searchParams.get('corpora') !== 'drive') {
        return json({ error: { code: 400, message: 'corpora' } }, 400);
      }
      return json({
        files: queryFiles(url.searchParams.get('q')!, driveId).map(meta),
      });
    }
    if (path === '/drive/v3/files' && method === 'POST') {
      const input = JSON.parse(await body(init)) as {
        name: string;
        mimeType: string;
        parents: string[];
      };
      const parent = files.get(input.parents[0]!);
      const driveId =
        parent?.driveId ?? drives.find((d) => d.id === input.parents[0])?.id;
      return json(meta(seed({ ...input, ...(driveId ? { driveId } : {}) })));
    }
    const fileMatch = path.match(
      /^\/drive\/v3\/files\/([^/]+)(\/export|\/copy)?$/,
    );
    if (fileMatch) {
      const file = files.get(fileMatch[1]!);
      if (!file)
        return json({ error: { code: 404, message: 'File not found' } }, 404);
      if (fileMatch[2] === '/export') {
        return new Response(
          `exported:${file.name}:${url.searchParams.get('mimeType')}`,
        );
      }
      if (fileMatch[2] === '/copy') {
        const input = JSON.parse(await body(init)) as {
          name: string;
          parents: string[];
        };
        return json(
          meta(
            seed({
              ...file,
              id: newId(),
              name: input.name,
              parents: input.parents,
            }),
          ),
        );
      }
      if (method === 'DELETE') {
        files.delete(file.id);
        return new Response(null, { status: 204 });
      }
      if (method === 'PATCH') {
        const input = JSON.parse(await body(init)) as {
          name?: string;
          trashed?: boolean;
        };
        if (input.name) file.name = input.name;
        if (input.trashed !== undefined) {
          file.trashed = input.trashed;
          file.trashedTime = input.trashed ? now() : undefined;
        }
        const add = url.searchParams.get('addParents');
        const remove = url.searchParams.get('removeParents');
        if (add) {
          file.parents = [
            ...file.parents.filter((p) => !remove?.split(',').includes(p)),
            add,
          ];
        }
        return json(meta(file));
      }
      if (url.searchParams.get('alt') === 'media') {
        return new Response(file.data ?? new Uint8Array());
      }
      return json(meta(file));
    }
    const uploadMatch = path.match(
      /^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/,
    );
    if (uploadMatch) {
      const uploadId = url.searchParams.get('upload_id');
      if (uploadId && method === 'PUT') {
        const session = uploads.get(uploadId)!;
        const data = new Uint8Array(
          (init?.body as Uint8Array | undefined) ?? new Uint8Array(),
        );
        const contentType = new Headers(init?.headers).get('content-type')!;
        if (session.fileId) {
          const file = files.get(session.fileId)!;
          file.data = data;
          file.mimeType = contentType;
          file.revisions += 1;
          return json(meta(file));
        }
        const parent = files.get(session.parents![0]!);
        const driveId =
          parent?.driveId ??
          drives.find((d) => d.id === session.parents![0])?.id;
        return json(
          meta(
            seed({
              name: session.name!,
              parents: session.parents!,
              mimeType: contentType,
              data,
              ...(driveId ? { driveId } : {}),
            }),
          ),
        );
      }
      if (url.searchParams.get('uploadType') !== 'resumable') {
        return json({ error: { code: 400, message: 'uploadType' } }, 400);
      }
      const input = JSON.parse(await body(init)) as {
        name?: string;
        parents?: string[];
      };
      const id = `u${uploads.size + 1}`;
      uploads.set(
        id,
        uploadMatch[1] ? { fileId: uploadMatch[1] } : { ...input },
      );
      return new Response(null, {
        status: 200,
        headers: {
          location: `https://www.googleapis.com/upload/drive/v3/files?upload_id=${id}`,
        },
      });
    }
    return json({ error: { code: 404, message: `no route ${path}` } }, 404);
  };

  return {
    ROOT,
    files,
    drives,
    calls,
    state,
    seed,
    accessTokens,
    refreshTokens,
    fetch: fetchImpl as unknown as typeof fetch,
  };
}

type Org = Extract<ResolveOrgResult, { ok: true }>;

async function setup() {
  const google = mockGoogle();
  const root = await mkdtemp(join(tmpdir(), 'agentos-files-gdrive-'));
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
      createGoogleDriveProvider({
        fetch: google.fetch,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }),
    ]),
    runtimeEnv: {
      AGENT_OS_EXT_FILES_GOOGLE_CLIENT_ID: 'gid',
      AGENT_OS_EXT_FILES_GOOGLE_CLIENT_SECRET: 'gsecret',
      AGENT_OS_GLOBAL_APP_ORIGIN: 'https://app.example.com',
    },
    oauthFetch: google.fetch,
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

  /** Run connect + callback as the current user; returns the redirect. */
  async function connect(code = 'code-a', mountId?: string) {
    const start = await call('/personal-mounts/google-drive/connect', {
      method: 'POST',
      body: JSON.stringify(mountId ? { mountId } : {}),
    });
    expect(start.status).toBe(200);
    const { url } = (await start.json()) as { url: string };
    const authorize = new URL(url);
    const res = await call(
      `/personal-mounts/google-drive/callback?code=${code}&state=${encodeURIComponent(authorize.searchParams.get('state')!)}`,
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

  return {
    google,
    ctx,
    call,
    as,
    connect,
    mountId,
    tokens,
    mounts,
    sleeps,
    index,
  };
}

const put = (text: string, contentType = 'text/plain') => ({
  method: 'PUT',
  body: text,
  headers: { 'content-type': contentType },
});

describe('Google Drive personal mounts', () => {
  test('disambiguated names round-trip', () => {
    const tagged = disambiguatedName('report.pdf', 'abc123DEF456');
    expect(tagged).toBe('report [abc123DEF456].pdf');
    expect(parseDisambiguated(tagged)).toEqual({
      name: 'report.pdf',
      id: 'abc123DEF456',
    });
    expect(disambiguatedName('a/b', 'abc123DEF456')).toBe('a_b [abc123DEF456]');
    expect(parseDisambiguated('plain.txt')).toBeNull();
  });

  test('connect: least-privilege flow, tokens in the user vault, owner-only visibility', async () => {
    const { call, as, connect, tokens, google } = await setup();
    const { authorize, location } = await connect();
    expect(authorize.origin + authorize.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(authorize.searchParams.get('client_id')).toBe('gid');
    expect(authorize.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/drive',
    );
    expect(authorize.searchParams.get('access_type')).toBe('offline');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/api/ext/files/personal-mounts/google-drive/callback',
    );
    expect(location).toBe('/?files_drive=connected');

    const listA = (await (await call('/mounts?usage=1')).json()) as {
      mounts: Array<Record<string, unknown>>;
      providers: Array<Record<string, unknown>>;
    };
    const drive = listA.mounts.find((m) => m.kind === 'personal')!;
    expect(drive).toMatchObject({
      provider: 'google-drive',
      ownerUserId: 'u_a',
      name: 'Google Drive (a@example.com)',
      status: 'connected',
      indexMode: 'live',
      quota: { usedBytes: 1048576, limitBytes: 16106127360 },
    });
    expect(drive.config).toEqual({
      accountId: 'perm-a',
      email: 'a@example.com',
    });
    expect(JSON.stringify(drive)).not.toContain('rt-');
    expect(listA.providers.find((p) => p.id === 'google-drive')).toMatchObject({
      personal: true,
      orgAddable: false,
      connectable: true,
    });
    const stored = await tokens.get(ORG, 'u_a', drive.id as string);
    expect(stored?.refreshToken).toStartWith('rt-perm-a');

    // Another member, an admin, and background callers never see it.
    as({ userId: 'u_admin' });
    const listB = (await (await call('/mounts')).json()) as {
      mounts: Array<{ kind: string }>;
    };
    expect(listB.mounts.some((m) => m.kind === 'personal')).toBe(false);
    expect((await call(`/blobs?mount=${drive.id}&prefix=`)).status).toBe(404);
    expect(
      (await call(`/mounts/${drive.id}`, { method: 'DELETE' })).status,
    ).toBe(404);
    as({ via: 'header', userId: undefined });
    expect((await call(`/blobs?mount=${drive.id}`)).status).toBe(404);

    // An AI run acting for the owner may read but not write.
    as({ via: 'header', userId: 'u_a' });
    expect((await call(`/blobs?mount=${drive.id}`)).status).toBe(200);
    expect(
      (await call(`/blobs/My Drive/x.txt?mount=${drive.id}`, put('x'))).status,
    ).toBe(403);
    expect(google.calls.some((c) => c.includes('/upload/'))).toBe(false);
  });

  test('callback must be finished by the user who started it', async () => {
    const { call, as } = await setup();
    const start = await call('/personal-mounts/google-drive/connect', {
      method: 'POST',
      body: '{}',
    });
    const state = new URL(
      ((await start.json()) as { url: string }).url,
    ).searchParams.get('state')!;
    as({ userId: 'u_b' });
    const res = await call(
      `/personal-mounts/google-drive/callback?code=code-a&state=${encodeURIComponent(state)}`,
    );
    expect(res.headers.get('location')).toContain('files_drive=error');
    const bogus = await call(
      '/personal-mounts/google-drive/callback?code=code-a&state=forged.sig',
    );
    expect(bogus.headers.get('location')).toContain('files_drive=error');
    const denied = await call(
      `/personal-mounts/google-drive/callback?error=access_denied&state=${encodeURIComponent(state)}`,
    );
    expect(
      new URL(denied.headers.get('location')!, BASE).searchParams.get(
        'files_drive_message',
      ),
    ).toBe('Google Drive access was not granted.');
  });

  test('browse My Drive / Shared drives, upload, overwrite as a revision, download', async () => {
    const { call, connect, mountId, google } = await setup();
    await connect();
    const id = await mountId();
    const q = `mount=${id}`;

    const top = (await (await call(`/blobs?${q}&prefix=`)).json()) as {
      items: Array<{ name: string; kind: string }>;
    };
    expect(top.items.map((i) => `${i.kind}:${i.name}`)).toEqual([
      'folder:My Drive',
      'folder:Shared drives',
    ]);

    expect(
      (await call(`/blobs/My Drive/Reports/q1.txt?${q}`, put('v1'))).status,
    ).toBe(200);
    const reports = [...google.files.values()].find(
      (f) => f.name === 'Reports',
    )!;
    expect(reports.mimeType).toBe(FOLDER);
    expect(
      (await call(`/blobs/My Drive/Reports/q1.txt?${q}`, put('v2'))).status,
    ).toBe(200);
    const q1 = [...google.files.values()].filter((f) => f.name === 'q1.txt');
    expect(q1).toHaveLength(1);
    expect(q1[0]!.revisions).toBe(2);

    const listed = (await (
      await call(
        `/blobs?${q}&prefix=${encodeURIComponent('My Drive/Reports/')}`,
      )
    ).json()) as { items: Array<Record<string, unknown>> };
    expect(listed.items[0]).toMatchObject({
      name: 'q1.txt',
      kind: 'file',
      bytes: 2,
      contentType: 'text/plain',
      relativeKey: 'My Drive/Reports/q1.txt',
      ref: `files://${id}/My Drive/Reports/q1.txt`,
    });
    expect(
      await (await call(`/blobs/My Drive/Reports/q1.txt?${q}`)).text(),
    ).toBe('v2');

    const shared = (await (
      await call(`/blobs?${q}&prefix=${encodeURIComponent('Shared drives/')}`)
    ).json()) as { items: Array<{ name: string }> };
    expect(shared.items.map((i) => i.name)).toEqual(['Team']);
    expect(
      (await call(`/blobs/Shared drives/Team/notes.txt?${q}`, put('team')))
        .status,
    ).toBe(200);
    const notes = [...google.files.values()].find(
      (f) => f.name === 'notes.txt',
    )!;
    expect(notes.driveId).toBe('drive0000000001');
    expect(
      await (await call(`/blobs/Shared drives/Team/notes.txt?${q}`)).text(),
    ).toBe('team');
    expect(
      (await call(`/blobs/Shared drives/loose.txt?${q}`, put('x'))).status,
    ).toBe(400);
  });

  test('duplicate names are disambiguated in listings and addressed by id', async () => {
    const { call, connect, mountId, google } = await setup();
    await connect();
    const id = await mountId();
    const enc = new TextEncoder();
    const one = google.seed({ name: 'dup.txt', data: enc.encode('one') });
    const two = google.seed({ name: 'dup.txt', data: enc.encode('two') });

    const listed = (await (
      await call(`/blobs?mount=${id}&prefix=${encodeURIComponent('My Drive/')}`)
    ).json()) as { items: Array<{ name: string; relativeKey: string }> };
    const names = listed.items.map((i) => i.name).sort();
    expect(names).toEqual(
      [`dup [${one.id}].txt`, `dup [${two.id}].txt`].sort(),
    );
    expect(
      await (
        await call(`/blobs/My Drive/dup [${two.id}].txt?mount=${id}`)
      ).text(),
    ).toBe('two');
    const ambiguous = await call(`/blobs/My Drive/dup.txt?mount=${id}`);
    expect(ambiguous.status).toBe(409);
  });

  test('Google Docs list with exports, download as DOCX / PDF, copy to org storage exports bytes', async () => {
    const { call, connect, mountId, google, index } = await setup();
    await connect();
    const id = await mountId();
    google.seed({ name: 'Plan', mimeType: GDOC });

    const listed = (await (
      await call(`/blobs?mount=${id}&prefix=${encodeURIComponent('My Drive/')}`)
    ).json()) as { items: Array<Record<string, unknown>> };
    expect(listed.items[0]).toMatchObject({
      name: 'Plan',
      contentType: GDOC,
      exportFormats: ['docx', 'pdf'],
    });
    expect(String(listed.items[0]!.webUrl)).toStartWith(
      'https://drive.google.com/',
    );

    const docx = (await (
      await call(`/blobs/My Drive/Plan?mount=${id}&format=json`)
    ).json()) as { name: string; contentType: string; base64: string };
    expect(docx.name).toBe('Plan.docx');
    expect(docx.contentType).toBe(DOCX);
    const pdf = await call(`/blobs/My Drive/Plan?mount=${id}&export=pdf`);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.headers.get('content-disposition')).toContain('Plan.pdf');
    expect(
      (await call(`/blobs/My Drive/Plan?mount=${id}&export=xlsx`)).status,
    ).toBe(400);

    const copy = await call('/blobs/copy', {
      method: 'POST',
      body: JSON.stringify({
        from: 'My Drive/Plan',
        fromMount: id,
        to: 'imports/Plan',
        toMount: 'platform',
      }),
    });
    expect(copy.status).toBe(200);
    expect(((await copy.json()) as { toRef: string }).toRef).toBe(
      'files://platform/imports/Plan.docx',
    );
    expect(await (await call('/blobs/imports/Plan.docx')).text()).toBe(
      `exported:Plan:${DOCX}`,
    );
    const records = await index.listByPrefix(ORG, '', 1000);
    expect(records.some((r) => r.mountId === id || r.key.includes(id))).toBe(
      false,
    );
  });

  test('delete goes to Drive trash; restore from Bin; copy and move stay server-side', async () => {
    const { call, connect, mountId, google } = await setup();
    await connect();
    const id = await mountId();
    const q = `mount=${id}`;
    await call(`/blobs/My Drive/a.txt?${q}`, put('a'));

    const copied = await call('/blobs/copy', {
      method: 'POST',
      body: JSON.stringify({
        from: 'My Drive/a.txt',
        to: 'My Drive/b.txt',
        mount: id,
      }),
    });
    expect(copied.status).toBe(200);
    const moved = await call('/blobs/move', {
      method: 'POST',
      body: JSON.stringify({
        from: 'My Drive/b.txt',
        to: 'My Drive/Archive/b.txt',
        mount: id,
      }),
    });
    expect(moved.status).toBe(200);
    expect(google.calls.filter((c) => c.includes('/upload/'))).toHaveLength(2);
    expect(
      await (await call(`/blobs/My Drive/Archive/b.txt?${q}`)).text(),
    ).toBe('a');

    const del = await call(`/blobs/My Drive/a.txt?${q}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const a = [...google.files.values()].find((f) => f.name === 'a.txt')!;
    expect(a.trashed).toBe(true);

    const bin = (await (await call(`/blobs?view=bin&${q}`)).json()) as {
      items: Array<{ name: string; relativeKey: string }>;
    };
    expect(bin.items.map((i) => i.name)).toEqual(['a.txt']);
    const restored = await call('/blobs/restore', {
      method: 'POST',
      body: JSON.stringify({ key: bin.items[0]!.relativeKey, mountId: id }),
    });
    expect(
      ((await restored.json()) as { relativeKey: string }).relativeKey,
    ).toBe('My Drive/a.txt');
    expect(a.trashed).toBe(false);
  });

  test('rate limits back off and retry', async () => {
    const { call, connect, mountId, google, sleeps } = await setup();
    await connect();
    const id = await mountId();
    google.state.rateLimit = 2;
    const res = await call(
      `/blobs?mount=${id}&prefix=${encodeURIComponent('My Drive/')}`,
    );
    expect(res.status).toBe(200);
    expect(sleeps).toEqual([500, 1000]);
  });

  test('expired access token refreshes; revoked token asks to reconnect with the same account', async () => {
    const { call, connect, mountId, tokens, google } = await setup();
    await connect();
    const id = await mountId();
    const stored = (await tokens.get(ORG, 'u_a', id))!;
    await tokens.put(ORG, 'u_a', id, {
      ...stored,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    google.state.rateLimit = 0;
    expect((await call(`/blobs?mount=${id}&prefix=My Drive/`)).status).toBe(
      200,
    );
    const refreshed = (await tokens.get(ORG, 'u_a', id))!;
    expect(refreshed.accessToken).not.toBe(stored.accessToken);
    expect(refreshed.refreshToken).toBe(stored.refreshToken);

    // Revoked at Google: access token rejected, refresh → invalid_grant.
    google.accessTokens.clear();
    google.refreshTokens.clear();
    await call(`/blobs/My Drive/new.txt?mount=${id}`, put('x'));
    const failed = await call(`/blobs?mount=${id}&prefix=My Drive/Other/`);
    expect(failed.status).toBe(409);
    expect(((await failed.json()) as { code: string }).code).toBe(
      'reconnect_required',
    );
    const list = (await (await call('/mounts')).json()) as {
      mounts: Array<{ id: string; status: string; statusMessage?: string }>;
    };
    const mount = list.mounts.find((m) => m.id === id)!;
    expect(mount.status).toBe('disconnected');
    expect(mount.statusMessage).toContain('reconnect');

    const wrong = await connect('code-other', id);
    expect(decodeURIComponent(wrong.location)).toContain('a@example.com');
    const again = await connect('code-a2', id);
    expect(again.location).toBe('/?files_drive=connected');
    const after = (await (await call('/mounts')).json()) as {
      mounts: Array<{ id: string; status: string; kind: string }>;
    };
    expect(after.mounts.filter((m) => m.kind === 'personal')).toHaveLength(1);
    expect(after.mounts.find((m) => m.id === id)!.status).toBe('connected');
    expect((await call(`/blobs?mount=${id}&prefix=My Drive/`)).status).toBe(
      200,
    );
  });

  test('disconnect revokes and forgets; member purge drops their mounts', async () => {
    const { call, as, connect, mountId, tokens, google, ctx, mounts } =
      await setup();
    await connect();
    const id = await mountId();
    const res = await call(`/mounts/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(google.state.revoked).toHaveLength(1);
    expect(await tokens.get(ORG, 'u_a', id)).toBeUndefined();
    expect(await mounts.list(ORG)).toHaveLength(0);

    await connect();
    as({ userId: 'u_b' });
    await connect('code-other');
    expect(await purgeUserMounts(ctx, ORG, 'u_a')).toBe(1);
    const left = await mounts.list(ORG);
    expect(left.map((m) => m.ownerUserId)).toEqual(['u_b']);
  });

  test('connect is disabled without the platform OAuth app', async () => {
    const { call, ctx } = await setup();
    ctx.runtimeEnv = {};
    const res = await call('/personal-mounts/google-drive/connect', {
      method: 'POST',
      body: '{}',
    });
    expect(res.status).toBe(503);
    const list = (await (await call('/mounts')).json()) as {
      providers: Array<{ id: string; connectable?: boolean }>;
    };
    expect(
      list.providers.find((p) => p.id === 'google-drive')?.connectable,
    ).toBe(false);
  });
});
