/**
 * @agentos/core/api/secrets — HTTP client for builtin `secrets` (tickets 23, 77).
 */

import { jsonFetch, resolveExtApiBase, type EnvMap } from './http';

/** Resolve builtin secrets API base (`…/api/ext/secrets` or test override). */
export function resolveSecretsApiBase(env: EnvMap = Bun.env): string {
  return resolveExtApiBase('secrets', 'AGENT_OS_SECRETS_API_BASE', env);
}

/** Trusted peer / FDE header for active org (matches secrets + db-store). */
export const SECRETS_ORG_ID_HEADER = 'x-agentos-org-id';

/** Trusted peer header naming the user a service acts for (ticket 104). */
export const SECRETS_USER_ID_HEADER = 'x-agentos-user-id';

export type SecretValue = {
  key: string;
  value: string;
  rotatedAt?: string;
  expiresAt?: string;
  version?: number;
  source?: 'env' | 'vault';
  ownerUserId?: string;
};

export type SecretMeta = {
  key: string;
  rotatedAt: string;
  version: number;
  expiresAt?: string;
  ownerUserId?: string;
};

/** Metadata row from `GET /secrets` — never includes plaintext. */
export type SecretListItem = {
  key: string;
  updatedAt?: string;
  expiresAt?: string;
  hasValue: true;
  /** Reserved `integrations/` key — managed by the integrations kit. */
  managed?: true;
};

export type SecretListResult = {
  orgId: string;
  canWrite: boolean;
  keys: SecretListItem[];
};

export type SecretsCallInit = {
  /** Forward cookie / auth headers from the inbound FDE request. */
  headers?: HeadersInit;
  /** Active org id sent as `X-AgentOS-Org-Id` (peer / service path). */
  orgId?: string;
  /**
   * Address a user-owned secret. Session callers must be this user; peer
   * callers also send it as `X-AgentOS-User-Id`. Only forward the user of the
   * current request — never from background jobs.
   */
  ownerUserId?: string;
};

function secretsHeaders(init?: SecretsCallInit): Headers {
  const headers = new Headers(init?.headers);
  if (init?.orgId) {
    headers.set(SECRETS_ORG_ID_HEADER, init.orgId);
  }
  if (init?.ownerUserId) {
    headers.set(SECRETS_USER_ID_HEADER, init.ownerUserId);
  }
  return headers;
}

function secretUrl(base: string, key: string, init?: SecretsCallInit): string {
  const url = `${base}/secrets/${encodeURIComponent(key)}`;
  return init?.ownerUserId
    ? `${url}?ownerUserId=${encodeURIComponent(init.ownerUserId)}`
    : url;
}

/** List org-owned vault secret metadata (no plaintext; user-owned excluded). */
export async function listSecrets(
  env?: EnvMap,
  init?: SecretsCallInit,
): Promise<SecretListResult> {
  const base = resolveSecretsApiBase(env ?? Bun.env);
  return jsonFetch<SecretListResult>(
    `${base}/secrets`,
    { method: 'GET', headers: secretsHeaders(init) },
    'secrets listSecrets',
  );
}

/** Fetch a secret by key (vault first when org context present, else env). */
export async function getSecret(
  key: string,
  env?: EnvMap,
  init?: SecretsCallInit,
): Promise<SecretValue> {
  const base = resolveSecretsApiBase(env ?? Bun.env);
  return jsonFetch<SecretValue>(
    secretUrl(base, key, init),
    { method: 'GET', headers: secretsHeaders(init) },
    'secrets getSecret',
  );
}

/** Encrypt and store a secret for the active org. Does not return the value. */
export async function putSecret(
  key: string,
  input: { value: string; expiresAt?: string },
  env?: EnvMap,
  init?: SecretsCallInit,
): Promise<SecretMeta> {
  const base = resolveSecretsApiBase(env ?? Bun.env);
  return jsonFetch<SecretMeta>(
    secretUrl(base, key, init),
    {
      method: 'PUT',
      body: input,
      headers: secretsHeaders(init),
    },
    'secrets putSecret',
  );
}

/** Delete a vault secret for the active org. */
export async function deleteSecret(
  key: string,
  env?: EnvMap,
  init?: SecretsCallInit,
): Promise<{ key: string; deleted: boolean }> {
  const base = resolveSecretsApiBase(env ?? Bun.env);
  return jsonFetch<{ key: string; deleted: boolean }>(
    secretUrl(base, key, init),
    {
      method: 'DELETE',
      headers: secretsHeaders(init),
    },
    'secrets deleteSecret',
  );
}

export type PurgeUserSecretsResult = {
  orgId: string;
  userId: string;
  deleted: number;
};

/**
 * Delete every user-owned secret of `userId` in `orgId` (member offboarding).
 * Trusted peer only; publishes `secrets.user_purged`.
 */
export async function purgeUserSecrets(
  userId: string,
  orgId: string,
  env?: EnvMap,
): Promise<PurgeUserSecretsResult> {
  const base = resolveSecretsApiBase(env ?? Bun.env);
  return jsonFetch<PurgeUserSecretsResult>(
    `${base}/users/${encodeURIComponent(userId)}/purge`,
    { method: 'POST', headers: secretsHeaders({ orgId }) },
    'secrets purgeUserSecrets',
  );
}
