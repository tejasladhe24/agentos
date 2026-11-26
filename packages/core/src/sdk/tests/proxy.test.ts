import { describe, expect, test } from 'bun:test';
import * as Comlink from 'comlink';
import {
  hostApiFromRemote,
  proxyHostApi,
  type HostAPI,
  type HostAPIClient,
  type StorageValue,
} from '@agentos/core/sdk';

function stubHostApi(calls: string[]): HostAPI {
  return {
    storage: {
      get: async <T extends StorageValue>(key: string): Promise<T | null> => {
        calls.push(`get:${key}`);
        const value: StorageValue = { v: 1 };
        return value as T & StorageValue;
      },
      set: async () => {},
      remove: async () => {},
    },
    notifications: {
      show: async (message, type = 'info') => {
        calls.push(`show:${message}:${type}`);
      },
    },
    ai: {
      generateText: async () => ({ text: '' }),
    },
    hitl: {
      requestApproval: async () => ({ approved: true, id: '1' }),
    },
    api: {
      fetch: async () => ({ ok: true, status: 200, body: '' }),
    },
    events: {
      publish: async () => {},
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

describe('proxyHostApi', () => {
  test('nested namespaces remain callable across a MessageChannel', async () => {
    const calls: string[] = [];
    const proxied = proxyHostApi(stubHostApi(calls));
    const channel = new MessageChannel();
    Comlink.expose(proxied, channel.port1);
    const remote: HostAPIClient = hostApiFromRemote(
      Comlink.wrap<HostAPI>(channel.port2),
    );

    await expect(remote.storage.get('k')).resolves.toEqual({ v: 1 });
    await remote.notifications.show('hi', 'success');
    expect(calls).toEqual(['get:k', 'show:hi:success']);

    channel.port1.close();
    channel.port2.close();
  });

  test('slow calls survive garbage collection of the namespace proxy', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stub = stubHostApi([]);
    stub.api.fetch = async () => {
      await gate;
      return { ok: true, status: 200, body: 'slow' };
    };
    const channel = new MessageChannel();
    Comlink.expose(proxyHostApi(stub), channel.port1);
    const remote = hostApiFromRemote(Comlink.wrap<HostAPI>(channel.port2));

    const pending = remote.api.fetch('/slow');
    for (let i = 0; i < 5; i++) {
      await Bun.sleep(20);
      Bun.gc(true);
    }
    release();

    const result = await Promise.race([
      pending,
      Bun.sleep(2000).then(() => 'hung' as const),
    ]);
    expect(result).toEqual({ ok: true, status: 200, body: 'slow' });
    // The client stays referenced for the frame's lifetime (HostContext).
    expect(remote.api).toBeDefined();

    channel.port1.close();
    channel.port2.close();
  });
});
