import type {
  EmailPreferences,
  NotificationDelivery,
  NotificationSendInput,
} from '@agentos/core/sdk';
import { useShellStore } from './store';

/** Gateway bases for the builtins the Shell fronts on behalf of extension UIs. */
const AUTH_BASE = '/api/ext/auth';
const NOTIFICATIONS_BASE = '/api/ext/notifications';
const FILES_BASE = '/api/ext/files';

/** Pull `{ error | message }` out of a JSON error body, else `fallback`. */
export function errorMessageFromBody(body: string, fallback: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === 'string' && parsed.error) return parsed.error;
    if (typeof parsed.message === 'string' && parsed.message) {
      return parsed.message;
    }
  } catch {
    // non-JSON body
  }
  return body.trim() || fallback;
}

async function jsonRequest(
  url: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  return fetch(url, {
    method: init.method ?? 'GET',
    headers:
      init.body === undefined
        ? undefined
        : { 'content-type': 'application/json' },
    credentials: 'include',
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

// ── auth.can ────────────────────────────────────────────────────────────────

/** `roles|permission` → decision; the roles in the key scope it to the session. */
const permissionCache = new Map<string, Promise<boolean>>();

/** Clears cached permission decisions (tests, sign-out). */
export function resetPermissionCache(): void {
  permissionCache.clear();
}

async function checkPermission(permission: string): Promise<boolean> {
  const res = await jsonRequest(`${AUTH_BASE}/permissions/check`, {
    method: 'POST',
    body: { permission },
  });
  if (res.status === 401) return false;
  if (!res.ok) {
    throw new Error(
      errorMessageFromBody(await res.text(), `auth.can failed (${res.status})`),
    );
  }
  try {
    return ((await res.json()) as { allowed?: boolean }).allowed === true;
  } catch {
    throw new Error('auth.can returned an invalid response');
  }
}

/**
 * Cached permission check. Only successful decisions are cached, so an
 * unreachable auth service is retried on the next call. Switching session
 * (sign-out/in, role change) changes the cache key.
 */
export function canPermission(permission: string): Promise<boolean> {
  const roles = useShellStore.getState().sessionRoles;
  const key = `${roles === null ? '*' : [...roles].sort().join(',')}|${permission}`;
  let entry = permissionCache.get(key);
  if (!entry) {
    entry = checkPermission(permission);
    permissionCache.set(key, entry);
    entry.catch(() => {
      if (permissionCache.get(key) === entry) permissionCache.delete(key);
    });
  }
  return entry;
}

// ── notifications ──────────────────────────────────────────────────────────

export async function sendNotification(
  input: NotificationSendInput,
): Promise<NotificationDelivery> {
  const res = await jsonRequest(`${NOTIFICATIONS_BASE}/notify`, {
    method: 'POST',
    body: input,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(errorMessageFromBody(text, 'Send failed'));
  let parsed: { notification?: NotificationDelivery };
  try {
    parsed = JSON.parse(text) as { notification?: NotificationDelivery };
  } catch {
    throw new Error('Invalid notification response');
  }
  if (!parsed.notification) throw new Error('Invalid notification response');
  return parsed.notification;
}

async function readEmailPreferences(res: Response): Promise<EmailPreferences> {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      errorMessageFromBody(text, 'Could not load sender address.'),
    );
  }
  let parsed: Partial<EmailPreferences>;
  try {
    parsed = JSON.parse(text) as Partial<EmailPreferences>;
  } catch {
    throw new Error('Invalid sender preference response.');
  }
  return { from: parsed.from ?? null, orgFrom: parsed.orgFrom ?? null };
}

export async function getEmailPreferences(): Promise<EmailPreferences> {
  return readEmailPreferences(
    await jsonRequest(`${NOTIFICATIONS_BASE}/preferences/email`),
  );
}

export async function setEmailPreferences(
  from: string | null,
): Promise<EmailPreferences> {
  return readEmailPreferences(
    await jsonRequest(`${NOTIFICATIONS_BASE}/preferences/email`, {
      method: 'PUT',
      body: { from },
    }),
  );
}

// ── files ──────────────────────────────────────────────────────────────────

/** Same-origin download URL for a blob key or `files://` reference. */
export function filesBlobUrl(key: string): string {
  return `${FILES_BASE}/blobs/${encodeURIComponent(key)}`;
}

// ── api.fetch allowlist ────────────────────────────────────────────────────

/** Extension id in an absolute `/api/ext/<id>/…` gateway path, else `null`. */
export function extensionIdOfPath(path: string): string | null {
  const match = /^\/api\/ext\/([^/?#]+)/.exec(path);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return match[1]!;
  }
}

/**
 * An extension UI may call its own API, or another extension it declared in
 * `meta.json` `dependsOn`. Everything else is a hidden coupling and is refused.
 */
export function mayCallExtension(
  callerId: string,
  targetId: string,
  dependsOn: readonly string[] | undefined,
): boolean {
  return targetId === callerId || (dependsOn?.includes(targetId) ?? false);
}
