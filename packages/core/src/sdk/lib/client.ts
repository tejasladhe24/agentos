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
  return {
    storage: {
      get: async (key) => (await remote.storage).get(key),
      set: async (key, value) => (await remote.storage).set(key, value),
      remove: async (key) => (await remote.storage).remove(key),
    },
    notifications: {
      show: async (message, type) =>
        (await remote.notifications).show(message, type),
    },
    ai: {
      generateText: async (prompt, options) =>
        (await remote.ai).generateText(prompt, options),
    },
    hitl: {
      requestApproval: async (input) =>
        (await remote.hitl).requestApproval(input),
    },
    api: {
      fetch: async (path, init) => (await remote.api).fetch(path, init),
    },
    events: {
      publish: async (topic, payload) =>
        (await remote.events).publish(topic, payload),
    },
    navigation: {
      openExternal: async (url, options) =>
        (await remote.navigation).openExternal(url, options),
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
