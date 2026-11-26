import type { HostAPIClient } from '@agentos/core/sdk';
import { useHostApi } from './use-host-api';

/** The `{ ok, status, body }` shape every `host.api.fetch` call resolves to. */
export type HostResponse = { ok: boolean; status: number; body: string };

export type HostJsonResult<T> =
  | { ok: true; status: number; data: T; error: null }
  | { ok: false; status: number; data: null; error: string };

/**
 * Human message for a failed response body: `{ error }`, `{ message }`, the
 * plain-text body, or `fallback`. The single replacement for the per-extension
 * copies of this helper.
 */
export function parseErrorBody(body: string, fallback: string): string {
  try {
    const data = JSON.parse(body) as { error?: unknown; message?: unknown };
    if (typeof data.error === 'string' && data.error) return data.error;
    if (typeof data.message === 'string' && data.message) return data.message;
  } catch {
    // Not JSON: fall through to the raw body.
  }
  return body.trim() || fallback;
}

/**
 * Parse a `host.api.fetch` response as JSON. Never throws: a non-2xx status
 * or an unparsable body becomes `{ ok: false, error }`.
 */
export function parseHostJson<T>(
  res: HostResponse,
  fallback = 'Request failed',
): HostJsonResult<T> {
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      data: null,
      error: parseErrorBody(res.body, fallback),
    };
  }
  try {
    return {
      ok: true,
      status: res.status,
      data: JSON.parse(res.body) as T,
      error: null,
    };
  } catch {
    return {
      ok: false,
      status: res.status,
      data: null,
      error: 'Invalid response',
    };
  }
}

/** `host.api.fetch` + {@link parseHostJson} in one call. */
export async function hostJson<T>(
  api: HostAPIClient['api'],
  path: string,
  init?: Parameters<HostAPIClient['api']['fetch']>[1],
  fallback?: string,
): Promise<HostJsonResult<T>> {
  return parseHostJson<T>(await api.fetch(path, init), fallback);
}

/** Bound {@link hostJson}: `const json = useHostJson(); await json<T>('/x')`. */
export function useHostJson(): <T>(
  path: string,
  init?: Parameters<HostAPIClient['api']['fetch']>[1],
  fallback?: string,
) => Promise<HostJsonResult<T>> {
  const api = useHostApi();
  return (path, init, fallback) => hostJson(api, path, init, fallback);
}
