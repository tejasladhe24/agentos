import { BlobStoreError } from './blob-store-error';
import {
  GRAPH_API,
  GRAPH_ORIGIN,
  graphError,
  type GraphClient,
} from './microsoft-graph-client';
import type {
  BlobListObject,
  BlobListResult,
  NativeTrashObject,
  StorageAdapter,
  StorageStat,
} from './types';

export const ONEDRIVE = 'OneDrive';
export const SHAREPOINT = 'SharePoint';

/** Graph simple upload limit; larger files use an upload session. */
export const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;
/** Upload session chunks must be multiples of 320 KiB. */
export const UPLOAD_CHUNK_BYTES = 320 * 1024 * 10;
/** Largest file OneDrive / SharePoint accept. */
const GRAPH_MAX_FILE_BYTES = 250 * 1024 ** 3;
const ITEM_SELECT =
  'id,name,size,file,folder,package,remoteItem,lastModifiedDateTime,webUrl,parentReference';
const PATH_CACHE_MS = 30_000;
const MAX_WALK_ITEMS = 2_000;
const COPY_POLLS = 30;

export type GraphItem = {
  id: string;
  name: string;
  size?: number;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  package?: { type?: string };
  remoteItem?: unknown;
  lastModifiedDateTime?: string;
  webUrl?: string;
  parentReference?: { driveId?: string; id?: string; path?: string };
};

type Site = {
  id: string;
  displayName?: string;
  name?: string;
  webUrl?: string;
};
type Library = { id: string; name: string };
type Located = { driveId: string; item: GraphItem };
/** Folder plus its path inside the drive. */
type Folder = Located & { rest: string[] };
type Named<T> = { label: string; value: T };

function splitKey(key: string): string[] {
  return key.split('/').filter(Boolean);
}

function encodePath(segments: string[]): string {
  return segments.map(encodeURIComponent).join('/');
}

function isFolder(item: GraphItem): boolean {
  return Boolean(item.folder);
}

/** Shortcuts to shared items and OneNote notebooks are not plain files. */
function isListable(item: GraphItem): boolean {
  return !item.remoteItem && !item.package;
}

function isTrashKey(segments: string[]): boolean {
  return (
    segments.length > 0 &&
    segments[0] !== ONEDRIVE &&
    segments[0] !== SHAREPOINT
  );
}

function describe(item: GraphItem): StorageStat {
  const out: StorageStat = {};
  if (item.size !== undefined) out.bytes = item.size;
  if (item.lastModifiedDateTime) out.updatedAt = item.lastModifiedDateTime;
  if (item.file?.mimeType) out.contentType = item.file.mimeType;
  if (item.webUrl) out.webUrl = item.webUrl;
  return out;
}

/** Folder-safe, unique labels (sites and libraries may share display names). */
function uniqueLabels<T>(
  items: T[],
  label: (item: T) => string,
  hint: (item: T) => string,
): Named<T>[] {
  const safe = (raw: string) => raw.replace(/[/\\]/g, '_').trim() || '_';
  const counts = new Map<string, number>();
  for (const item of items) {
    const name = safe(label(item));
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const used = new Set<string>();
  return items.map((item) => {
    const base = safe(label(item));
    let name = counts.get(base) === 1 ? base : `${base} (${safe(hint(item))})`;
    for (let n = 2; used.has(name); n += 1) name = `${base} (${n})`;
    used.add(name);
    return { label: name, value: item };
  });
}

function siteHint(site: Site): string {
  try {
    const path = new URL(site.webUrl ?? '').pathname.split('/').filter(Boolean);
    return path.at(-1) ?? site.id;
  } catch {
    return site.id;
  }
}

/** Only Graph `@odata.nextLink`s may come back as cursors (they get the token). */
function graphCursor(cursor: string): string {
  let url: URL;
  try {
    url = new URL(cursor);
  } catch {
    throw new BlobStoreError('invalid cursor', 400);
  }
  if (url.origin !== GRAPH_ORIGIN || !url.pathname.startsWith('/v1.0/')) {
    throw new BlobStoreError('invalid cursor', 400);
  }
  return url.toString();
}

export type OneDriveStoreOptions = {
  graph: GraphClient;
  /** Connected account email (label only). */
  email?: string;
};

export function createOneDriveStore(
  options: OneDriveStoreOptions,
): StorageAdapter {
  const { graph } = options;
  const items = new Map<string, { located: Located | null; at: number }>();
  const libraries = new Map<string, { at: number; list: Named<Library>[] }>();
  let sites: { at: number; list: Named<Site>[] } | null = null;
  let myDriveId: Promise<string> | null = null;

  function clearCaches(): void {
    items.clear();
  }

  function fresh(at: number): boolean {
    return Date.now() - at < PATH_CACHE_MS;
  }

  function myDrive(): Promise<string> {
    myDriveId ??= graph
      .json<{ id: string }>(
        `${GRAPH_API}/me/drive?$select=id`,
        undefined,
        'read',
      )
      .then((d) => d.id)
      .catch((error) => {
        myDriveId = null;
        throw error;
      });
    return myDriveId;
  }

  async function pages<T>(url: string, op: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = url;
    while (next && out.length < MAX_WALK_ITEMS) {
      const page: { value?: T[]; '@odata.nextLink'?: string } =
        await graph.json(next, undefined, op);
      out.push(...(page.value ?? []));
      next = page['@odata.nextLink'];
    }
    return out;
  }

  async function followedSites(): Promise<Named<Site>[]> {
    if (sites && fresh(sites.at)) return sites.list;
    const list = await pages<Site>(
      `${GRAPH_API}/me/followedSites?$select=id,displayName,name,webUrl`,
      'list SharePoint sites',
    );
    const named = uniqueLabels(
      list,
      (s) => s.displayName ?? s.name ?? s.id,
      siteHint,
    );
    sites = { at: Date.now(), list: named };
    return named;
  }

  async function siteNamed(label: string): Promise<Site | null> {
    return (
      (await followedSites()).find((s) => s.label === label)?.value ?? null
    );
  }

  async function librariesOf(siteId: string): Promise<Named<Library>[]> {
    const hit = libraries.get(siteId);
    if (hit && fresh(hit.at)) return hit.list;
    const list = await pages<Library>(
      `${GRAPH_API}/sites/${encodeURIComponent(siteId)}/drives?$select=id,name`,
      'list document libraries',
    );
    const named = uniqueLabels(
      list,
      (l) => l.name,
      (l) => l.id.slice(-6),
    );
    libraries.set(siteId, { at: Date.now(), list: named });
    return named;
  }

  /** Drive id + in-drive path for a key, or a virtual level above drives. */
  async function driveOf(
    segments: string[],
  ): Promise<
    | { kind: 'root' }
    | { kind: 'sites' }
    | { kind: 'site'; site: Site }
    | { kind: 'drive'; driveId: string; rest: string[]; depth: number }
    | null
  > {
    const [top, site, library] = segments;
    if (!top) return { kind: 'root' };
    if (top === ONEDRIVE) {
      return {
        kind: 'drive',
        driveId: await myDrive(),
        rest: segments.slice(1),
        depth: 1,
      };
    }
    if (top !== SHAREPOINT) return null;
    if (!site) return { kind: 'sites' };
    const found = await siteNamed(site);
    if (!found) return null;
    if (!library) return { kind: 'site', site: found };
    const lib = (await librariesOf(found.id)).find((l) => l.label === library);
    if (!lib) return null;
    return {
      kind: 'drive',
      driveId: lib.value.id,
      rest: segments.slice(3),
      depth: 3,
    };
  }

  async function itemAt(
    driveId: string,
    rest: string[],
  ): Promise<Located | null> {
    const cacheKey = `${driveId}\n${rest.join('/')}`;
    const hit = items.get(cacheKey);
    if (hit && fresh(hit.at)) return hit.located;
    const drive = `${GRAPH_API}/drives/${encodeURIComponent(driveId)}`;
    const url = rest.length
      ? `${drive}/root:/${encodePath(rest)}?$select=${ITEM_SELECT}`
      : `${drive}/root?$select=${ITEM_SELECT}`;
    const res = await graph.request(url);
    if (res.status !== 404 && !res.ok) throw await graphError(res, 'read');
    const located =
      res.status === 404
        ? null
        : { driveId, item: (await res.json()) as GraphItem };
    items.set(cacheKey, { located, at: Date.now() });
    return located;
  }

  async function locate(key: string): Promise<Located | null> {
    const target = await driveOf(splitKey(key));
    return target?.kind === 'drive'
      ? itemAt(target.driveId, target.rest)
      : null;
  }

  async function fileAt(key: string): Promise<Located | null> {
    const found = await locate(key);
    return found && !isFolder(found.item) && isListable(found.item)
      ? found
      : null;
  }

  function itemUrl(driveId: string, itemId: string): string {
    return `${GRAPH_API}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`;
  }

  /** Writable folder for a path (`mkdir -p`) inside OneDrive or a library. */
  async function ensureFolder(segments: string[]): Promise<Folder> {
    const target = await driveOf(segments);
    if (target?.kind !== 'drive') {
      throw new BlobStoreError(
        `save into "${ONEDRIVE}" or a library under "${SHAREPOINT}/<site>/"`,
        segments[0] === SHAREPOINT && segments.length >= 3 ? 404 : 400,
      );
    }
    let folder = await itemAt(target.driveId, []);
    if (!folder) throw new BlobStoreError('drive not found', 404);
    for (let i = 0; i < target.rest.length; i += 1) {
      const path = target.rest.slice(0, i + 1);
      let next = await itemAt(target.driveId, path);
      if (next && !isFolder(next.item)) {
        throw new BlobStoreError(
          `"${path.at(-1)}" is a file, not a folder`,
          409,
        );
      }
      if (!next) {
        const res = await graph.request(
          `${itemUrl(target.driveId, folder.item.id)}/children`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              name: path.at(-1),
              folder: {},
              '@microsoft.graph.conflictBehavior': 'fail',
            }),
          },
        );
        if (res.status === 409) {
          items.delete(`${target.driveId}\n${path.join('/')}`);
          next = await itemAt(target.driveId, path);
          if (!next) throw await graphError(res, 'create folder');
        } else if (!res.ok) {
          throw await graphError(res, 'create folder');
        } else {
          next = {
            driveId: target.driveId,
            item: (await res.json()) as GraphItem,
          };
          items.set(`${target.driveId}\n${path.join('/')}`, {
            located: next,
            at: Date.now(),
          });
        }
      }
      folder = next;
    }
    return { ...folder, rest: target.rest };
  }

  async function removeItem(located: Located): Promise<void> {
    const res = await graph.request(itemUrl(located.driveId, located.item.id), {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 404) throw await graphError(res, 'delete');
  }

  async function uploadSession(
    parent: Located,
    name: string,
    bytes: Uint8Array,
  ): Promise<void> {
    const session = await graph.json<{ uploadUrl?: string }>(
      `${itemUrl(parent.driveId, parent.item.id)}:/${encodeURIComponent(name)}:/createUploadSession`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          item: { '@microsoft.graph.conflictBehavior': 'replace' },
        }),
      },
      'upload',
    );
    const uploadUrl = session.uploadUrl;
    if (!uploadUrl) {
      throw new BlobStoreError('OneDrive upload session missing', 502);
    }
    const total = bytes.byteLength;
    try {
      for (let start = 0; start < total; start += UPLOAD_CHUNK_BYTES) {
        const end = Math.min(start + UPLOAD_CHUNK_BYTES, total);
        // The session URL is pre-authenticated; a bearer token is rejected.
        const res = await graph.requestUnsigned(uploadUrl, {
          method: 'PUT',
          headers: {
            'content-length': String(end - start),
            'content-range': `bytes ${start}-${end - 1}/${total}`,
          },
          body: bytes.subarray(start, end),
        });
        if (!res.ok) throw await graphError(res, 'upload');
      }
    } catch (error) {
      await graph
        .requestUnsigned(uploadUrl, { method: 'DELETE' })
        .catch(() => undefined);
      throw error;
    }
  }

  async function keyOf(item: GraphItem): Promise<string> {
    const driveId = item.parentReference?.driveId;
    const parentPath = item.parentReference?.path ?? '';
    const marker = parentPath.indexOf('root:');
    const inDrive =
      marker >= 0
        ? parentPath
            .slice(marker + 'root:'.length)
            .split('/')
            .filter(Boolean)
            .map(decodeURIComponent)
        : [];
    const rest = [...inDrive, item.name];
    if (!driveId || driveId === (await myDrive())) {
      return [ONEDRIVE, ...rest].join('/');
    }
    for (const site of await followedSites()) {
      const lib = (await librariesOf(site.value.id)).find(
        (l) => l.value.id === driveId,
      );
      if (lib) return [SHAREPOINT, site.label, lib.label, ...rest].join('/');
    }
    throw new BlobStoreError(
      'restored, but the library is not among your followed SharePoint sites',
      404,
    );
  }

  async function listLevel(
    prefix: string,
    limit: number,
    cursor?: string,
  ): Promise<BlobListResult> {
    const segments = splitKey(prefix);
    const base = segments.length ? `${segments.join('/')}/` : '';
    const target = await driveOf(segments);
    if (!target) return { objects: [], prefixes: [] };
    if (target.kind === 'root') {
      return { objects: [], prefixes: [`${ONEDRIVE}/`, `${SHAREPOINT}/`] };
    }
    if (target.kind === 'sites') {
      const list = await followedSites();
      return { objects: [], prefixes: list.map((s) => `${base}${s.label}/`) };
    }
    if (target.kind === 'site') {
      const list = await librariesOf(target.site.id);
      return { objects: [], prefixes: list.map((l) => `${base}${l.label}/`) };
    }
    const folder = await itemAt(target.driveId, target.rest);
    if (!folder || !isFolder(folder.item)) return { objects: [], prefixes: [] };
    const top = Math.min(Math.max(limit, 1), 999);
    const url = cursor
      ? graphCursor(cursor)
      : `${itemUrl(target.driveId, folder.item.id)}/children?$top=${top}&$select=${ITEM_SELECT}`;
    const page = await graph.json<{
      value?: GraphItem[];
      '@odata.nextLink'?: string;
    }>(url, undefined, 'list');
    const objects: BlobListObject[] = [];
    const prefixes: string[] = [];
    const now = Date.now();
    for (const item of page.value ?? []) {
      if (!isListable(item)) continue;
      const key = `${base}${item.name}`;
      items.set(`${target.driveId}\n${[...target.rest, item.name].join('/')}`, {
        located: { driveId: target.driveId, item },
        at: now,
      });
      if (isFolder(item)) prefixes.push(`${key}/`);
      else objects.push({ key, ...describe(item) });
    }
    return { objects, prefixes, cursor: page['@odata.nextLink'] ?? null };
  }

  async function walk(prefix: string): Promise<BlobListObject[]> {
    const out: BlobListObject[] = [];
    const queue = [prefix];
    while (queue.length) {
      const next = queue.shift()!;
      let cursor: string | undefined;
      do {
        const page = await listLevel(next, 999, cursor);
        out.push(...page.objects);
        queue.push(...page.prefixes);
        if (out.length + queue.length > MAX_WALK_ITEMS) {
          throw new BlobStoreError(
            `folder has more than ${MAX_WALK_ITEMS} items; manage it in OneDrive`,
            413,
          );
        }
        cursor = page.cursor ?? undefined;
      } while (cursor);
    }
    return out;
  }

  async function read(key: string) {
    const found = await fileAt(key);
    if (!found) return null;
    const res = await graph.request(
      `${itemUrl(found.driveId, found.item.id)}/content`,
      { redirect: 'manual' },
    );
    let body = res;
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new BlobStoreError('OneDrive download failed', 502);
      // Pre-authenticated download URL; never forward the bearer token.
      body = await graph.requestUnsigned(location);
    }
    if (body.status === 404) return null;
    if (!body.ok) throw await graphError(body, 'download');
    return {
      bytes: new Uint8Array(await body.arrayBuffer()),
      contentType: found.item.file?.mimeType || 'application/octet-stream',
    };
  }

  /** Destination folder + name; an existing file there goes to the recycle bin. */
  async function prepareTarget(
    toKey: string,
    sourceId?: string,
  ): Promise<{ parent: Folder; name: string }> {
    const segments = splitKey(toKey);
    const name = segments.pop();
    if (!name) throw new BlobStoreError('invalid key', 400);
    const parent = await ensureFolder(segments);
    const existing = await itemAt(parent.driveId, [...parent.rest, name]);
    if (existing && isFolder(existing.item)) {
      throw new BlobStoreError(`a folder named "${name}" exists there`, 409);
    }
    if (existing && existing.item.id !== sourceId) await removeItem(existing);
    return { parent, name };
  }

  /** Graph copies run asynchronously; poll the monitor URL until done. */
  async function copyItem(
    source: Located,
    parent: Located,
    name: string,
  ): Promise<void> {
    const res = await graph.request(
      `${itemUrl(source.driveId, source.item.id)}/copy`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          parentReference: { driveId: parent.driveId, id: parent.item.id },
          name,
        }),
      },
    );
    if (!res.ok) throw await graphError(res, 'copy');
    const monitor = res.headers.get('location');
    if (!monitor) return;
    for (let attempt = 0; attempt < COPY_POLLS; attempt += 1) {
      const poll = await graph.requestUnsigned(monitor, { redirect: 'manual' });
      if (poll.status === 303) return;
      const status = poll.ok
        ? ((await poll.json()) as { status?: string }).status
        : undefined;
      if (status === 'completed') return;
      if (status === 'failed' || (!poll.ok && poll.status !== 202)) {
        throw new BlobStoreError('OneDrive copy failed', 502);
      }
      await graph.sleep(Math.min(500 * 2 ** attempt, 4_000));
    }
    throw new BlobStoreError(
      'OneDrive is still copying; refresh in a moment',
      504,
    );
  }

  return {
    provider: 'onedrive',
    label: options.email ? `OneDrive (${options.email})` : 'OneDrive',
    indexMode: 'live',
    capabilities: {
      serverSideCopy: true,
      nativeFolders: true,
      nativeTrash: true,
      versions: true,
      maxFileSize: GRAPH_MAX_FILE_BYTES,
      exportFormats: [],
      quota: true,
    },

    async put(key, bytes, putOptions) {
      const segments = splitKey(key);
      const name = segments.pop();
      if (!name) throw new BlobStoreError('invalid key', 400);
      const parent = await ensureFolder(segments);
      const existing = await itemAt(parent.driveId, [...parent.rest, name]);
      if (existing && isFolder(existing.item)) {
        throw new BlobStoreError(`"${name}" already exists as a folder`, 409);
      }
      // `replace` keeps the item id, so OneDrive records a new version.
      if (bytes.byteLength <= SIMPLE_UPLOAD_MAX) {
        const res = await graph.request(
          `${itemUrl(parent.driveId, parent.item.id)}:/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=replace`,
          {
            method: 'PUT',
            headers: {
              'content-type':
                putOptions?.contentType || 'application/octet-stream',
            },
            body: bytes,
          },
        );
        if (!res.ok) throw await graphError(res, 'upload');
      } else {
        await uploadSession(parent, name, bytes);
      }
      clearCaches();
    },

    async get(key) {
      return (await read(key))?.bytes ?? null;
    },

    async read(key) {
      return read(key);
    },

    async stat(key) {
      const found = await fileAt(key);
      return found ? describe(found.item) : null;
    },

    async delete(key) {
      const segments = splitKey(key);
      if (isTrashKey(segments)) {
        const [driveId, itemId] = segments;
        if (!driveId || !itemId) return;
        const res = await graph.request(
          `${itemUrl(driveId, itemId)}/permanentDelete`,
          { method: 'POST' },
        );
        if (!res.ok && res.status !== 404) {
          throw await graphError(res, 'delete');
        }
        return;
      }
      const found = await fileAt(key);
      if (found) await removeItem(found);
      clearCaches();
    },

    async list(listOptions) {
      if (listOptions.delimiter === '/') {
        return listLevel(
          listOptions.prefix,
          listOptions.limit ?? 100,
          listOptions.cursor,
        );
      }
      if (splitKey(listOptions.prefix).length < 1) {
        throw new BlobStoreError(
          'listing every connected drive is not supported',
          400,
        );
      }
      return { objects: await walk(listOptions.prefix), prefixes: [] };
    },

    async copy(fromKey, toKey) {
      const source = await fileAt(fromKey);
      if (!source) throw new BlobStoreError('not found', 404);
      const { parent, name } = await prepareTarget(toKey);
      await copyItem(source, parent, name);
      clearCaches();
    },

    async move(fromKey, toKey) {
      const source = await fileAt(fromKey);
      if (!source) throw new BlobStoreError('not found', 404);
      const { parent, name } = await prepareTarget(toKey, source.item.id);
      if (parent.driveId !== source.driveId) {
        // Graph moves only within one drive; across drives copy, then recycle.
        await copyItem(source, parent, name);
        await removeItem(source);
      } else {
        await graph.json(
          itemUrl(source.driveId, source.item.id),
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              parentReference: { id: parent.item.id },
              name,
            }),
          },
          'move',
        );
      }
      clearCaches();
    },

    async trash(key) {
      const found = await fileAt(key);
      if (!found) throw new BlobStoreError('not found', 404);
      await removeItem(found);
      clearCaches();
      return {
        trashKey: `${found.driveId}/${found.item.id}/${found.item.name}`,
      };
    },

    // Graph v1.0 cannot list the recycle bin of OneDrive for Business or
    // SharePoint; deleted items are restored from Microsoft 365.
    async listTrash(): Promise<NativeTrashObject[]> {
      return [];
    },

    async restore(trashKey) {
      const [driveId, itemId] = splitKey(trashKey);
      if (!driveId || !itemId) throw new BlobStoreError('invalid key', 400);
      const res = await graph.request(`${itemUrl(driveId, itemId)}/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) {
        throw new BlobStoreError(
          'restore it from the OneDrive or SharePoint recycle bin',
          501,
        );
      }
      clearCaches();
      return { key: await keyOf((await res.json()) as GraphItem) };
    },

    async test() {
      await myDrive();
    },

    async quota() {
      const drive = await graph.json<{
        quota?: { used?: number; total?: number };
      }>(`${GRAPH_API}/me/drive?$select=quota`, undefined, 'read quota');
      const used = drive.quota?.used ?? 0;
      return drive.quota?.total
        ? { usedBytes: used, limitBytes: drive.quota.total }
        : { usedBytes: used };
    },
  };
}
