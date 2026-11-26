import * as Comlink from 'comlink';
import { fromDomMessageEvent, type EventPayload } from './contracts';
import { HANDSHAKE, isHandshakeType } from './handshake';
import {
  HandshakeTimeoutError,
  type ExtensionAPI,
  type HostAPI,
  type HostAPIClient,
} from './types';

export type { HostAPIClient } from './types';

export interface ExtensionClientOptions {
  /** Partial ExtensionAPI implementation; missing hooks become no-ops. */
  api: Partial<ExtensionAPI>;
  /** Milliseconds to wait for host acknowledgement before rejecting. */
  handshakeTimeoutMs?: number;
}

export interface ExtensionClient {
  host: HostAPIClient;
  /** Resolves once HOST_ACK ports are wired and PORT_READY has been sent. */
  ready: Promise<void>;
  dispose: () => void;
}

/**
 * Map a Comlink-wrapped HostAPI to the live client contract.
 *
 * Awaits each namespace so this works whether Comlink exposes a Promise-wrapped
 * clone or a live `Comlink.proxy` object (`await` on a non-Promise is a no-op).
 */
export function hostApiFromRemote(
  remote: Comlink.Remote<HostAPI>,
): HostAPIClient {
  // Namespace proxies must stay strongly referenced: Comlink releases a proxy
  // once it is garbage-collected, closing its port and dropping in-flight replies.
  const cache = new Map<keyof HostAPI, Promise<unknown>>();
  function ns<K extends keyof HostAPI>(key: K): Promise<HostAPI[K]> {
    let entry = cache.get(key);
    if (!entry) {
      entry = Promise.resolve(remote[key] as unknown as Promise<HostAPI[K]>);
      cache.set(key, entry);
    }
    return entry as Promise<HostAPI[K]>;
  }

  return {
    storage: {
      get: async (key) => (await ns('storage')).get(key),
      set: async (key, value) => (await ns('storage')).set(key, value),
      remove: async (key) => (await ns('storage')).remove(key),
    },
    notifications: {
      show: async (message, type) =>
        (await ns('notifications')).show(message, type),
    },
    ai: {
      generateText: async (prompt, options) =>
        (await ns('ai')).generateText(prompt, options),
    },
    hitl: {
      requestApproval: async (input) =>
        (await ns('hitl')).requestApproval(input),
    },
    api: {
      fetch: async (path, init) => (await ns('api')).fetch(path, init),
    },
    events: {
      publish: async (topic, payload) =>
        (await ns('events')).publish(topic, payload),
    },
    navigation: {
      openExternal: async (url, options) =>
        (await ns('navigation')).openExternal(url, options),
    },
    ui: {
      setRightSidebarOpen: async (open) =>
        (await ns('ui')).setRightSidebarOpen(open),
      toggleRightSidebar: async () => (await ns('ui')).toggleRightSidebar(),
      isRightSidebarOpen: async () => (await ns('ui')).isRightSidebarOpen(),
      openRightSheet: async (extensionId) =>
        (await ns('ui')).openRightSheet(extensionId),
      closeRightSheet: async () => (await ns('ui')).closeRightSheet(),
      toggleRightSheet: async (extensionId) =>
        (await ns('ui')).toggleRightSheet(extensionId),
      getActiveRightSheet: async () => (await ns('ui')).getActiveRightSheet(),
    },
  };
}

function normalizeApi(partial: Partial<ExtensionAPI>): ExtensionAPI {
  return {
    onActivate: async () => {
      await partial.onActivate?.();
    },
    onDeactivate: async () => {
      await partial.onDeactivate?.();
    },
    onEvent: async (topic: string, payload: EventPayload) => {
      await partial.onEvent?.(topic, payload);
    },
  };
}

/**
 * Lazy HostAPI that queues calls until the MessageChannel host port is ready.
 * Explicit namespaces avoid untyped Proxy traps.
 */
function createLazyHostProxy(
  hostPromise: Promise<HostAPIClient>,
): HostAPIClient {
  return {
    storage: {
      get: async (key) => (await hostPromise).storage.get(key),
      set: async (key, value) => (await hostPromise).storage.set(key, value),
      remove: async (key) => (await hostPromise).storage.remove(key),
    },
    notifications: {
      show: async (message, type) =>
        (await hostPromise).notifications.show(message, type),
    },
    ai: {
      generateText: async (prompt, options) =>
        (await hostPromise).ai.generateText(prompt, options),
    },
    hitl: {
      requestApproval: async (input) =>
        (await hostPromise).hitl.requestApproval(input),
    },
    api: {
      fetch: async (path, init) => (await hostPromise).api.fetch(path, init),
    },
    events: {
      publish: async (topic, payload) =>
        (await hostPromise).events.publish(topic, payload),
    },
    navigation: {
      openExternal: async (url, options) =>
        (await hostPromise).navigation.openExternal(url, options),
    },
    ui: {
      setRightSidebarOpen: async (open) =>
        (await hostPromise).ui.setRightSidebarOpen(open),
      toggleRightSidebar: async () =>
        (await hostPromise).ui.toggleRightSidebar(),
      isRightSidebarOpen: async () =>
        (await hostPromise).ui.isRightSidebarOpen(),
      openRightSheet: async (extensionId) =>
        (await hostPromise).ui.openRightSheet(extensionId),
      closeRightSheet: async () => (await hostPromise).ui.closeRightSheet(),
      toggleRightSheet: async (extensionId) =>
        (await hostPromise).ui.toggleRightSheet(extensionId),
      getActiveRightSheet: async () =>
        (await hostPromise).ui.getActiveRightSheet(),
    },
  };
}

/**
 * Boots an extension inside a sandboxed iframe.
 *
 * Uses two dedicated `MessageChannel` ports transferred from the shell:
 * one for HostAPI (shell → extension) and one for ExtensionAPI (extension → shell).
 * Separate channels avoid Comlink message-id collisions from expose+wrap on one port,
 * and avoid cross-talk between multiple iframes on `windowEndpoint`.
 */
export function createExtensionClient(
  options: ExtensionClientOptions,
): ExtensionClient {
  if (typeof window === 'undefined' || window.parent === window) {
    throw new Error(
      'createExtensionClient must run inside a sandboxed iframe hosted by the shell',
    );
  }

  const api = normalizeApi(options.api);
  const timeoutMs = options.handshakeTimeoutMs ?? 10_000;
  let disposed = false;
  let hostProxy: Comlink.Remote<HostAPI> | null = null;

  let resolveHost!: (host: HostAPIClient) => void;
  let rejectHost!: (error: Error) => void;
  const hostPromise = new Promise<HostAPIClient>((resolve, reject) => {
    resolveHost = resolve;
    rejectHost = reject;
  });

  const host = createLazyHostProxy(hostPromise);

  const ready = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      const err = new HandshakeTimeoutError('client', timeoutMs);
      rejectHost(err);
      reject(err);
    }, timeoutMs);

    const onMessage = (event: MessageEvent) => {
      const message = fromDomMessageEvent(event);
      if (message.source !== window.parent) return;
      if (!isHandshakeType(message.data, HANDSHAKE.HOST_ACK)) return;

      const [hostPort, extensionPort] = message.ports;
      if (!hostPort || !extensionPort) {
        cleanup();
        const err = new Error(
          'HOST_ACK missing MessageChannel ports (expected host + extension)',
        );
        rejectHost(err);
        reject(err);
        return;
      }

      hostProxy = Comlink.wrap<HostAPI>(hostPort);
      Comlink.expose(api, extensionPort);
      resolveHost(hostApiFromRemote(hostProxy));
      window.parent.postMessage({ type: HANDSHAKE.PORT_READY }, '*');
      cleanup();
      resolve();
    };

    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };

    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: HANDSHAKE.READY }, '*');

    if (disposed) {
      cleanup();
      const err = new Error(
        'Extension client disposed before handshake completed',
      );
      rejectHost(err);
      reject(err);
    }
  });

  return {
    host,
    ready,
    dispose: () => {
      disposed = true;
      hostProxy?.[Comlink.releaseProxy]();
    },
  };
}
