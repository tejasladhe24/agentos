import type { EventPayload, HostAPIClient } from '@agentos/core/sdk';

export type HostEventHandler = (payload: EventPayload, topic: string) => void;

/**
 * Handlers for events the Shell pushed into this frame. One module instance
 * exists per iframe realm, so this is effectively per-frame state.
 */
const handlers = new Map<string, Set<HostEventHandler>>();

/** Route an `ExtensionAPI.onEvent` call to the handlers for that topic. */
export function dispatchHostEvent(topic: string, payload: EventPayload): void {
  const set = handlers.get(topic);
  if (!set) return;
  for (const handler of [...set]) {
    try {
      handler(payload, topic);
    } catch (error) {
      console.error(`[agentos] host event handler for "${topic}" threw`, error);
    }
  }
}

/** Number of local handlers (tests / diagnostics). */
export function hostEventHandlerCount(topic?: string): number {
  if (topic) return handlers.get(topic)?.size ?? 0;
  let total = 0;
  for (const set of handlers.values()) total += set.size;
  return total;
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
): () => void {
  let cancelled = false;
  let subscriptionId: string | null = null;

  let set = handlers.get(topic);
  if (!set) {
    set = new Set();
    handlers.set(topic, set);
  }
  set.add(handler);

  host.events
    .subscribe([topic])
    .then((id) => {
      if (cancelled) {
        void host.events.unsubscribe(id).catch(() => {});
      } else {
        subscriptionId = id;
      }
    })
    .catch((error: unknown) => {
      console.error(`[agentos] useHostEvent("${topic}") failed`, error);
    });

  return () => {
    cancelled = true;
    const current = handlers.get(topic);
    current?.delete(handler);
    if (current && current.size === 0) handlers.delete(topic);
    if (subscriptionId !== null) {
      void host.events.unsubscribe(subscriptionId).catch(() => {});
      subscriptionId = null;
    }
  };
}
