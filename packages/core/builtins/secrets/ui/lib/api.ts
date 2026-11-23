import type { SecretListResult, SecretsHealth } from './types';

export type HostApiFetch = (
  path: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{ ok: boolean; status: number; body: string }>;

export function parseErrorBody(body: string, fallback: string): string {
  try {
    const data = JSON.parse(body) as { error?: string; message?: string };
    if (typeof data.error === 'string' && data.error) return data.error;
    if (typeof data.message === 'string' && data.message) return data.message;
  } catch {
    // ignore
  }
  return body.trim() || fallback;
}

export async function fetchHealth(api: HostApiFetch): Promise<SecretsHealth> {
  const res = await api('/health');
  if (!res.ok) {
    throw new Error(
      parseErrorBody(res.body, `Health check failed (${res.status})`),
    );
  }
  return JSON.parse(res.body) as SecretsHealth;
}

export async function fetchSecretList(
  api: HostApiFetch,
): Promise<
  | { ok: true; data: SecretListResult }
  | { ok: false; status: number; message: string }
> {
  const res = await api('/secrets');
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: parseErrorBody(
        res.body,
        res.status === 403
          ? 'Missing secrets.read permission'
          : `Failed to list secrets (${res.status})`,
      ),
    };
  }
  return { ok: true, data: JSON.parse(res.body) as SecretListResult };
}

export async function putVaultSecret(
  api: HostApiFetch,
  key: string,
  input: { value: string; expiresAt?: string },
): Promise<void> {
  const res = await api(`/secrets/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(
      parseErrorBody(res.body, `Failed to save secret (${res.status})`),
    );
  }
}

export async function deleteVaultSecret(
  api: HostApiFetch,
  key: string,
): Promise<void> {
  const res = await api(`/secrets/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(
      parseErrorBody(res.body, `Failed to delete secret (${res.status})`),
    );
  }
}

export async function revealVaultSecret(
  api: HostApiFetch,
  key: string,
): Promise<string> {
  const res = await api(`/secrets/${encodeURIComponent(key)}`);
  if (!res.ok) {
    throw new Error(
      parseErrorBody(res.body, `Failed to reveal secret (${res.status})`),
    );
  }
  const data = JSON.parse(res.body) as { value?: string };
  if (typeof data.value !== 'string') {
    throw new Error('Secret value missing from response');
  }
  return data.value;
}
