/**
 * @agentos/core/api/integrations — tenant BYOK integrations kit (ticket 103).
 *
 * Non-secret settings live in org-scoped db-store collection `integrations`;
 * secret values live in the `secrets` vault under the reserved
 * `integrations/<integration>/<instanceId>/<field>` prefix. When an org has no
 * record, callers fall back to platform env config.
 */

import { appendEntry } from './audit';
import { publish } from './events';
import { resolveExtApiBase, type EnvMap } from './http';
import { resolveSecretsApiBase } from './secrets';
import { resolveDbStoreApiBase } from './store';

export const INTEGRATIONS_COLLECTION = 'integrations';

/** Vault key prefix owned by the integrations kit (locked in the Secrets manager). */
export const INTEGRATION_SECRET_PREFIX = 'integrations/';

/** Event topic published after put/delete so other replicas drop cached providers. */
export const INTEGRATION_CHANGED_TOPIC = 'integration.changed';

/** RBAC permission to configure tenant integrations (admin/owner). */
export const PERMISSION_INTEGRATIONS_MANAGE = 'integrations.manage';

export const DEFAULT_INTEGRATION_INSTANCE = 'default';

/** Default TTL for cached integration lookups / built providers. */
export const DEFAULT_INTEGRATION_CACHE_TTL_MS = 30_000;

const ORG_ID_HEADER = 'x-agentos-org-id';

const INTEGRATION_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;
const INSTANCE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const FIELD_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const PROVIDER_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export type IntegrationSettings = Record<string, unknown>;

/** Stored db-store document (never contains secret values). */
export type IntegrationRecord = {
  id: string;
  integration: string;
  instanceId: string;
  provider: string;
  settings: IntegrationSettings;
  /** field → vault key */
  secretRefs: Record<string, string>;
  /** field → ISO timestamp of last write */
  secretUpdatedAt: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
};

/** Server-side resolved config including decrypted secrets. Never send to the UI. */
export type ResolvedIntegration = {
  id: string;
  integration: string;
  instanceId: string;
  provider: string;
  settings: IntegrationSettings;
  secrets: Record<string, string>;
  updatedAt: string;
};

export type IntegrationSecretStatus = { set: true; updatedAt?: string };

/** Display-safe view: secrets reported as `{ set, updatedAt }` only. */
export type IntegrationView = {
  id: string;
  integration: string;
  instanceId: string;
  provider: string;
  settings: IntegrationSettings;
  secrets: Record<string, IntegrationSecretStatus>;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
};

export type PutIntegrationInput = {
  integration: string;
  instanceId?: string;
  provider: string;
  settings?: IntegrationSettings;
  /**
   * field → new value. `null` removes the field. Omitted fields keep their
   * current value unless the provider changes (then they are removed).
   */
  secrets?: Record<string, string | null>;
  updatedBy?: string;
};

export type IntegrationChangedPayload = {
  orgId: string;
  integration: string;
  instanceId: string;
  action: 'put' | 'delete';
  updatedAt: string;
};

export type IntegrationAuditInput = {
  action: 'integration.put' | 'integration.delete' | 'integration.test';
  resource: string;
  actor?: string;
  meta: Record<string, unknown>;
};

/** Storage/transport seam. HTTP in production, memory in tests. */
export type IntegrationsBackend = {
  getRecord: (orgId: string, id: string) => Promise<IntegrationRecord | null>;
  listRecords: (
    orgId: string,
    integration?: string,
  ) => Promise<IntegrationRecord[]>;
  putRecord: (orgId: string, record: IntegrationRecord) => Promise<void>;
  deleteRecord: (orgId: string, id: string) => Promise<boolean>;
  getSecret: (orgId: string, key: string) => Promise<string | null>;
  putSecret: (orgId: string, key: string, value: string) => Promise<void>;
  deleteSecret: (orgId: string, key: string) => Promise<void>;
  publish?: (
    topic: string,
    payload: IntegrationChangedPayload,
  ) => Promise<void>;
  audit?: (orgId: string, entry: IntegrationAuditInput) => Promise<void>;
};

export class IntegrationError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'IntegrationError';
    this.status = status;
  }
}

export function isValidIntegrationId(value: string): boolean {
  return INTEGRATION_ID_PATTERN.test(value) && value.length <= 64;
}

export function isValidInstanceId(value: string): boolean {
  return INSTANCE_ID_PATTERN.test(value);
}

export function isValidIntegrationField(value: string): boolean {
  return FIELD_PATTERN.test(value);
}

export function isValidProviderId(value: string): boolean {
  return PROVIDER_PATTERN.test(value);
}

function assertIds(integration: string, instanceId: string): void {
  if (!isValidIntegrationId(integration)) {
    throw new IntegrationError(`invalid integration id: ${integration}`);
  }
  if (!isValidInstanceId(instanceId)) {
    throw new IntegrationError(`invalid instance id: ${instanceId}`);
  }
}

export function integrationDocId(
  integration: string,
  instanceId: string = DEFAULT_INTEGRATION_INSTANCE,
): string {
  return `${integration}:${instanceId}`;
}

export function integrationSecretKey(
  integration: string,
  instanceId: string,
  field: string,
): string {
  return `${INTEGRATION_SECRET_PREFIX}${integration}/${instanceId}/${field}`;
}

export function isIntegrationSecretKey(key: string): boolean {
  return key.startsWith(INTEGRATION_SECRET_PREFIX);
}

/** Strip secrets down to `{ set, updatedAt }` for UI / list responses. */
export function toIntegrationView(record: IntegrationRecord): IntegrationView {
  const secrets: Record<string, IntegrationSecretStatus> = {};
  for (const field of Object.keys(record.secretRefs)) {
    const status: IntegrationSecretStatus = { set: true };
    const updatedAt = record.secretUpdatedAt[field];
    if (updatedAt) status.updatedAt = updatedAt;
    secrets[field] = status;
  }
  const view: IntegrationView = {
    id: record.id,
    integration: record.integration,
    instanceId: record.instanceId,
    provider: record.provider,
    settings: { ...record.settings },
    secrets,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  if (record.updatedBy) view.updatedBy = record.updatedBy;
  return view;
}

function asStringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/** Parse a db-store document into a record (tolerant of missing optional fields). */
export function parseIntegrationRecord(
  id: string,
  data: Record<string, unknown>,
): IntegrationRecord | null {
  const integration =
    typeof data.integration === 'string' ? data.integration : '';
  const provider = typeof data.provider === 'string' ? data.provider : '';
  if (!integration || !provider) return null;
  const instanceId =
    typeof data.instanceId === 'string'
      ? data.instanceId
      : DEFAULT_INTEGRATION_INSTANCE;
  const settings =
    data.settings &&
    typeof data.settings === 'object' &&
    !Array.isArray(data.settings)
      ? { ...(data.settings as IntegrationSettings) }
      : {};
  const updatedAt =
    typeof data.updatedAt === 'string'
      ? data.updatedAt
      : new Date(0).toISOString();
  const record: IntegrationRecord = {
    id: typeof data.id === 'string' ? data.id : id,
    integration,
    instanceId,
    provider,
    settings,
    secretRefs: asStringMap(data.secretRefs),
    secretUpdatedAt: asStringMap(data.secretUpdatedAt),
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : updatedAt,
    updatedAt,
  };
  if (typeof data.updatedBy === 'string') record.updatedBy = data.updatedBy;
  return record;
}

function assertSettings(settings: IntegrationSettings): void {
  for (const key of Object.keys(settings)) {
    if (!isValidIntegrationField(key)) {
      throw new IntegrationError(`invalid settings field: ${key}`);
    }
  }
}

type CacheEntry<T> = { value: T; expiresAt: number };

export type ResolveProviderResult<T> =
  | { source: 'tenant'; provider: T; integration: ResolvedIntegration }
  | { source: 'platform'; provider: T };

export type ResolveProviderOptions = {
  instanceId?: string;
};

export type IntegrationsKitOptions = {
  /** Cache TTL for record lookups and built providers (default 30s). */
  ttlMs?: number;
  /** Clock override (tests). */
  now?: () => number;
};

export type IntegrationsKit = ReturnType<typeof createIntegrationsKit>;

/**
 * Integrations kit bound to a backend. One instance per process so the
 * in-process cache and invalidation are shared.
 */
export function createIntegrationsKit(
  backend: IntegrationsBackend,
  options: IntegrationsKitOptions = {},
) {
  const ttlMs = options.ttlMs ?? DEFAULT_INTEGRATION_CACHE_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const recordCache = new Map<string, CacheEntry<IntegrationRecord | null>>();
  const providerCache = new Map<string, CacheEntry<unknown>>();

  const recordCacheKey = (orgId: string, id: string) => `${orgId}\u0000${id}`;

  function invalidate(
    orgId?: string,
    integration?: string,
    instanceId?: string,
  ): void {
    if (!orgId) {
      recordCache.clear();
      providerCache.clear();
      return;
    }
    const prefix = integration
      ? recordCacheKey(
          orgId,
          instanceId ? integrationDocId(integration, instanceId) : integration,
        )
      : `${orgId}\u0000`;
    for (const cache of [recordCache, providerCache] as Map<
      string,
      unknown
    >[]) {
      for (const key of [...cache.keys()]) {
        if (key.startsWith(prefix)) cache.delete(key);
      }
    }
  }

  async function getRecord(
    orgId: string,
    integration: string,
    instanceId: string = DEFAULT_INTEGRATION_INSTANCE,
  ): Promise<IntegrationRecord | null> {
    assertIds(integration, instanceId);
    const id = integrationDocId(integration, instanceId);
    const key = recordCacheKey(orgId, id);
    const cached = recordCache.get(key);
    if (cached && cached.expiresAt > now()) return cached.value;
    const record = await backend.getRecord(orgId, id);
    recordCache.set(key, { value: record, expiresAt: now() + ttlMs });
    return record;
  }

  async function decryptRecord(
    orgId: string,
    record: IntegrationRecord,
  ): Promise<ResolvedIntegration> {
    const secrets: Record<string, string> = {};
    for (const [field, vaultKey] of Object.entries(record.secretRefs)) {
      const value = await backend.getSecret(orgId, vaultKey);
      if (value !== null) secrets[field] = value;
    }
    return {
      id: record.id,
      integration: record.integration,
      instanceId: record.instanceId,
      provider: record.provider,
      settings: { ...record.settings },
      secrets,
      updatedAt: record.updatedAt,
    };
  }

  async function announce(
    orgId: string,
    integration: string,
    instanceId: string,
    action: 'put' | 'delete',
    updatedAt: string,
  ): Promise<void> {
    invalidate(orgId, integration, instanceId);
    if (!backend.publish) return;
    try {
      await backend.publish(INTEGRATION_CHANGED_TOPIC, {
        orgId,
        integration,
        instanceId,
        action,
        updatedAt,
      });
    } catch {
      // Best-effort — TTL bounds staleness on other replicas.
    }
  }

  async function audit(
    orgId: string,
    entry: IntegrationAuditInput,
  ): Promise<void> {
    if (!backend.audit) return;
    try {
      await backend.audit(orgId, entry);
    } catch {
      // Best-effort — never fail the integration op.
    }
  }

  return {
    backend,

    /** Settings + decrypted secrets, or `null` → caller uses platform env. */
    async getIntegration(
      orgId: string,
      integration: string,
      instanceId: string = DEFAULT_INTEGRATION_INSTANCE,
    ): Promise<ResolvedIntegration | null> {
      const record = await getRecord(orgId, integration, instanceId);
      if (!record) return null;
      return decryptRecord(orgId, record);
    },

    /** Display-safe view (`{ field: { set, updatedAt } }` for secrets). */
    async describeIntegration(
      orgId: string,
      integration: string,
      instanceId: string = DEFAULT_INTEGRATION_INSTANCE,
    ): Promise<IntegrationView | null> {
      const record = await getRecord(orgId, integration, instanceId);
      return record ? toIntegrationView(record) : null;
    },

    async listIntegrations(
      orgId: string,
      integration?: string,
    ): Promise<IntegrationView[]> {
      if (integration && !isValidIntegrationId(integration)) {
        throw new IntegrationError(`invalid integration id: ${integration}`);
      }
      const records = await backend.listRecords(orgId, integration);
      return records
        .filter((r) => !integration || r.integration === integration)
        .map(toIntegrationView);
    },

    /** Write the non-secret record + vault secrets together. */
    async putIntegration(
      orgId: string,
      input: PutIntegrationInput,
    ): Promise<IntegrationView> {
      const instanceId = input.instanceId ?? DEFAULT_INTEGRATION_INSTANCE;
      assertIds(input.integration, instanceId);
      const provider =
        typeof input.provider === 'string' ? input.provider.trim() : '';
      if (!isValidProviderId(provider)) {
        throw new IntegrationError('valid provider required');
      }
      const settings = { ...(input.settings ?? {}) };
      assertSettings(settings);
      const secretInput = input.secrets ?? {};
      for (const field of Object.keys(secretInput)) {
        if (!isValidIntegrationField(field)) {
          throw new IntegrationError(`invalid secret field: ${field}`);
        }
        const value = secretInput[field];
        if (value !== null && (typeof value !== 'string' || !value)) {
          throw new IntegrationError(`secret ${field} must be a string`);
        }
      }

      const id = integrationDocId(input.integration, instanceId);
      const existing = await backend.getRecord(orgId, id);
      const stamp = new Date(now()).toISOString();
      const providerChanged = Boolean(
        existing && existing.provider !== provider,
      );

      const secretRefs: Record<string, string> = {};
      const secretUpdatedAt: Record<string, string> = {};
      const removed: string[] = [];
      if (existing) {
        for (const [field, vaultKey] of Object.entries(existing.secretRefs)) {
          const next = secretInput[field];
          if (next === null || (providerChanged && next === undefined)) {
            removed.push(field);
            await backend.deleteSecret(orgId, vaultKey);
            continue;
          }
          secretRefs[field] = vaultKey;
          const prior = existing.secretUpdatedAt[field];
          if (prior) secretUpdatedAt[field] = prior;
        }
      }
      const written: string[] = [];
      for (const [field, value] of Object.entries(secretInput)) {
        if (value === null) continue;
        const vaultKey = integrationSecretKey(
          input.integration,
          instanceId,
          field,
        );
        await backend.putSecret(orgId, vaultKey, value);
        secretRefs[field] = vaultKey;
        secretUpdatedAt[field] = stamp;
        written.push(field);
      }

      const record: IntegrationRecord = {
        id,
        integration: input.integration,
        instanceId,
        provider,
        settings,
        secretRefs,
        secretUpdatedAt,
        createdAt: existing?.createdAt ?? stamp,
        updatedAt: stamp,
      };
      if (input.updatedBy) record.updatedBy = input.updatedBy;
      await backend.putRecord(orgId, record);

      await announce(orgId, input.integration, instanceId, 'put', stamp);
      const auditEntry: IntegrationAuditInput = {
        action: 'integration.put',
        resource: id,
        meta: {
          integration: input.integration,
          instanceId,
          provider,
          settingsFields: Object.keys(settings),
          secretFieldsWritten: written,
          secretFieldsRemoved: removed,
        },
      };
      if (input.updatedBy) auditEntry.actor = input.updatedBy;
      await audit(orgId, auditEntry);
      return toIntegrationView(record);
    },

    /** Remove the record and every vault secret it references. */
    async deleteIntegration(
      orgId: string,
      integration: string,
      instanceId: string = DEFAULT_INTEGRATION_INSTANCE,
      actor?: string,
    ): Promise<{ deleted: boolean }> {
      assertIds(integration, instanceId);
      const id = integrationDocId(integration, instanceId);
      const existing = await backend.getRecord(orgId, id);
      if (!existing) {
        invalidate(orgId, integration, instanceId);
        return { deleted: false };
      }
      for (const vaultKey of Object.values(existing.secretRefs)) {
        await backend.deleteSecret(orgId, vaultKey);
      }
      const deleted = await backend.deleteRecord(orgId, id);
      const stamp = new Date(now()).toISOString();
      await announce(orgId, integration, instanceId, 'delete', stamp);
      const entry: IntegrationAuditInput = {
        action: 'integration.delete',
        resource: id,
        meta: {
          integration,
          instanceId,
          provider: existing.provider,
          secretFieldsRemoved: Object.keys(existing.secretRefs),
        },
      };
      if (actor) entry.actor = actor;
      await audit(orgId, entry);
      return { deleted };
    },

    /** Audit a "Test connection" attempt (provider + outcome only). */
    async recordIntegrationTest(
      orgId: string,
      input: {
        integration: string;
        instanceId?: string;
        provider: string;
        ok: boolean;
        source: 'tenant' | 'platform' | 'draft';
        actor?: string;
      },
    ): Promise<void> {
      const instanceId = input.instanceId ?? DEFAULT_INTEGRATION_INSTANCE;
      const entry: IntegrationAuditInput = {
        action: 'integration.test',
        resource: integrationDocId(input.integration, instanceId),
        meta: {
          integration: input.integration,
          instanceId,
          provider: input.provider,
          ok: input.ok,
          source: input.source,
        },
      };
      if (input.actor) entry.actor = input.actor;
      await audit(orgId, entry);
    },

    /**
     * Per-request provider resolution. Tenant config wins; otherwise the
     * platform env builder. Built providers are cached by
     * `orgId + integration + instance + updatedAt` with a short TTL.
     */
    async resolveProvider<T>(
      orgId: string | null | undefined,
      integration: string,
      buildFromConfig: (config: ResolvedIntegration) => T | Promise<T>,
      buildFromEnv: () => T | Promise<T>,
      resolveOptions: ResolveProviderOptions = {},
    ): Promise<ResolveProviderResult<T>> {
      const instanceId =
        resolveOptions.instanceId ?? DEFAULT_INTEGRATION_INSTANCE;
      const record = orgId
        ? await getRecord(orgId, integration, instanceId)
        : null;
      if (!orgId || !record) {
        return { source: 'platform', provider: await buildFromEnv() };
      }
      const key = `${recordCacheKey(orgId, record.id)}\u0000${record.updatedAt}`;
      const cached = providerCache.get(key) as
        | CacheEntry<{ provider: T; integration: ResolvedIntegration }>
        | undefined;
      if (cached && cached.expiresAt > now()) {
        return { source: 'tenant', ...cached.value };
      }
      const config = await decryptRecord(orgId, record);
      const provider = await buildFromConfig(config);
      const value = { provider, integration: config };
      providerCache.set(key, { value, expiresAt: now() + ttlMs });
      return { source: 'tenant', ...value };
    },

    /** Apply an `integration.changed` event from another replica. */
    handleChangedEvent(payload: unknown): void {
      if (!payload || typeof payload !== 'object') return;
      const p = payload as Partial<IntegrationChangedPayload>;
      if (typeof p.orgId !== 'string' || !p.orgId) return;
      invalidate(
        p.orgId,
        typeof p.integration === 'string' ? p.integration : undefined,
        typeof p.instanceId === 'string' ? p.instanceId : undefined,
      );
    },

    invalidate,
  };
}

function orgHeaders(orgId: string): Headers {
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set(ORG_ID_HEADER, orgId);
  return headers;
}

async function failure(res: Response, label: string): Promise<Error> {
  const detail = await res.text().catch(() => '');
  return new Error(
    `${label} failed (${res.status}): ${detail || res.statusText}`,
  );
}

export type HttpIntegrationsBackendOptions = {
  env?: EnvMap;
  /** db-store base (`http://127.0.0.1:6111` peer or gateway `/api/ext/db-store`). */
  dbStoreApiBase?: string;
  secretsApiBase?: string;
  /** Set to `null` to disable `integration.changed` publishing. */
  eventsApiBase?: string | null;
  /** Set to `null` to disable audit entries. */
  auditApiBase?: string | null;
};

/** Backend that talks to builtins db-store, secrets, events, and audit over HTTP. */
export function createHttpIntegrationsBackend(
  options: HttpIntegrationsBackendOptions = {},
): IntegrationsBackend {
  const env = options.env ?? Bun.env;
  const dbBase = (options.dbStoreApiBase ?? resolveDbStoreApiBase(env)).replace(
    /\/+$/,
    '',
  );
  const secretsBase = (
    options.secretsApiBase ?? resolveSecretsApiBase(env)
  ).replace(/\/+$/, '');
  const collection = `${dbBase}/collections/${encodeURIComponent(INTEGRATIONS_COLLECTION)}`;
  const secretUrl = (key: string) =>
    `${secretsBase}/secrets/${encodeURIComponent(key)}`;

  async function query(
    orgId: string,
    body: Record<string, unknown>,
  ): Promise<IntegrationRecord[]> {
    const res = await fetch(`${collection}/query`, {
      method: 'POST',
      headers: orgHeaders(orgId),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await failure(res, 'db-store query');
    const payload = (await res.json()) as {
      items?: Array<{ id: string; data: Record<string, unknown> }>;
    };
    const out: IntegrationRecord[] = [];
    for (const doc of payload.items ?? []) {
      const record = parseIntegrationRecord(doc.id, doc.data ?? {});
      if (record) out.push(record);
    }
    return out;
  }

  const backend: IntegrationsBackend = {
    async getRecord(orgId, id) {
      const [record] = await query(orgId, { where: { id }, limit: 1 });
      return record ?? null;
    },

    async listRecords(orgId, integration) {
      return query(orgId, {
        ...(integration ? { where: { integration } } : {}),
        sort: { createdAt: 'asc' },
        limit: 500,
      });
    },

    async putRecord(orgId, record) {
      const existing = await backend.getRecord(orgId, record.id);
      const data = { ...record } as Record<string, unknown>;
      const op = existing ? 'update' : 'insert';
      const res = await fetch(`${collection}/${op}`, {
        method: 'POST',
        headers: orgHeaders(orgId),
        body: JSON.stringify(
          existing
            ? { id: record.id, data, merge: false }
            : { id: record.id, data },
        ),
      });
      if (!res.ok) throw await failure(res, `db-store ${op}`);
    },

    async deleteRecord(orgId, id) {
      const res = await fetch(`${collection}/delete`, {
        method: 'POST',
        headers: orgHeaders(orgId),
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw await failure(res, 'db-store delete');
      const body = (await res.json()) as { deleted?: number };
      return (body.deleted ?? 0) > 0;
    },

    async getSecret(orgId, key) {
      const res = await fetch(secretUrl(key), {
        method: 'GET',
        headers: orgHeaders(orgId),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw await failure(res, 'secrets get');
      const body = (await res.json()) as { value?: unknown; source?: string };
      if (body.source !== 'vault' || typeof body.value !== 'string') {
        return null;
      }
      return body.value;
    },

    async putSecret(orgId, key, value) {
      const res = await fetch(secretUrl(key), {
        method: 'PUT',
        headers: orgHeaders(orgId),
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw await failure(res, 'secrets put');
    },

    async deleteSecret(orgId, key) {
      const res = await fetch(secretUrl(key), {
        method: 'DELETE',
        headers: orgHeaders(orgId),
      });
      if (res.status === 404) return;
      if (!res.ok) throw await failure(res, 'secrets delete');
    },
  };

  if (options.eventsApiBase !== null) {
    const eventsEnv: EnvMap = options.eventsApiBase
      ? { ...env, AGENT_OS_EVENTS_API_BASE: options.eventsApiBase }
      : env;
    backend.publish = async (topic, payload) => {
      await publish(topic, payload, eventsEnv);
    };
  }

  if (options.auditApiBase !== null) {
    const auditEnv: EnvMap = options.auditApiBase
      ? { ...env, AGENT_OS_AUDIT_API_BASE: options.auditApiBase }
      : env;
    backend.audit = async (orgId, entry) => {
      await appendEntry(entry, auditEnv, { orgId });
    };
  }

  return backend;
}

/** In-memory backend for tests and local demos. Exposes raw maps for assertions. */
export function createMemoryIntegrationsBackend(): IntegrationsBackend & {
  records: Map<string, IntegrationRecord>;
  vault: Map<string, string>;
  events: Array<{ topic: string; payload: IntegrationChangedPayload }>;
  auditLog: Array<{ orgId: string } & IntegrationAuditInput>;
} {
  const records = new Map<string, IntegrationRecord>();
  const vault = new Map<string, string>();
  const events: Array<{ topic: string; payload: IntegrationChangedPayload }> =
    [];
  const auditLog: Array<{ orgId: string } & IntegrationAuditInput> = [];
  const k = (orgId: string, id: string) => `${orgId}\u0000${id}`;
  const clone = (r: IntegrationRecord): IntegrationRecord =>
    JSON.parse(JSON.stringify(r)) as IntegrationRecord;

  return {
    records,
    vault,
    events,
    auditLog,
    async getRecord(orgId, id) {
      const r = records.get(k(orgId, id));
      return r ? clone(r) : null;
    },
    async listRecords(orgId, integration) {
      const out: IntegrationRecord[] = [];
      for (const [key, r] of records) {
        if (!key.startsWith(`${orgId}\u0000`)) continue;
        if (integration && r.integration !== integration) continue;
        out.push(clone(r));
      }
      return out;
    },
    async putRecord(orgId, record) {
      records.set(k(orgId, record.id), clone(record));
    },
    async deleteRecord(orgId, id) {
      return records.delete(k(orgId, id));
    },
    async getSecret(orgId, key) {
      return vault.get(k(orgId, key)) ?? null;
    },
    async putSecret(orgId, key, value) {
      vault.set(k(orgId, key), value);
    },
    async deleteSecret(orgId, key) {
      vault.delete(k(orgId, key));
    },
    async publish(topic, payload) {
      events.push({ topic, payload });
    },
    async audit(orgId, entry) {
      auditLog.push({ orgId, ...entry });
    },
  };
}

/**
 * Follow `integration.changed` over the events SSE stream and invalidate the
 * kit cache. Reconnects with a fixed delay until `signal` aborts.
 */
export function watchIntegrationChanges(
  kit: Pick<IntegrationsKit, 'handleChangedEvent'>,
  options: {
    env?: EnvMap;
    eventsApiBase?: string;
    signal?: AbortSignal;
    reconnectMs?: number;
  } = {},
): void {
  const base = (
    options.eventsApiBase ??
    resolveExtApiBase('events', 'AGENT_OS_EVENTS_API_BASE', options.env)
  ).replace(/\/+$/, '');
  const url = `${base}/subscribe?topic=${encodeURIComponent(INTEGRATION_CHANGED_TOPIC)}`;
  const reconnectMs = options.reconnectMs ?? 5_000;

  const run = async (): Promise<void> => {
    while (!options.signal?.aborted) {
      try {
        const res = await fetch(url, { signal: options.signal });
        if (res.ok && res.body) {
          const decoder = new TextDecoder();
          let buffer = '';
          const reader = res.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              for (const line of frame.split('\n')) {
                if (!line.startsWith('data:')) continue;
                try {
                  const msg = JSON.parse(line.slice(5).trim()) as {
                    topic?: string;
                    payload?: unknown;
                  };
                  if (msg.topic === INTEGRATION_CHANGED_TOPIC) {
                    kit.handleChangedEvent(msg.payload);
                  }
                } catch {
                  // ignore malformed frames
                }
              }
            }
          }
        }
      } catch {
        // reconnect below
      }
      if (options.signal?.aborted) return;
      await Bun.sleep(reconnectMs);
    }
  };
  void run();
}

export {
  createSessionOrgResolver,
  createSessionPermissionCheck,
  handleIntegrationRoutes,
  type IntegrationDefinition,
  type IntegrationOrgResult,
  type IntegrationFieldDefinition,
  type IntegrationProviderDefinition,
  type IntegrationRoutesContext,
  type IntegrationTestResult,
} from './integrations-routes';
