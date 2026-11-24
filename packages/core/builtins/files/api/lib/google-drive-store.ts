import { BlobStoreError } from './blob-store-error';
import { MAX_OBJECT_BYTES } from './constants';
import {
  DRIVE_API,
  DRIVE_UPLOAD_API,
  driveError,
  type DriveClient,
} from './google-drive-client';
import type {
  BlobListObject,
  BlobListResult,
  NativeTrashObject,
  StorageAdapter,
  StorageStat,
} from './types';

export const MY_DRIVE = 'My Drive';
export const SHARED_DRIVES = 'Shared drives';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
const NATIVE_PREFIX = 'application/vnd.google-apps.';
const FILE_FIELDS =
  'id,name,mimeType,size,modifiedTime,webViewLink,parents,trashed,trashedTime,driveId';
const PATH_CACHE_MS = 30_000;
/** Cap for recursive walks (folder copy / move / delete). */
const MAX_WALK_ITEMS = 2_000;

type ExportFormat = { format: string; mime: string };

const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** Google-native types and their exports; the first is the download default. */
export const GOOGLE_EXPORTS: Record<string, readonly ExportFormat[]> = {
  'application/vnd.google-apps.document': [
    { format: 'docx', mime: DOCX },
    { format: 'pdf', mime: 'application/pdf' },
  ],
  'application/vnd.google-apps.spreadsheet': [
    { format: 'xlsx', mime: XLSX },
    { format: 'pdf', mime: 'application/pdf' },
  ],
  'application/vnd.google-apps.presentation': [
    { format: 'pptx', mime: PPTX },
    { format: 'pdf', mime: 'application/pdf' },
  ],
  'application/vnd.google-apps.drawing': [
    { format: 'pdf', mime: 'application/pdf' },
    { format: 'png', mime: 'image/png' },
  ],
};

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
  trashed?: boolean;
  trashedTime?: string;
  driveId?: string;
};

type DriveNode = {
  id: string;
  name: string;
  mimeType: string;
  /** Shared drive the node lives in (absent → My Drive). */
  driveId?: string;
  file?: DriveFile;
};

type SharedDrive = { id: string; name: string };

const SHARED_ROOT: DriveNode = {
  id: '__shared_drives__',
  name: SHARED_DRIVES,
  mimeType: FOLDER_MIME,
};

function isFolder(node: DriveNode): boolean {
  return node.mimeType === FOLDER_MIME;
}

function isNative(mimeType: string): boolean {
  return mimeType.startsWith(NATIVE_PREFIX) && mimeType !== FOLDER_MIME;
}

function escapeQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Drive allows `/` in names; Files paths do not. */
function safeName(name: string): string {
  const cleaned = name.replace(/[/\\]/g, '_');
  return cleaned === '.' || cleaned === '..' || !cleaned.trim() ? '_' : cleaned;
}

/** `report.pdf` + id → `report [id].pdf` (duplicate names in one folder). */
export function disambiguatedName(name: string, id: string): string {
  const safe = safeName(name);
  const dot = safe.lastIndexOf('.');
  if (dot > 0 && dot < safe.length - 1 && !/\s/.test(safe.slice(dot))) {
    return `${safe.slice(0, dot)} [${id}]${safe.slice(dot)}`;
  }
  return `${safe} [${id}]`;
}

export function parseDisambiguated(
  segment: string,
): { name: string; id: string } | null {
  const match = segment.match(/^(.*) \[([A-Za-z0-9_-]{10,})\](\.[^.\s]+)?$/);
  if (!match?.[1] || !match[2]) return null;
  return { name: `${match[1]}${match[3] ?? ''}`, id: match[2] };
}

/** Listing names: unique names as-is, duplicates / unsafe names with the id. */
function segmentNames<T extends { id: string; name: string }>(
  items: T[],
): Map<string, string> {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.name, (counts.get(item.name) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const item of items) {
    const unique =
      counts.get(item.name) === 1 && safeName(item.name) === item.name;
    out.set(
      item.id,
      unique ? item.name : disambiguatedName(item.name, item.id),
    );
  }
  return out;
}

function splitKey(key: string): string[] {
  return key.split('/').filter(Boolean);
}

function isTrashKey(segments: string[]): boolean {
  return (
    segments.length > 0 &&
    segments[0] !== MY_DRIVE &&
    segments[0] !== SHARED_DRIVES
  );
}

function exportsOf(mimeType: string): string[] | undefined {
  return GOOGLE_EXPORTS[mimeType]?.map((e) => e.format);
}

function describeFile(file: DriveFile): Omit<BlobListObject, 'key'> {
  const out: Omit<BlobListObject, 'key'> = { contentType: file.mimeType };
  if (file.size !== undefined) out.bytes = Number(file.size);
  if (file.modifiedTime) out.updatedAt = file.modifiedTime;
  if (file.webViewLink) out.webUrl = file.webViewLink;
  if (isNative(file.mimeType))
    out.exportFormats = exportsOf(file.mimeType) ?? [];
  return out;
}

export type GoogleDriveStoreOptions = {
  drive: DriveClient;
  /** Connected account email (label only). */
  email?: string;
};

export function createGoogleDriveStore(
  options: GoogleDriveStoreOptions,
): StorageAdapter {
  const { drive } = options;
  const paths = new Map<string, { node: DriveNode | null; at: number }>();
  let rootId: Promise<string> | null = null;
  let sharedDrives: { at: number; list: SharedDrive[] } | null = null;

  function clearCaches(): void {
    paths.clear();
    sharedDrives = null;
  }

  function myDriveRoot(): Promise<string> {
    rootId ??= drive
      .json<{ id: string }>(
        `${DRIVE_API}/files/root?fields=id`,
        undefined,
        'read',
      )
      .then((r) => r.id)
      .catch((error) => {
        rootId = null;
        throw error;
      });
    return rootId;
  }

  async function listSharedDrives(): Promise<SharedDrive[]> {
    if (sharedDrives && Date.now() - sharedDrives.at < PATH_CACHE_MS) {
      return sharedDrives.list;
    }
    const list: SharedDrive[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        pageSize: '100',
        fields: 'nextPageToken,drives(id,name)',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await drive.json<{
        drives?: SharedDrive[];
        nextPageToken?: string;
      }>(`${DRIVE_API}/drives?${params}`, undefined, 'list shared drives');
      list.push(...(page.drives ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    sharedDrives = { at: Date.now(), list };
    return list;
  }

  async function listFiles(input: {
    q: string;
    driveId?: string;
    pageSize?: number;
    pageToken?: string;
    orderBy?: string;
  }): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
    const params = new URLSearchParams({
      q: input.q,
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      pageSize: String(input.pageSize ?? 100),
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (input.driveId) {
      params.set('corpora', 'drive');
      params.set('driveId', input.driveId);
    } else {
      params.set('corpora', 'user');
    }
    if (input.pageToken) params.set('pageToken', input.pageToken);
    if (input.orderBy) params.set('orderBy', input.orderBy);
    const page = await drive.json<{
      files?: DriveFile[];
      nextPageToken?: string;
    }>(`${DRIVE_API}/files?${params}`, undefined, 'list');
    return {
      files: page.files ?? [],
      ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
    };
  }

  async function getFile(id: string): Promise<DriveFile | null> {
    const res = await drive.request(
      `${DRIVE_API}/files/${encodeURIComponent(id)}?fields=${FILE_FIELDS}&supportsAllDrives=true`,
    );
    if (res.status === 404) return null;
    if (!res.ok) throw await driveError(res, 'read');
    return (await res.json()) as DriveFile;
  }

  function nodeOf(file: DriveFile, driveId?: string): DriveNode {
    const node: DriveNode = {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      file,
    };
    const inDrive = file.driveId ?? driveId;
    if (inDrive) node.driveId = inDrive;
    return node;
  }

  async function child(
    parent: DriveNode,
    segment: string,
  ): Promise<DriveNode | null> {
    if (parent === SHARED_ROOT) {
      const drives = await listSharedDrives();
      const names = segmentNames(drives);
      const match = drives.find((d) => names.get(d.id) === segment);
      return match
        ? {
            id: match.id,
            name: match.name,
            mimeType: FOLDER_MIME,
            driveId: match.id,
          }
        : null;
    }
    const { files } = await listFiles({
      q: `'${escapeQuery(parent.id)}' in parents and name = '${escapeQuery(segment)}' and trashed = false`,
      pageSize: 10,
      ...(parent.driveId ? { driveId: parent.driveId } : {}),
    });
    const visible = files.filter((f) => f.mimeType !== SHORTCUT_MIME);
    if (visible.length === 1 && safeName(segment) === segment) {
      return nodeOf(visible[0]!, parent.driveId);
    }
    if (visible.length > 1) {
      throw new BlobStoreError(
        `${visible.length} items are named "${segment}" in this folder; pick one from the listing`,
        409,
      );
    }
    const tagged = parseDisambiguated(segment);
    if (!tagged) return null;
    const file = await getFile(tagged.id);
    if (
      !file ||
      file.trashed ||
      !file.parents?.includes(parent.id) ||
      safeName(file.name) !== tagged.name
    ) {
      return null;
    }
    return nodeOf(file, parent.driveId);
  }

  async function topNode(segment: string): Promise<DriveNode | null> {
    if (segment === MY_DRIVE) {
      return { id: await myDriveRoot(), name: MY_DRIVE, mimeType: FOLDER_MIME };
    }
    if (segment === SHARED_DRIVES) return SHARED_ROOT;
    return null;
  }

  async function resolve(segments: string[]): Promise<DriveNode | null> {
    if (!segments.length) return null;
    const path = segments.join('/');
    const hit = paths.get(path);
    if (hit && Date.now() - hit.at < PATH_CACHE_MS) return hit.node;
    let node: DriveNode | null;
    if (segments.length === 1) {
      node = await topNode(segments[0]!);
    } else {
      const parent = await resolve(segments.slice(0, -1));
      node =
        parent && isFolder(parent)
          ? await child(parent, segments[segments.length - 1]!)
          : null;
    }
    paths.set(path, { node, at: Date.now() });
    return node;
  }

  async function createFolder(parent: DriveNode, name: string) {
    const file = await drive.json<DriveFile>(
      `${DRIVE_API}/files?supportsAllDrives=true&fields=${FILE_FIELDS}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          mimeType: FOLDER_MIME,
          parents: [parent.id],
        }),
      },
      'create folder',
    );
    return nodeOf(file, parent.driveId);
  }

  /** Writable folder for a path (`mkdir -p`); top level must be a drive. */
  async function ensureFolder(segments: string[]): Promise<DriveNode> {
    const top = segments[0];
    const minDepth = top === SHARED_DRIVES ? 2 : 1;
    if (
      (top !== MY_DRIVE && top !== SHARED_DRIVES) ||
      segments.length < minDepth
    ) {
      throw new BlobStoreError(
        `save into "${MY_DRIVE}" or a folder under "${SHARED_DRIVES}"`,
        400,
      );
    }
    let node = await resolve(segments.slice(0, minDepth));
    if (!node) throw new BlobStoreError('shared drive not found', 404);
    for (let i = minDepth; i < segments.length; i += 1) {
      const next = await child(node, segments[i]!);
      if (next && !isFolder(next)) {
        throw new BlobStoreError(
          `"${segments[i]}" is a file, not a folder`,
          409,
        );
      }
      node = next ?? (await createFolder(node, segments[i]!));
      paths.set(segments.slice(0, i + 1).join('/'), {
        node,
        at: Date.now(),
      });
    }
    return node;
  }

  async function fileAt(key: string): Promise<DriveNode | null> {
    const node = await resolve(splitKey(key));
    return node && !isFolder(node) && node.file ? node : null;
  }

  async function patchFile(
    id: string,
    body: Record<string, unknown>,
    query = '',
  ): Promise<DriveFile> {
    return drive.json<DriveFile>(
      `${DRIVE_API}/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=${FILE_FIELDS}${query}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      'update',
    );
  }

  async function trashNode(node: DriveNode): Promise<void> {
    await patchFile(node.id, { trashed: true });
  }

  /** Resumable session → single PUT (works for every size up to the cap). */
  async function upload(
    url: string,
    method: 'POST' | 'PATCH',
    metadata: Record<string, unknown>,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    const session = await drive.request(url, {
      method,
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-type': contentType,
        'x-upload-content-length': String(bytes.byteLength),
      },
      body: JSON.stringify(metadata),
    });
    if (!session.ok) throw await driveError(session, 'upload');
    const location = session.headers.get('location');
    if (!location) {
      throw new BlobStoreError('Google Drive upload session missing', 502);
    }
    const res = await drive.request(location, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body: bytes,
    });
    if (!res.ok) throw await driveError(res, 'upload');
  }

  async function pathOf(file: DriveFile): Promise<string> {
    const segments = [safeName(file.name)];
    const root = await myDriveRoot();
    let parentId = file.parents?.[0];
    for (let depth = 0; parentId && depth < 32; depth += 1) {
      if (parentId === root) return [MY_DRIVE, ...segments].join('/');
      if (file.driveId && parentId === file.driveId) {
        const drives = await listSharedDrives();
        const names = segmentNames(drives);
        const name = names.get(parentId) ?? parentId;
        return [SHARED_DRIVES, name, ...segments].join('/');
      }
      const parent = await getFile(parentId);
      if (!parent) break;
      segments.unshift(safeName(parent.name));
      parentId = parent.parents?.[0];
    }
    return [MY_DRIVE, ...segments].join('/');
  }

  async function listLevel(
    prefix: string,
    limit: number,
    cursor?: string,
  ): Promise<BlobListResult> {
    const segments = splitKey(prefix);
    if (!segments.length) {
      return { objects: [], prefixes: [`${MY_DRIVE}/`, `${SHARED_DRIVES}/`] };
    }
    const folder = await resolve(segments);
    if (!folder || !isFolder(folder)) return { objects: [], prefixes: [] };
    const base = `${segments.join('/')}/`;
    if (folder === SHARED_ROOT) {
      const drives = await listSharedDrives();
      const names = segmentNames(drives);
      return {
        objects: [],
        prefixes: drives.map((d) => `${base}${names.get(d.id)}/`),
      };
    }
    const page = await listFiles({
      q: `'${escapeQuery(folder.id)}' in parents and trashed = false`,
      pageSize: Math.min(Math.max(limit, 1), 1000),
      orderBy: 'folder,name',
      ...(cursor ? { pageToken: cursor } : {}),
      ...(folder.driveId ? { driveId: folder.driveId } : {}),
    });
    const files = page.files.filter((f) => f.mimeType !== SHORTCUT_MIME);
    const names = segmentNames(files);
    const objects: BlobListObject[] = [];
    const prefixes: string[] = [];
    const now = Date.now();
    for (const file of files) {
      const key = `${base}${names.get(file.id)}`;
      paths.set(key, { node: nodeOf(file, folder.driveId), at: now });
      if (file.mimeType === FOLDER_MIME) prefixes.push(`${key}/`);
      else objects.push({ key, ...describeFile(file) });
    }
    return { objects, prefixes, cursor: page.nextPageToken ?? null };
  }

  async function walk(prefix: string): Promise<BlobListObject[]> {
    const out: BlobListObject[] = [];
    const queue = [prefix];
    while (queue.length) {
      const next = queue.shift()!;
      let cursor: string | undefined;
      do {
        const page = await listLevel(next, 1000, cursor);
        out.push(...page.objects);
        queue.push(...page.prefixes);
        if (out.length + queue.length > MAX_WALK_ITEMS) {
          throw new BlobStoreError(
            `folder has more than ${MAX_WALK_ITEMS} items; manage it in Google Drive`,
            413,
          );
        }
        cursor = page.cursor ?? undefined;
      } while (cursor);
    }
    return out;
  }

  async function read(key: string, format?: string) {
    const node = await fileAt(key);
    if (!node) return null;
    if (isNative(node.mimeType)) {
      const exports = GOOGLE_EXPORTS[node.mimeType];
      if (!exports) {
        throw new BlobStoreError(
          `"${node.name}" has no downloadable format — open it in Google`,
          415,
        );
      }
      const pick = format
        ? exports.find((e) => e.format === format)
        : exports[0];
      if (!pick) {
        throw new BlobStoreError(
          `cannot export as ${format}; choose ${exports.map((e) => e.format).join(', ')}`,
          400,
        );
      }
      const res = await drive.request(
        `${DRIVE_API}/files/${encodeURIComponent(node.id)}/export?mimeType=${encodeURIComponent(pick.mime)}`,
      );
      if (!res.ok) throw await driveError(res, 'export');
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType: pick.mime,
        extension: pick.format,
      };
    }
    const res = await drive.request(
      `${DRIVE_API}/files/${encodeURIComponent(node.id)}?alt=media&supportsAllDrives=true`,
    );
    if (res.status === 404) return null;
    if (!res.ok) throw await driveError(res, 'download');
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      contentType: node.mimeType || 'application/octet-stream',
    };
  }

  /** Destination folder + name; an existing file there is moved to trash. */
  async function prepareTarget(
    toKey: string,
    sourceId?: string,
  ): Promise<{ parent: DriveNode; name: string }> {
    const segments = splitKey(toKey);
    const name = segments.pop();
    if (!name) throw new BlobStoreError('invalid key', 400);
    const parent = await ensureFolder(segments);
    const existing = await child(parent, name);
    if (existing && isFolder(existing)) {
      throw new BlobStoreError(`a folder named "${name}" exists there`, 409);
    }
    if (existing && existing.id !== sourceId) await trashNode(existing);
    return { parent, name: parseDisambiguated(name)?.name ?? name };
  }

  return {
    provider: 'google-drive',
    label: options.email ? `Google Drive (${options.email})` : 'Google Drive',
    indexMode: 'live',
    capabilities: {
      serverSideCopy: true,
      nativeFolders: true,
      nativeTrash: true,
      versions: true,
      maxFileSize: MAX_OBJECT_BYTES,
      exportFormats: ['docx', 'xlsx', 'pptx', 'pdf', 'png'],
      quota: true,
    },

    async put(key, bytes, putOptions) {
      const segments = splitKey(key);
      const name = segments.pop();
      if (!name) throw new BlobStoreError('invalid key', 400);
      const parent = await ensureFolder(segments);
      const existing = await child(parent, name);
      const contentType = putOptions?.contentType || 'application/octet-stream';
      if (existing && (isFolder(existing) || isNative(existing.mimeType))) {
        throw new BlobStoreError(
          `"${name}" already exists as a ${isFolder(existing) ? 'folder' : 'Google document'}`,
          409,
        );
      }
      if (existing) {
        // Same file id → Drive keeps the previous bytes as a revision.
        await upload(
          `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(existing.id)}?uploadType=resumable&supportsAllDrives=true`,
          'PATCH',
          {},
          bytes,
          contentType,
        );
      } else {
        await upload(
          `${DRIVE_UPLOAD_API}/files?uploadType=resumable&supportsAllDrives=true`,
          'POST',
          { name, parents: [parent.id] },
          bytes,
          contentType,
        );
      }
      clearCaches();
    },

    async get(key) {
      return (await read(key))?.bytes ?? null;
    },

    async read(key, readOptions) {
      return read(key, readOptions?.format);
    },

    async stat(key): Promise<StorageStat | null> {
      const node = await fileAt(key);
      return node?.file ? describeFile(node.file) : null;
    },

    async delete(key) {
      const segments = splitKey(key);
      if (isTrashKey(segments)) {
        const res = await drive.request(
          `${DRIVE_API}/files/${encodeURIComponent(segments[0]!)}?supportsAllDrives=true`,
          { method: 'DELETE' },
        );
        if (!res.ok && res.status !== 404) {
          throw await driveError(res, 'delete');
        }
        return;
      }
      const node = await fileAt(key);
      if (node) await trashNode(node);
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
      if (!splitKey(listOptions.prefix).length) {
        throw new BlobStoreError(
          'listing a whole Google Drive is not supported',
          400,
        );
      }
      return { objects: await walk(listOptions.prefix), prefixes: [] };
    },

    async copy(fromKey, toKey) {
      const source = await fileAt(fromKey);
      if (!source) throw new BlobStoreError('not found', 404);
      const { parent, name } = await prepareTarget(toKey);
      await drive.json(
        `${DRIVE_API}/files/${encodeURIComponent(source.id)}/copy?supportsAllDrives=true&fields=id`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, parents: [parent.id] }),
        },
        'copy',
      );
      clearCaches();
    },

    async move(fromKey, toKey) {
      const source = await fileAt(fromKey);
      if (!source?.file) throw new BlobStoreError('not found', 404);
      const { parent, name } = await prepareTarget(toKey, source.id);
      const oldParents = source.file.parents ?? [];
      const query = oldParents.includes(parent.id)
        ? ''
        : `&addParents=${encodeURIComponent(parent.id)}&removeParents=${encodeURIComponent(oldParents.join(','))}`;
      await patchFile(source.id, { name }, query);
      clearCaches();
    },

    async trash(key) {
      const node = await fileAt(key);
      if (!node) throw new BlobStoreError('not found', 404);
      await trashNode(node);
      clearCaches();
      return { trashKey: `${node.id}/${safeName(node.name)}` };
    },

    async listTrash(): Promise<NativeTrashObject[]> {
      const out: NativeTrashObject[] = [];
      let pageToken: string | undefined;
      do {
        const page = await listFiles({
          q: `trashed = true and mimeType != '${FOLDER_MIME}'`,
          pageSize: 200,
          ...(pageToken ? { pageToken } : {}),
        });
        for (const file of page.files) {
          const item: NativeTrashObject = {
            key: `${file.id}/${safeName(file.name)}`,
            ...describeFile(file),
          };
          if (file.trashedTime) item.trashedAt = file.trashedTime;
          out.push(item);
        }
        pageToken = page.nextPageToken;
      } while (pageToken && out.length < 1000);
      return out;
    },

    async restore(trashKey) {
      const [id] = splitKey(trashKey);
      if (!id) throw new BlobStoreError('invalid key', 400);
      const file = await patchFile(id, { trashed: false });
      clearCaches();
      return { key: await pathOf(file) };
    },

    async test() {
      await drive.json(
        `${DRIVE_API}/about?fields=user(emailAddress)`,
        undefined,
        'connect',
      );
    },

    async quota() {
      const about = await drive.json<{
        storageQuota?: { limit?: string; usage?: string };
      }>(
        `${DRIVE_API}/about?fields=storageQuota(limit,usage)`,
        undefined,
        'read quota',
      );
      const used = Number(about.storageQuota?.usage ?? 0);
      const limit = about.storageQuota?.limit;
      return limit
        ? { usedBytes: used, limitBytes: Number(limit) }
        : { usedBytes: used };
    },
  };
}
