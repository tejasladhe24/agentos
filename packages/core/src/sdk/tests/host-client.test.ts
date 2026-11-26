import { describe, expect, test } from 'bun:test';
import * as Comlink from 'comlink';
import {
  connectExtensionHost,
  HANDSHAKE,
  hostApiFromRemote,
  proxyHostApi,
  type ExtensionAPI,
  type ExtensionContentWindow,
  type HandshakeIncomingMessage,
  type HandshakeMessageTarget,
  type HostAPI,
  type HostAPIClient,
  type StorageValue,
} from '@agentos/core/sdk';

type MessageListener = (event: HandshakeIncomingMessage) => void;

interface FakeParentWindow extends HandshakeMessageTarget {
  postMessage(
    data: HandshakeIncomingMessage['data'],
    origin?: string,
    transfer?: Transferable[],
  ): void;
}

interface FakeChildWindow extends ExtensionContentWindow {
  parent: FakeParentWindow;
  addEventListener(type: 'message', listener: MessageListener): void;
  removeEventListener(type: 'message', listener: MessageListener): void;
}

/** Minimal linked windows implementing handshake contracts (no DOM casts). */
function createLinkedWindows(): {
  parent: FakeParentWindow;
  child: FakeChildWindow;
} {
  const parentListeners = new Set<MessageListener>();
  const childListeners = new Set<MessageListener>();

  const portsOf = (transfer?: Transferable[]): MessagePort[] =>
    (transfer ?? []).filter((t): t is MessagePort => t instanceof MessagePort);

  // Holder so parent/child closures can reference each other without `let` reassignment.
  const pair: {
    parent?: FakeParentWindow;
    child?: FakeChildWindow;
  } = {};

  pair.parent = {
    setTimeout: (handler, timeout) => globalThis.setTimeout(handler, timeout),
    clearTimeout: (id) => {
      globalThis.clearTimeout(id);
    },
    addEventListener(type, listener) {
      if (type === 'message') parentListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'message') parentListeners.delete(listener);
    },
    postMessage(data, _origin, transfer) {
      const event: HandshakeIncomingMessage = {
        data,
        source: pair.child!,
        ports: portsOf(transfer),
      };
      for (const listener of parentListeners) listener(event);
    },
  };

  pair.child = {
    parent: pair.parent,
    addEventListener(type, listener) {
      if (type === 'message') childListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'message') childListeners.delete(listener);
    },
    postMessage(message, _origin, transfer) {
      const event: HandshakeIncomingMessage = {
        data: message,
        source: pair.parent!,
        ports: portsOf(transfer),
      };
      for (const listener of childListeners) listener(event);
    },
  };

  return { parent: pair.parent, child: pair.child };
}

function stubHostApi(store: Map<string, StorageValue>): HostAPI {
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
    notifications: { show: async () => {} },
    ai: { generateText: async () => ({ text: 'ok' }) },
    hitl: {
      requestApproval: async () => ({ approved: true, id: 'a1' }),
    },
    api: {
      fetch: async () => ({ ok: true, status: 200, body: '{}' }),
    },
    events: { publish: async () => {} },
    navigation: { openExternal: async () => {} },
    ui: {
      setRightSidebarOpen: async () => {},
      toggleRightSidebar: async () => false,
      isRightSidebarOpen: async () => false,
      openRightSheet: async () => {},
      closeRightSheet: async () => {},
      toggleRightSheet: async () => null,
      getActiveRightSheet: async () => null,
    },
  };
}

describe('dual MessageChannel handshake', () => {
  test('host + client ports exchange HostAPI and ExtensionAPI', async () => {
    const store = new Map<string, StorageValue>();
    store.set('n', 42);
    const activated: string[] = [];

    const hostChannel = new MessageChannel();
    const extChannel = new MessageChannel();

    const hostApi = proxyHostApi(stubHostApi(store));
    Comlink.expose(hostApi, hostChannel.port1);
    const remoteExt = Comlink.wrap<ExtensionAPI>(extChannel.port1);

    const extensionApi: ExtensionAPI = {
      onActivate: async () => {
        activated.push('on');
      },
      onDeactivate: async () => {},
      onEvent: async () => {},
    };
    Comlink.expose(extensionApi, extChannel.port2);
    const remoteHost: HostAPIClient = hostApiFromRemote(
      Comlink.wrap<HostAPI>(hostChannel.port2),
    );

    await expect(remoteHost.storage.get<number>('n')).resolves.toBe(42);
    await remoteExt.onActivate();
    expect(activated).toEqual(['on']);

    remoteExt[Comlink.releaseProxy]();
    hostChannel.port1.close();
    hostChannel.port2.close();
    extChannel.port1.close();
    extChannel.port2.close();
  });

  test('connectExtensionHost completes READY → HOST_ACK → PORT_READY', async () => {
    const { parent, child } = createLinkedWindows();
    const store = new Map<string, StorageValue>();
    store.set('greeting', 'hello');

    let hostFromClient: HostAPIClient | null = null;
    const activated: string[] = [];

    child.addEventListener('message', (event) => {
      if (
        !event.data ||
        typeof event.data !== 'object' ||
        !('type' in event.data) ||
        event.data.type !== HANDSHAKE.HOST_ACK
      ) {
        return;
      }
      const [hostPort, extensionPort] = event.ports;
      if (!hostPort || !extensionPort) return;

      hostFromClient = hostApiFromRemote(Comlink.wrap<HostAPI>(hostPort));
      Comlink.expose(
        {
          onActivate: async () => {
            activated.push('activate');
          },
          onDeactivate: async () => {},
          onEvent: async () => {},
        } satisfies ExtensionAPI,
        extensionPort,
      );
      parent.postMessage({ type: HANDSHAKE.PORT_READY });
    });

    const connection = await connectExtensionHost({
      contentWindow: child,
      hostApi: stubHostApi(store),
      messageTarget: parent,
      handshakeTimeoutMs: 2000,
    });

    await connection.remote.onActivate();
    expect(activated).toEqual(['activate']);
    expect(hostFromClient).not.toBeNull();
    await expect(hostFromClient!.storage.get<string>('greeting')).resolves.toBe(
      'hello',
    );

    connection.dispose();
  });
});
