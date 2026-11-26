import type { Remote } from 'comlink';
import {
  connectExtensionHost,
  fromDomMessageEvent,
  HANDSHAKE,
  isHandshakeType,
  withRpcTimeout,
  type ExtensionAPI,
  type ExtensionContentWindow,
  type ExtensionHostConnection,
  type HandshakeIncomingMessage,
  type HandshakeMessageTarget,
  type HostAPI,
} from '@agentos/core/sdk';

export type ActivateFrameOptions = {
  extensionId: string;
  contentWindow: ExtensionContentWindow;
  hostApi: HostAPI;
  handshakeTimeoutMs?: number;
  rpcTimeoutMs?: number;
  /** Window that receives READY / PORT_READY (defaults to shell `window`). */
  messageTarget?: HandshakeMessageTarget;
  /**
   * Called as soon as the frame's remote exists — before `onActivate` — so
   * the event bus can deliver to it without racing early subscriptions.
   */
  onRemote?: (remote: Remote<ExtensionAPI>) => void;
};

export type ActivatedFrame = {
  remote: Remote<ExtensionAPI>;
  dispose: () => void;
};

const domListenerMap = new WeakMap<
  (event: HandshakeIncomingMessage) => void,
  (event: MessageEvent) => void
>();

function toHandshakeMessageTarget(
  target: Window & typeof globalThis,
): HandshakeMessageTarget {
  return {
    setTimeout: (handler, timeout) => globalThis.setTimeout(handler, timeout),
    clearTimeout: (id) => globalThis.clearTimeout(id),
    addEventListener: (type, listener) => {
      const domListener = (event: MessageEvent) => {
        listener(fromDomMessageEvent(event));
      };
      domListenerMap.set(listener, domListener);
      target.addEventListener(type, domListener);
    },
    removeEventListener: (type, listener) => {
      const domListener = domListenerMap.get(listener);
      if (domListener) {
        target.removeEventListener(type, domListener);
        domListenerMap.delete(listener);
      }
    },
  };
}

/**
 * Resolves when the iframe posts `HANDSHAKE.READY` from `contentWindow`.
 * Returns an unsubscribe function if the caller abandons the wait.
 */
export function listenForReady(
  contentWindow: ExtensionContentWindow,
  messageTarget: HandshakeMessageTarget,
  onReady: () => void,
): () => void {
  const onMessage = (event: HandshakeIncomingMessage) => {
    if (event.source !== contentWindow) return;
    if (!isHandshakeType(event.data, HANDSHAKE.READY)) return;
    cleanup();
    onReady();
  };

  const cleanup = () => {
    messageTarget.removeEventListener('message', onMessage);
  };

  messageTarget.addEventListener('message', onMessage);
  return cleanup;
}

/**
 * Wait for READY, complete dual-channel handshake, then call `onActivate`.
 */
export async function activateFrame(
  options: ActivateFrameOptions,
): Promise<ActivatedFrame> {
  const {
    extensionId,
    contentWindow,
    hostApi,
    handshakeTimeoutMs = 10_000,
    rpcTimeoutMs = 10_000,
    messageTarget = toHandshakeMessageTarget(
      globalThis as Window & typeof globalThis,
    ),
    onRemote,
  } = options;

  await new Promise<void>((resolve, reject) => {
    const timer = messageTarget.setTimeout(() => {
      cancel();
      reject(
        new Error(
          `Extension "${extensionId}" did not send READY within ${handshakeTimeoutMs}ms`,
        ),
      );
    }, handshakeTimeoutMs);

    const cancel = listenForReady(contentWindow, messageTarget, () => {
      messageTarget.clearTimeout(timer);
      resolve();
    });
  });

  const connection: ExtensionHostConnection = await connectExtensionHost({
    contentWindow,
    hostApi,
    handshakeTimeoutMs,
    messageTarget,
  });

  onRemote?.(connection.remote);

  try {
    await withRpcTimeout(
      extensionId,
      'onActivate',
      connection.remote.onActivate(),
      rpcTimeoutMs,
    );
  } catch (error) {
    connection.dispose();
    throw error;
  }

  return {
    remote: connection.remote,
    dispose: connection.dispose,
  };
}

/**
 * Timeout-safe deactivate then dispose. Errors are swallowed so React cleanup
 * never tears down sibling frames; caller may mark crashed on failure.
 */
export async function deactivateFrame(
  extensionId: string,
  remote: Remote<ExtensionAPI> | null,
  dispose: (() => void) | null,
  rpcTimeoutMs: number = 10_000,
): Promise<{ ok: boolean; error?: Error }> {
  try {
    if (remote) {
      await withRpcTimeout(
        extensionId,
        'onDeactivate',
        remote.onDeactivate(),
        rpcTimeoutMs,
      );
    }
    dispose?.();
    return { ok: true };
  } catch (reason) {
    try {
      dispose?.();
    } catch {
      /* already closed */
    }
    const error = reason instanceof Error ? reason : new Error(String(reason));
    return { ok: false, error };
  }
}
