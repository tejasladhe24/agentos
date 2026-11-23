import { FILES_SETTINGS_COLLECTION, ORG_ID_HEADER } from './constants';
import {
  parseRetentionDays,
  type BinRetentionDays,
} from './trash';

export type FilesOrgSettings = {
  binRetentionDays: BinRetentionDays;
};

export const DEFAULT_ORG_SETTINGS: FilesOrgSettings = {
  binRetentionDays: 30,
};

export type FilesOrgSettingsStore = {
  get: (orgId: string) => Promise<FilesOrgSettings>;
  put: (orgId: string, settings: FilesOrgSettings) => Promise<FilesOrgSettings>;
};

function orgHeaders(orgId: string): Headers {
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set(ORG_ID_HEADER, orgId);
  return headers;
}

const DOC_ID = 'config';

async function queryConfig(
  root: string,
  collection: string,
  orgId: string,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${root}/collections/${collection}/query`, {
    method: 'POST',
    headers: orgHeaders(orgId),
    body: JSON.stringify({ where: { id: DOC_ID }, limit: 1 }),
  });
  if (!res.ok) return null;
  const payload = (await res.json()) as {
    items?: Array<{ data: Record<string, unknown> }>;
  };
  return payload.items?.[0]?.data ?? null;
}

export function createFilesOrgSettingsStore(
  baseUrl: string,
): FilesOrgSettingsStore {
  const root = baseUrl.replace(/\/+$/, '');
  const collection = encodeURIComponent(FILES_SETTINGS_COLLECTION);

  return {
    async get(orgId) {
      try {
        const data = await queryConfig(root, collection, orgId);
        if (!data) return { ...DEFAULT_ORG_SETTINGS };
        return {
          binRetentionDays: parseRetentionDays(data.binRetentionDays),
        };
      } catch {
        return { ...DEFAULT_ORG_SETTINGS };
      }
    },

    async put(orgId, settings) {
      const data = {
        id: DOC_ID,
        binRetentionDays: settings.binRetentionDays,
        updatedAt: new Date().toISOString(),
      };

      let exists = false;
      try {
        exists = (await queryConfig(root, collection, orgId)) != null;
      } catch {
        exists = false;
      }

      if (exists) {
        const updateRes = await fetch(
          `${root}/collections/${collection}/update`,
          {
            method: 'POST',
            headers: orgHeaders(orgId),
            body: JSON.stringify({ id: DOC_ID, data, merge: false }),
          },
        );
        if (!updateRes.ok) {
          const detail = await updateRes.text();
          throw new Error(
            `files org-settings update failed (${updateRes.status}): ${detail}`,
          );
        }
        return settings;
      }

      const insertRes = await fetch(
        `${root}/collections/${collection}/insert`,
        {
          method: 'POST',
          headers: orgHeaders(orgId),
          body: JSON.stringify({ id: DOC_ID, data }),
        },
      );
      if (insertRes.ok) return settings;

      // Insert raced — fall back to update.
      const updateRes = await fetch(
        `${root}/collections/${collection}/update`,
        {
          method: 'POST',
          headers: orgHeaders(orgId),
          body: JSON.stringify({ id: DOC_ID, data, merge: false }),
        },
      );
      if (!updateRes.ok) {
        const detail = await updateRes.text();
        throw new Error(
          `files org-settings save failed (${updateRes.status}): ${detail}`,
        );
      }
      return settings;
    },
  };
}

export function createMemoryOrgSettingsStore(): FilesOrgSettingsStore {
  const map = new Map<string, FilesOrgSettings>();
  return {
    async get(orgId) {
      return map.get(orgId) ?? { ...DEFAULT_ORG_SETTINGS };
    },
    async put(orgId, settings) {
      map.set(orgId, { ...settings });
      return settings;
    },
  };
}
