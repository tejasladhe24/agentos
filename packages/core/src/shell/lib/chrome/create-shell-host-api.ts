import type {
  HostAPI,
  HitlApprovalRequest,
  HitlApprovalResult,
  NotificationType,
  StorageValue,
} from '@agentos/core/sdk';
import { toast } from '@agentos/ui/components/toast';
import type { ShellEventBus } from './event-bus';
import {
  canPermission,
  extensionIdOfPath,
  filesBlobUrl,
  getEmailPreferences,
  mayCallExtension,
  sendNotification,
  setEmailPreferences,
} from './platform-capabilities';
import { waitForApproval } from './hitl-wait';
import { ensureEventsBridge, shellEventBus } from './shell-event-bus';
import { useShellStore } from './store';

/**
 * In-memory, session-only storage shared across HostAPI instances (keyed by
 * extension). Deliberately not `localStorage`: no org/user key is available to
 * scope it, so persisting could leak between users of one device.
 */
const storageByExtension = new Map<string, Map<string, StorageValue>>();

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
  extensionId: string,
): Promise<void> {
  try {
    await fetch('/api/ext/notifications/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ message, type, extensionId }),
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

  // Tell the user work is waiting and open the Approvals page (`/ext/hitl`).
  showNotification(`Approval needed: ${input.title}`, 'info');
  useShellStore.getState().setActiveView('hitl');

  ensureEventsBridge();
  return waitForApproval(id, {
    fetchStatus: async (approvalId) => {
      const res = await fetch(
        `/api/ext/hitl/approvals/${encodeURIComponent(approvalId)}`,
        { credentials: 'include' },
      );
      if (!res.ok) return null;
      const body = (await res.json()) as { status?: string };
      return body.status === 'approved' ||
        body.status === 'rejected' ||
        body.status === 'pending'
        ? body.status
        : null;
    },
    listenResolved: (onResolved) =>
      shellEventBus.listen(['hitl.resolved'], (_topic, payload) => {
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          const { approvalId, decision } = payload as Record<string, unknown>;
          if (typeof approvalId === 'string' && typeof decision === 'string') {
            onResolved({ approvalId, decision });
          }
        }
      }),
  });
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

export type CreateShellHostApiOptions = {
  /**
   * Identifies this frame on the event bus so subscriptions are dropped with
   * it. Defaults to `extensionId` (one implicit frame).
   */
  frameId?: string;
  /** Event bus (defaults to the Shell singleton; override in tests). */
  eventBus?: ShellEventBus;
  /**
   * Extensions this one may call by absolute `/api/ext/<id>/…` path. Defaults
   * to the registry's `meta.json` `dependsOn` for `extensionId`.
   */
  dependsOn?: readonly string[];
};

/**
 * HostAPI for shell iframe hosting. Notifications toast locally and fan out to
 * the notifications builtin; HITL hits its builtin; events go through the
 * Shell-brokered bus (declarations enforced from `meta.json`).
 */
export function createShellHostApi(
  extensionId: string,
  options: CreateShellHostApiOptions = {},
): HostAPI {
  const store = storageFor(extensionId);
  const frameId = options.frameId ?? extensionId;
  const bus = options.eventBus ?? shellEventBus;

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
        void fanOutNotification(message, type, extensionId);
      },
      send: async (input) => sendNotification(input),
      getEmailPreferences: async () => getEmailPreferences(),
      setEmailPreferences: async (from) => setEmailPreferences(from),
    },
    auth: {
      can: async (permission) => canPermission(permission),
    },
    files: {
      blobUrl: async (key) => filesBlobUrl(key),
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
        // Absolute gateway paths reach another extension only when this one
        // declared it in `meta.json` `dependsOn`.
        if (normalized.startsWith('/api/ext/')) {
          const target = extensionIdOfPath(normalized);
          const dependsOn =
            options.dependsOn ??
            useShellStore
              .getState()
              .extensions.find((e) => e.id === extensionId)?.dependsOn;
          if (
            target === null ||
            !mayCallExtension(extensionId, target, dependsOn)
          ) {
            return {
              ok: false,
              status: 403,
              body: JSON.stringify({
                error: `Extension "${extensionId}" may not call "${target ?? normalized}"; declare it in meta.json dependsOn.`,
              }),
            };
          }
        }
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
        bus.assertCanPublish(extensionId, topic);
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
      publishLocal: async (topic, payload) => {
        bus.publishLocal(extensionId, topic, payload, frameId);
      },
      subscribe: async (topics) => bus.subscribe(frameId, extensionId, topics),
      unsubscribe: async (subscriptionId) => {
        bus.unsubscribe(frameId, subscriptionId);
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
    ui: {
      setRightSidebarOpen: async (open) => {
        useShellStore.getState().setRightSidebarOpen(open);
      },
      toggleRightSidebar: async () => {
        useShellStore.getState().toggleRightSidebar();
        return useShellStore.getState().rightSidebarOpen;
      },
      isRightSidebarOpen: async () => useShellStore.getState().rightSidebarOpen,
      openRightSheet: async (targetId) => {
        useShellStore.getState().openRightSheet(targetId ?? extensionId);
      },
      closeRightSheet: async () => {
        useShellStore.getState().closeRightSheet();
      },
      toggleRightSheet: async (targetId) => {
        useShellStore.getState().toggleRightSheet(targetId ?? extensionId);
        return useShellStore.getState().activeRightSheet;
      },
      getActiveRightSheet: async () =>
        useShellStore.getState().activeRightSheet,
    },
  };
}
