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
});
