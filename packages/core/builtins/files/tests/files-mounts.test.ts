import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  formatFileRef,
  parseFileRef,
  toFileRef,
} from '@agentos/core/api/files-ref';
import { createBlobStore } from '@agentos/core/builtins/files/api/lib/blob-store';
import {
  handleFilesRequest,
  type FilesContext,
} from '@agentos/core/builtins/files/api/lib/handle-request';
import { createMemoryStorageAdapter } from '@agentos/core/builtins/files/api/lib/memory-adapter';
import {
  createIntegrationsKit,
  createMemoryIntegrationsBackend,
} from '@agentos/core/api/integrations';
import {
  createIntegrationsMountStore,
  createMemoryMountStore,
  type FilesMountStore,
} from '@agentos/core/builtins/files/api/lib/mount-store';
import type { ResolveOrgResult } from '@agentos/core/builtins/files/api/lib/resolve-org';
import { createMemoryObjectIndex } from '@agentos/core/builtins/files/api/lib/object-index';
import { createMemoryOrgSettingsStore } from '@agentos/core/builtins/files/api/lib/org-settings';
import { createStorageProviderRegistry } from '@agentos/core/builtins/files/api/lib/storage-providers';
import type { StorageAdapter } from '@agentos/core/builtins/files/api/lib/types';

const ORG = 'org_m';
const BASE = 'http://127.0.0.1:6116';

type Adapters = Map<string, StorageAdapter>;

async function setup(
  options: {
    org?: Extract<ResolveOrgResult, { ok: true }>;
    adapterFor?: (mountId: string) => StorageAdapter;
    mountStore?: FilesMountStore;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'agentos-files-mounts-'));
  const platform = await createBlobStore(root);
  const adapters: Adapters = new Map();
  const createdWith: Array<Record<string, string>> = [];
  const providers = createStorageProviderRegistry([
    {
      id: 'memory',
      label: 'Memory',
      orgAddable: true,
      locationFields: ['bucket'],
      secretFields: ['secretKey'],
      create(mount, providerCtx) {
        createdWith.push(providerCtx.secrets);
        let adapter = adapters.get(mount.id);
        if (!adapter) {
          adapter =
            options.adapterFor?.(mount.id) ?? createMemoryStorageAdapter();
          adapters.set(mount.id, adapter);
        }
        return adapter;
      },
    },
  ]);
  let org: Extract<ResolveOrgResult, { ok: true }> = options.org ?? {
    ok: true,
    orgId: ORG,
    via: 'session',
    userId: 'u_owner',
  };
  const ctx: FilesContext = {
    store: platform,
    index: createMemoryObjectIndex(),
    settings: createMemoryOrgSettingsStore(),
    mounts: options.mountStore ?? createMemoryMountStore(),
    providers,
    resolveOrg: async () => org,
    checkPermission: async () => 'ok',
  };
  const call = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (
      typeof init.body === 'string' &&
      init.body.startsWith('{') &&
      !headers.has('content-type')
    ) {
      headers.set('content-type', 'application/json');
    }
    return handleFilesRequest(
      ctx,
      new Request(`${BASE}${path}`, { ...init, headers }),
    );
  };
  const setOrg = (next: Extract<ResolveOrgResult, { ok: true }>) => {
    org = next;
  };
  return { ctx, call, adapters, platform, setOrg, createdWith };
}

async function addMount(
  call: Awaited<ReturnType<typeof setup>>['call'],
  name = 'Archive',
  config: Record<string, unknown> = { bucket: 'b1' },
): Promise<string> {
  const res = await call('/mounts', {
    method: 'POST',
    body: JSON.stringify({ provider: 'memory', name, config }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { mount: { id: string } };
  return body.mount.id;
}

function putText(text: string, contentType = 'text/plain'): RequestInit {
  return {
    method: 'PUT',
    body: JSON.stringify({ base64: btoa(text), contentType }),
  };
}

describe('files refs', () => {
  test('format / parse / legacy conversion', () => {
    expect(formatFileRef('platform', 'a/b.txt')).toBe(
      'files://platform/a/b.txt',
    );
    expect(parseFileRef('files://m_1/x/y.pdf')).toEqual({
      mountId: 'm_1',
      path: 'x/y.pdf',
    });
    expect(parseFileRef('orgs/o/a.txt')).toBeNull();
    expect(parseFileRef('files://bad id/x')).toBeNull();
    expect(toFileRef('orgs/o1/docs/a.txt', 'o1')).toBe(
      'files://platform/docs/a.txt',
    );
    expect(toFileRef('orgs/o1/docs/a.txt')).toBe('files://platform/docs/a.txt');
    expect(toFileRef('docs/a.txt')).toBe('files://platform/docs/a.txt');
  });
});

describe('files mounts', () => {
  test('platform mount is built in and default; legacy keys keep working', async () => {
    const { ctx, call } = await setup();

    const mounts = await call('/mounts');
    expect(mounts.status).toBe(200);
    const listed = (await mounts.json()) as {
      mounts: Array<{
        id: string;
        isDefault: boolean;
        builtin?: boolean;
        capabilities?: { nativeTrash: boolean };
        indexMode?: string;
      }>;
      defaultMountId: string;
      canManage: boolean;
    };
    expect(listed.defaultMountId).toBe('platform');
    expect(listed.mounts).toHaveLength(1);
    expect(listed.mounts[0]).toMatchObject({
      id: 'platform',
      isDefault: true,
      builtin: true,
      indexMode: 'indexed',
    });
    expect(listed.mounts[0]!.capabilities?.nativeTrash).toBe(false);
    expect(listed.canManage).toBe(true);

    const put = await call('/blobs/notes/a.txt', putText('hi'));
    const putBody = (await put.json()) as {
      key: string;
      ref: string;
      mountId: string;
    };
    expect(putBody.key).toBe(`orgs/${ORG}/notes/a.txt`);
    expect(putBody.ref).toBe('files://platform/notes/a.txt');
    expect(putBody.mountId).toBe('platform');

    // Pre-mount index record without mountId → backfilled on read.
    await ctx.index!.put(ORG, {
      key: `orgs/${ORG}/legacy.txt`,
      name: 'legacy.txt',
      bytes: 3,
      contentType: 'text/csv',
      updatedAt: new Date(0).toISOString(),
    });
    await call('/blobs/legacy.txt', { method: 'PUT', body: 'old' });
    await ctx.index!.put(ORG, {
      key: `orgs/${ORG}/legacy.txt`,
      name: 'legacy.txt',
      bytes: 3,
      contentType: 'text/csv',
      updatedAt: new Date(0).toISOString(),
    });

    for (const key of [
      `orgs/${ORG}/legacy.txt`,
      'legacy.txt',
      'files://platform/legacy.txt',
    ]) {
      const res = await call(`/blobs/${encodeURIComponent(key)}?format=json`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ref: string; contentType: string };
      expect(body.ref).toBe('files://platform/legacy.txt');
      expect(body.contentType).toBe('text/csv');
    }
    const record = await ctx.index!.get(ORG, `orgs/${ORG}/legacy.txt`);
    expect(record?.mountId).toBe('platform');

    const list = await call('/blobs?prefix=notes/');
    const items = (
      (await list.json()) as {
        items: Array<{ ref: string; mountId: string }>;
      }
    ).items;
    expect(items[0]).toMatchObject({
      ref: 'files://platform/notes/a.txt',
      mountId: 'platform',
    });

    const removePlatform = await call('/mounts/platform', { method: 'DELETE' });
    expect(removePlatform.status).toBe(400);
  });

  test('org mount: add, browse by ref, set default, cross-mount copy + move', async () => {
    const { call, adapters } = await setup();
    const unknown = await call('/mounts', {
      method: 'POST',
      body: JSON.stringify({ provider: 'nope', name: 'X' }),
    });
    expect(unknown.status).toBe(400);

    const id = await addMount(call);
    const adapter = adapters.get(id)!;

    const put = await call(
      `/blobs/${encodeURIComponent(`files://${id}/reports/q1.txt`)}`,
      putText('q1'),
    );
    expect(put.status).toBe(200);
    expect(((await put.json()) as { ref: string }).ref).toBe(
      `files://${id}/reports/q1.txt`,
    );
    expect(await adapter.get('reports/q1.txt')).not.toBeNull();

    const listed = await call(`/blobs?mount=${id}&prefix=reports/`);
    const listItems = (
      (await listed.json()) as {
        items: Array<{ name: string; mountId: string }>;
      }
    ).items;
    expect(listItems).toEqual([
      expect.objectContaining({ name: 'q1.txt', mountId: id }),
    ]);

    // Default upload target follows the org default.
    const setDefault = await call(`/mounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isDefault: true }),
    });
    expect(setDefault.status).toBe(200);
    const viaDefault = await call('/blobs/inbox/a.txt?mount=default', {
      method: 'PUT',
      body: 'x',
    });
    expect(((await viaDefault.json()) as { mountId: string }).mountId).toBe(id);
    // Legacy keys (no mount) still resolve to platform.
    const legacy = await call('/blobs/inbox/b.txt', {
      method: 'PUT',
      body: 'y',
    });
    expect(((await legacy.json()) as { mountId: string }).mountId).toBe(
      'platform',
    );

    const copy = await call('/blobs/copy', {
      method: 'POST',
      body: JSON.stringify({
        from: `files://${id}/reports/q1.txt`,
        to: 'files://platform/copies/q1.txt',
      }),
    });
    expect(copy.status).toBe(200);
    expect(((await copy.json()) as { toRef: string }).toRef).toBe(
      'files://platform/copies/q1.txt',
    );
    const copied = await call('/blobs/copies/q1.txt');
    expect(await copied.text()).toBe('q1');
    expect(await adapter.get('reports/q1.txt')).not.toBeNull();

    const move = await call('/blobs/move', {
      method: 'POST',
      body: JSON.stringify({
        from: 'copies/',
        to: 'moved/',
        fromMount: 'platform',
        toMount: id,
      }),
    });
    expect(move.status).toBe(200);
    expect(((await move.json()) as { refs: string[] }).refs).toEqual([
      `files://${id}/moved/q1.txt`,
    ]);
    expect((await call('/blobs/copies/q1.txt')).status).toBe(404);
    expect(await adapter.get('moved/q1.txt')).not.toBeNull();

    const mounts = (await (await call('/mounts?usage=1')).json()) as {
      mounts: Array<{
        id: string;
        isDefault: boolean;
        usage?: { files: number };
      }>;
      defaultMountId: string;
    };
    expect(mounts.defaultMountId).toBe(id);
    expect(mounts.mounts.find((m) => m.id === 'platform')?.isDefault).toBe(
      false,
    );
    expect(mounts.mounts.find((m) => m.id === id)?.usage?.files).toBe(3);
  });

  test('cross-mount copy enforces destination max file size', async () => {
    const { call } = await setup({
      adapterFor: () =>
        createMemoryStorageAdapter({ capabilities: { maxFileSize: 2 } }),
    });
    const id = await addMount(call, 'Tiny');
    await call('/blobs/big.txt', { method: 'PUT', body: 'too big' });
    const res = await call('/blobs/copy', {
      method: 'POST',
      body: JSON.stringify({ from: 'big.txt', to: `files://${id}/big.txt` }),
    });
    expect(res.status).toBe(413);
  });

  test('removal is guarded by reference count; location change blocked', async () => {
    const { call } = await setup();
    const id = await addMount(call);
    await call(`/blobs/a.txt?mount=${id}`, { method: 'PUT', body: 'a' });
    await call(`/blobs/b.txt?mount=${id}`, { method: 'PUT', body: 'b' });

    const blocked = await call(`/mounts/${id}`, { method: 'DELETE' });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { references: number }).references).toBe(
      2,
    );

    const relocate = await call(`/mounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ config: { bucket: 'b2' } }),
    });
    expect(relocate.status).toBe(409);

    const rename = await call(`/mounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect(
      ((await rename.json()) as { mount: { name: string } }).mount.name,
    ).toBe('Renamed');

    // Bin items still reference the mount until purged.
    await call(`/blobs/a.txt?mount=${id}`, { method: 'DELETE' });
    await call(`/blobs/b.txt?mount=${id}`, { method: 'DELETE' });
    const stillBlocked = await call(`/mounts/${id}`, { method: 'DELETE' });
    expect(stillBlocked.status).toBe(409);

    await call(`/blobs?mount=${id}&prefix=__trash__/`, { method: 'DELETE' });
    const removed = await call(`/mounts/${id}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    const after = (await (await call('/mounts')).json()) as {
      mounts: Array<{ id: string }>;
    };
    expect(after.mounts.map((m) => m.id)).toEqual(['platform']);
  });

  test('personal mounts: owner-only visibility; background writes only to org mounts', async () => {
    const { ctx, call, setOrg } = await setup();
    await ctx.mounts!.put(ORG, {
      id: 'p_drive',
      kind: 'personal',
      ownerUserId: 'u_owner',
      provider: 'memory',
      name: 'My drive',
      isDefault: false,
      status: 'connected',
    });

    const ownerView = (await (await call('/mounts')).json()) as {
      mounts: Array<{ id: string }>;
    };
    expect(ownerView.mounts.map((m) => m.id)).toContain('p_drive');
    const ownerPut = await call('/blobs/x.txt?mount=p_drive', {
      method: 'PUT',
      body: 'mine',
    });
    expect(ownerPut.status).toBe(200);

    const cannotDefault = await call('/mounts/p_drive', {
      method: 'PATCH',
      body: JSON.stringify({ isDefault: true }),
    });
    expect(cannotDefault.status).toBe(400);

    setOrg({ ok: true, orgId: ORG, via: 'session', userId: 'u_other' });
    const otherView = (await (await call('/mounts')).json()) as {
      mounts: Array<{ id: string }>;
    };
    expect(otherView.mounts.map((m) => m.id)).not.toContain('p_drive');
    expect((await call('/blobs/x.txt?mount=p_drive')).status).toBe(404);

    setOrg({ ok: true, orgId: ORG, via: 'header', userId: 'u_owner' });
    const background = await call('/blobs/y.txt?mount=p_drive', {
      method: 'PUT',
      body: 'bg',
    });
    expect(background.status).toBe(403);
    const backgroundDefault = await call('/blobs/y.txt?mount=default', {
      method: 'PUT',
      body: 'bg',
    });
    expect(backgroundDefault.status).toBe(200);
    expect(
      ((await backgroundDefault.json()) as { mountId: string }).mountId,
    ).toBe('platform');
  });

  test('native trash capability routes bin through the provider', async () => {
    const { call, adapters } = await setup({
      adapterFor: () =>
        createMemoryStorageAdapter({
          capabilities: { nativeTrash: true },
          indexMode: 'live',
        }),
    });
    const id = await addMount(call, 'Drive');
    await call(`/blobs/doc.txt?mount=${id}`, { method: 'PUT', body: 'd' });
    const del = await call(`/blobs/doc.txt?mount=${id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(await adapters.get(id)!.get('doc.txt')).toBeNull();

    const bin = (await (await call('/blobs?view=bin')).json()) as {
      items: Array<{
        relativeKey: string;
        mountId: string;
        mountName?: string;
        originalKey?: string;
      }>;
    };
    const item = bin.items.find((i) => i.mountId === id)!;
    expect(item.originalKey).toBe('doc.txt');
    expect(item.mountName).toBe('Drive');

    const restore = await call('/blobs/restore', {
      method: 'POST',
      body: JSON.stringify({ key: item.relativeKey, mountId: id }),
    });
    expect(restore.status).toBe(200);
    expect(await adapters.get(id)!.get('doc.txt')).not.toBeNull();
  });

  test('live index mode caches listings and invalidates on write', async () => {
    const live = createMemoryStorageAdapter({ indexMode: 'live' });
    const { call } = await setup({ adapterFor: () => live });
    const id = await addMount(call, 'Live');
    const before = live.listCalls;
    await call(`/blobs?mount=${id}`);
    await call(`/blobs?mount=${id}`);
    expect(live.listCalls - before).toBe(1);
    await call(`/blobs/n.txt?mount=${id}`, { method: 'PUT', body: 'n' });
    const after = (await (await call(`/blobs?mount=${id}`)).json()) as {
      items: Array<{ name: string }>;
    };
    expect(after.items.map((i) => i.name)).toContain('n.txt');
  });

  test('org mounts persist as files.mount integrations; secrets stay in the vault', async () => {
    const backend = createMemoryIntegrationsBackend();
    const kit = createIntegrationsKit(backend);
    const { call, createdWith } = await setup({
      mountStore: createIntegrationsMountStore(kit),
    });

    const res = await call('/mounts', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'memory',
        name: 'Vaulted',
        config: { bucket: 'b1', secretKey: 'sk_live_1' },
      }),
    });
    expect(res.status).toBe(201);
    const { mount } = (await res.json()) as {
      mount: { id: string; config: Record<string, unknown> };
    };
    expect(mount.config).toEqual({ bucket: 'b1' });
    expect(createdWith.at(-1)).toEqual({ secretKey: 'sk_live_1' });

    const record =
      backend.records.get(`${ORG}:files.mount:${mount.id}`) ??
      [...backend.records.values()].find((r) => r.instanceId === mount.id);
    expect(record?.integration).toBe('files.mount');
    expect(record?.provider).toBe('memory');
    expect(JSON.stringify(record?.settings)).not.toContain('sk_live_1');
    expect([...backend.vault.values()]).toContain('sk_live_1');

    const renamed = await call(`/mounts/${mount.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Vaulted 2' }),
    });
    expect(renamed.status).toBe(200);
    expect([...backend.vault.values()]).toContain('sk_live_1');

    const rotated = await call(`/mounts/${mount.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ secrets: { secretKey: 'sk_live_2' } }),
    });
    expect(rotated.status).toBe(200);
    expect([...backend.vault.values()]).toContain('sk_live_2');
    const listed = (await (await call('/mounts?usage=1')).json()) as {
      mounts: Array<{ id: string; name: string }>;
    };
    expect(listed.mounts.find((m) => m.id === mount.id)?.name).toBe(
      'Vaulted 2',
    );
    expect(createdWith.at(-1)).toEqual({ secretKey: 'sk_live_2' });

    const removed = await call(`/mounts/${mount.id}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(backend.vault.size).toBe(0);
    expect(
      [...backend.records.values()].some((r) => r.instanceId === mount.id),
    ).toBe(false);
  });
});
