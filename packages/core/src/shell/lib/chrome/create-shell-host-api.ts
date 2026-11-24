import type {
  HostAPI,
  HitlApprovalRequest,
  HitlApprovalResult,
  NotificationType,
  StorageValue,
} from '@agentos/core/sdk';
import { toast } from '@agentos/ui/components/toast';
import { useShellStore } from './store';

/** In-memory storage shared across HostAPI instances (keyed by extension). */
const storageByExtension = new Map<string, Map<string, StorageValue>>();

const HITL_POLL_MS = 250;
const HITL_POLL_MAX_MS = 5 * 60 * 1000;

function storageFor(extensionId: string): Map<string, StorageValue> {
  let store = storageByExtension.get(extensionId);
  if (!store) {
    store = new Map();
    storageByExtension.set(extensionId, store);
  }
  return store;
}

/** Clears stub storage (tests only). */
export function resetShellHostApiStorage(): void {
  storageByExtension.clear();
}

function showNotification(
  message: string,
  type: NotificationType = 'info',
): void {
  toast.add({
    title: message,
    type,
  });
  useShellStore.getState().setStatusText(message, type);
}

async function fanOutNotification(
  message: string,
  type: NotificationType,
): Promise<void> {
  try {
    await fetch('/api/ext/notifications/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ message, type }),
    });
  } catch {
    // Toast path already succeeded; fan-out is best-effort.
  }
}

async function requestHitlApproval(
  input: HitlApprovalRequest,
): Promise<HitlApprovalResult> {
  const createRes = await fetch('/api/ext/hitl/approvals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      title: input.title,
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    }),
  });
  if (!createRes.ok) {
    const detail = await createRes.text();
    throw new Error(detail || `HITL create failed (${createRes.status})`);
  }
  const created = (await createRes.json()) as { id?: string; status?: string };
  if (typeof created.id !== 'string' || !created.id) {
    throw new Error('HITL create returned no id');
  }
  const id = created.id;

  // Surface pending work in the Shell inbox.
  useShellStore.getState().setSidebarPanel('hitl');

  const deadline = Date.now() + HITL_POLL_MAX_MS;
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, HITL_POLL_MS);
    });
    const allRes = await fetch('/api/ext/hitl/approvals', {
      credentials: 'include',
    });
    if (!allRes.ok) continue;
    const body = (await allRes.json()) as {
      approvals?: Array<{ id: string; status: string }>;
    };
    const found = body.approvals?.find((a) => a.id === id);
    if (!found) continue;
    if (found.status === 'approved') {
      return { approved: true, id };
    }
    if (found.status === 'rejected') {
      return { approved: false, id };
    }
  }
  throw new Error(`HITL approval timed out for ${id}`);
}

/** Only absolute http(s) URLs leave the sandbox (no `javascript:` / `data:`). */
export function externalUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('navigation.openExternal requires an absolute URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('navigation.openExternal only opens http(s) URLs');
  }
  return url.toString();
}

/**
 * HostAPI for shell iframe hosting. Notifications toast locally and fan out to
 * the notifications builtin; HITL / events hit supporting builtins.
 */
export function createShellHostApi(extensionId: string): HostAPI {
  const store = storageFor(extensionId);

  return {
    storage: {
      get: async <T extends StorageValue>(key: string) => {
        const value = store.get(key);
        return (value as T | undefined) ?? null;
      },
      set: async (key, value) => {
        store.set(key, value);
      },
      remove: async (key) => {
        store.delete(key);
      },
    },
    notifications: {
      show: async (message, type = 'info') => {
        showNotification(message, type);
        void fanOutNotification(message, type);
      },
    },
    ai: {
      generateText: async (prompt, options) => {
        const res = await fetch('/api/ext/ai/generate-text', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            prompt,
            ...(options?.model ? { model: options.model } : {}),
            ...(options?.temperature != null
              ? { temperature: options.temperature }
              : {}),
            ...(options?.maxTokens != null
              ? { maxTokens: options.maxTokens }
              : {}),
          }),
        });
        if (!res.ok) {
          const detail = await res.text();
          throw new Error(detail || `AI generateText failed (${res.status})`);
        }
        const body = (await res.json()) as { text?: string };
        return { text: typeof body.text === 'string' ? body.text : '' };
      },
    },
    hitl: {
      requestApproval: async (input) => requestHitlApproval(input),
    },
    api: {
      fetch: async (path, init) => {
        const normalized = path.startsWith('/') ? path : `/${path}`;
        // Absolute gateway paths let Email UI call notifications/files/auth.
        const url = normalized.startsWith('/api/ext/')
          ? normalized
          : `/api/ext/${encodeURIComponent(extensionId)}${normalized}`;
        const res = await fetch(url, {
          method: init?.method ?? 'GET',
          headers: init?.headers,
          body: init?.body,
          credentials: 'include',
        });
        return {
          ok: res.ok,
          status: res.status,
          body: await res.text(),
        };
      },
    },
    events: {
      publish: async (topic, payload) => {
        const res = await fetch('/api/ext/events/publish', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ topic, payload }),
        });
        if (!res.ok) {
          const detail = await res.text();
          throw new Error(detail || `events.publish failed (${res.status})`);
        }
      },
    },
    navigation: {
      openExternal: async (url, options) => {
        const target = externalUrl(url);
        if (options?.sameTab) {
          window.location.assign(target);
          return;
        }
        window.open(target, '_blank', 'noopener,noreferrer');
      },
    },
  };
}
