import type {
  EventPayload,
  HostAPIClient,
  StorageValue,
} from '@agentos/core/sdk';

/** True when this document is nested under the Shell (not a top-level tab). */
export function isShellIframe(): boolean {
  return typeof window !== 'undefined' && window.parent !== window;
}

/**
 * No-op HostAPI for opening `/__agentos/ext/...html` as a top-level tab.
 * Production path is always the sandboxed iframe + real Comlink handshake.
 */
export function createStandaloneHost(): HostAPIClient {
  const store = new Map<string, StorageValue>();
  return {
    storage: {
      get: async <T extends StorageValue>(key: string) =>
        (store.get(key) as T | undefined) ?? null,
      set: async (key, value) => {
        store.set(key, value);
      },
      remove: async (key) => {
        store.delete(key);
      },
    },
    notifications: {
      show: async () => {},
    },
    ai: {
      generateText: async (prompt) => ({ text: `standalone:${prompt}` }),
    },
    hitl: {
      requestApproval: async () => ({ approved: false, id: 'standalone' }),
    },
    api: {
      fetch: async () => ({
        ok: false,
        status: 503,
        body: '{"error":"standalone preview — open via Shell iframe"}',
      }),
    },
    events: {
      publish: async (_topic: string, _payload: EventPayload) => {},
    },
    navigation: {
      openExternal: async () => {},
    },
    ui: {
      setRightSidebarOpen: async () => {},
      toggleRightSidebar: async () => false,
      isRightSidebarOpen: async () => false,
    },
  };
}
