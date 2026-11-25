const USER_EMAIL_PREFS_COLLECTION = 'notifications_user_prefs';
const ORG_ID_HEADER = 'x-agentos-org-id';

export type UserEmailPref = {
  userId: string;
  orgId: string;
  from: string;
  updatedAt: string;
};

export type UserEmailPrefsStore = {
  get: (orgId: string, userId: string) => Promise<UserEmailPref | null>;
  set: (orgId: string, userId: string, from: string) => Promise<UserEmailPref>;
  clear: (orgId: string, userId: string) => Promise<void>;
};

function orgHeaders(orgId: string): Headers {
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set(ORG_ID_HEADER, orgId);
  return headers;
}

function parsePref(
  orgId: string,
  userId: string,
  data: Record<string, unknown>,
): UserEmailPref | null {
  const from = typeof data.from === 'string' ? data.from.trim() : '';
  if (!from) return null;
  return {
    userId: typeof data.userId === 'string' ? data.userId : userId,
    orgId: typeof data.orgId === 'string' ? data.orgId : orgId,
    from,
    updatedAt:
      typeof data.updatedAt === 'string'
        ? data.updatedAt
        : new Date(0).toISOString(),
  };
}

/** Org-scoped per-user email sender preferences backed by builtin `db-store`. */
export function createDbUserEmailPrefsStore(
  dbStoreBaseUrl: string,
): UserEmailPrefsStore {
  const root = dbStoreBaseUrl.replace(/\/+$/, '');
  const collection = `${root}/collections/${encodeURIComponent(USER_EMAIL_PREFS_COLLECTION)}`;

  const store: UserEmailPrefsStore = {
    async get(orgId, userId) {
      const res = await fetch(`${collection}/query`, {
        method: 'POST',
        headers: orgHeaders(orgId),
        body: JSON.stringify({ where: { userId }, limit: 1 }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(
          `db-store query failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      const payload = (await res.json()) as {
        items?: Array<{ id: string; data: Record<string, unknown> }>;
        documents?: Array<{ id: string; data: Record<string, unknown> }>;
      };
      const doc = (payload.items ?? payload.documents ?? [])[0];
      if (!doc) return null;
      return parsePref(orgId, userId, doc.data ?? {});
    },

    async set(orgId, userId, from) {
      const existing = await store.get(orgId, userId);
      const record: UserEmailPref = {
        userId,
        orgId,
        from: from.trim(),
        updatedAt: new Date().toISOString(),
      };
      const op = existing ? 'update' : 'insert';
      const res = await fetch(`${collection}/${op}`, {
        method: 'POST',
        headers: orgHeaders(orgId),
        body: JSON.stringify(
          existing
            ? { id: userId, data: record, merge: false }
            : { id: userId, data: record },
        ),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(
          `db-store ${op} failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      return record;
    },

    async clear(orgId, userId) {
      const res = await fetch(`${collection}/delete`, {
        method: 'POST',
        headers: orgHeaders(orgId),
        body: JSON.stringify({ id: userId }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(
          `db-store delete failed (${res.status}): ${detail || res.statusText}`,
        );
      }
    },
  };

  return store;
}

/** In-memory per-user email sender preferences for unit tests. */
export function createMemoryUserEmailPrefsStore(): UserEmailPrefsStore {
  const map = new Map<string, UserEmailPref>();
  const key = (orgId: string, userId: string) => `${orgId}\u0000${userId}`;

  return {
    async get(orgId, userId) {
      return map.get(key(orgId, userId)) ?? null;
    },
    async set(orgId, userId, from) {
      const record: UserEmailPref = {
        userId,
        orgId,
        from: from.trim(),
        updatedAt: new Date().toISOString(),
      };
      map.set(key(orgId, userId), record);
      return record;
    },
    async clear(orgId, userId) {
      map.delete(key(orgId, userId));
    },
  };
}
