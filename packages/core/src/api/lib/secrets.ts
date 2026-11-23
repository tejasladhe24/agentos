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

export type SecretValue = {
  key: string;
  value: string;
  rotatedAt?: string;
  expiresAt?: string;
  version?: number;
  source?: 'env' | 'vault';
};

export type SecretMeta = {
  key: string;
  rotatedAt: string;
  version: number;
  expiresAt?: string;
};

export type SecretsCallInit = {
  /** Forward cookie / auth headers from the inbound FDE request. */
  headers?: HeadersInit;
  /** Active org id sent as `X-AgentOS-Org-Id` (peer / service path). */
  orgId?: string;
};

function secretsHeaders(init?: SecretsCallInit): Headers {
  const headers = new Headers(init?.headers);
  if (init?.orgId) {
    headers.set(SECRETS_ORG_ID_HEADER, init.orgId);
  }
  return headers;
}

/** Fetch a secret by key (vault first when org context present, else env). */
export async function getSecret(
  key: string,
  env?: EnvMap,
  init?: SecretsCallInit,
): Promise<SecretValue> {
  const base = resolveSecretsApiBase(env ?? Bun.env);
  return jsonFetch<SecretValue>(
    `${base}/secrets/${encodeURIComponent(key)}`,
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
    `${base}/secrets/${encodeURIComponent(key)}`,
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
    `${base}/secrets/${encodeURIComponent(key)}`,
    {
      method: 'DELETE',
      headers: secretsHeaders(init),
    },
    'secrets deleteSecret',
  );
}
