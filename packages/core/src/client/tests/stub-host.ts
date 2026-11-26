import type {
  EventPayload,
  HostAPIClient,
  StorageValue,
} from '@agentos/core/sdk';

/** Minimal in-memory HostAPI for client hook unit tests. */
export function createStubHost(
  store: Map<string, StorageValue> = new Map(),
  calls: string[] = [],
): HostAPIClient {
  return {
    storage: {
      get: async <T extends StorageValue>(key: string) => {
        calls.push(`storage.get:${key}`);
        return (store.get(key) as T | undefined) ?? null;
      },
      set: async (key, value) => {
        calls.push(`storage.set:${key}`);
        store.set(key, value);
      },
      remove: async (key) => {
        calls.push(`storage.remove:${key}`);
        store.delete(key);
      },
    },
    notifications: {
      show: async (message, type = 'info') => {
        calls.push(`notifications.show:${type}:${message}`);
      },
    },
    ai: {
      generateText: async (prompt) => {
        calls.push(`ai.generateText:${prompt}`);
        return { text: `echo:${prompt}` };
      },
    },
    hitl: {
      requestApproval: async (input) => {
        calls.push(`hitl.requestApproval:${input.title}`);
        return { approved: true, id: 'hitl-1' };
      },
    },
    api: {
      fetch: async (path) => {
        calls.push(`api.fetch:${path}`);
        return { ok: true, status: 200, body: '{}' };
      },
    },
    events: {
      publish: async (topic, _payload: EventPayload) => {
        calls.push(`events.publish:${topic}`);
      },
    },
    navigation: {
      openExternal: async (url, options) => {
        calls.push(
          `navigation.openExternal:${options?.sameTab ? 'same' : 'new'}:${url}`,
        );
      },
    },
    ui: {
      setRightSidebarOpen: async (open) => {
        calls.push(`ui.setRightSidebarOpen:${open}`);
      },
      toggleRightSidebar: async () => {
        calls.push('ui.toggleRightSidebar');
        return true;
      },
      isRightSidebarOpen: async () => {
        calls.push('ui.isRightSidebarOpen');
        return false;
      },
    },
  };
}
