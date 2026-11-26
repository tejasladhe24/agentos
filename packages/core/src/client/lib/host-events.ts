import type { EventPayload, HostAPIClient } from '@agentos/core/sdk';

export type HostEventHandler = (payload: EventPayload, topic: string) => void;

/**
 * Routes events the Shell pushed into this frame to local handlers. The
 * default instance below is per iframe realm; tests build their own to model
 * several frames in one process.
 */
export interface HostEventDispatcher {
  /** Route an `ExtensionAPI.onEvent` call to the handlers for that topic. */
  dispatch(topic: string, payload: EventPayload): void;
  /** Register a handler; returns its remover. */
  add(topic: string, handler: HostEventHandler): () => void;
  /** Number of handlers for `topic`, or in total. */
  count(topic?: string): number;
}

export function createHostEventDispatcher(): HostEventDispatcher {
  const handlers = new Map<string, Set<HostEventHandler>>();
  return {
    dispatch(topic, payload) {
      const set = handlers.get(topic);
      if (!set) return;
      for (const handler of [...set]) {
        try {
          handler(payload, topic);
        } catch (error) {
          console.error(
            `[agentos] host event handler for "${topic}" threw`,
            error,
          );
        }
      }
    },
    add(topic, handler) {
      let set = handlers.get(topic);
      if (!set) {
        set = new Set();
        handlers.set(topic, set);
      }
      set.add(handler);
      return () => {
        const current = handlers.get(topic);
        current?.delete(handler);
        if (current && current.size === 0) handlers.delete(topic);
      };
    },
    count(topic) {
      if (topic) return handlers.get(topic)?.size ?? 0;
      let total = 0;
      for (const set of handlers.values()) total += set.size;
      return total;
    },
  };
}

const frameDispatcher = createHostEventDispatcher();

/** Route an `ExtensionAPI.onEvent` call into this frame's handlers. */
export function dispatchHostEvent(topic: string, payload: EventPayload): void {
  frameDispatcher.dispatch(topic, payload);
}

/** Number of local handlers (tests / diagnostics). */
export function hostEventHandlerCount(topic?: string): number {
  return frameDispatcher.count(topic);
}

/**
 * Subscribe `handler` to `topic` through the Shell bus. Registers the local
 * handler immediately and the Shell subscription asynchronously; the returned
 * cleanup removes both, including when the subscribe call resolves after the
 * cleanup already ran. Undeclared topics are rejected by the Shell and logged.
 */
export function subscribeHostEvent(
  host: HostAPIClient,
  topic: string,
  handler: HostEventHandler,
  /**
   * Runs once the Shell subscription is registered (or failed), unless the
   * cleanup already ran. Read current state here: anything published after
   * this point is delivered, so nothing falls in the gap between reading and
   * subscribing.
   */
  onSettled?: () => void,
  dispatcher: HostEventDispatcher = frameDispatcher,
): () => void {
  let cancelled = false;
  let subscriptionId: string | null = null;

  const removeHandler = dispatcher.add(topic, handler);

  host.events
    .subscribe([topic])
    .then((id) => {
      if (cancelled) {
        void host.events.unsubscribe(id).catch(() => {});
      } else {
        subscriptionId = id;
        onSettled?.();
      }
    })
    .catch((error: unknown) => {
      console.error(`[agentos] useHostEvent("${topic}") failed`, error);
      if (!cancelled) onSettled?.();
    });

  return () => {
    cancelled = true;
    removeHandler();
    if (subscriptionId !== null) {
      void host.events.unsubscribe(subscriptionId).catch(() => {});
      subscriptionId = null;
    }
  };
}

/**
 * UI-only publish that reaches every subscriber in the tab: other frames via
 * the Shell bus (which skips this frame), and this frame's own subscribers
 * directly. Rejects (and notifies no one) when the Shell refuses the topic.
 */
export async function publishLocalEvent(
  host: HostAPIClient,
  topic: string,
  payload: EventPayload,
  dispatcher: HostEventDispatcher = frameDispatcher,
): Promise<void> {
  await host.events.publishLocal(topic, payload);
  dispatcher.dispatch(topic, payload);
}
