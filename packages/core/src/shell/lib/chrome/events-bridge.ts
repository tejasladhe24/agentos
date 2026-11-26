import type { EventPayload } from '@agentos/core/sdk';
import type { ShellEventBus } from './event-bus';

/** Subset of the DOM `EventSource` the bridge uses (injectable for tests). */
export interface EventSourceLike {
  addEventListener(
    type: 'message',
    listener: (event: { data: string }) => void,
  ): void;
  close(): void;
}

export type EventsBridgeOptions = {
  /** Org-scoped SSE endpoint of the `events` builtin. */
  url?: string;
  createEventSource?: (url: string) => EventSourceLike;
};

export const EVENTS_SUBSCRIBE_URL = '/api/ext/events/subscribe';

export interface EventsBridge {
  /** True while the SSE connection is open. */
  readonly connected: boolean;
  /** Stop listening to the bus and close any open connection. */
  dispose(): void;
}

type ServerEvent = { topic: string; payload: EventPayload };

function parseServerEvent(data: string): ServerEvent | null {
  try {
    const parsed = JSON.parse(data) as Partial<ServerEvent> | null;
    if (!parsed || typeof parsed.topic !== 'string' || !parsed.topic) {
      return null;
    }
    return {
      topic: parsed.topic,
      payload: (parsed.payload ?? null) as EventPayload,
    };
  } catch {
    return null;
  }
}

/**
 * Bridges the `events` builtin's SSE stream onto the Shell bus: one
 * connection per Shell session, opened only while some frame is subscribed and
 * closed when the last subscription goes away. The builtin already scopes the
 * stream to the signed-in user's active org (ticket 141), so everything it
 * delivers is safe to re-emit to declared subscribers.
 */
export function createEventsBridge(
  bus: ShellEventBus,
  options: EventsBridgeOptions = {},
): EventsBridge {
  const url = options.url ?? EVENTS_SUBSCRIBE_URL;
  const createEventSource =
    options.createEventSource ??
    (typeof EventSource === 'undefined'
      ? null
      : (target: string): EventSourceLike =>
          new EventSource(target, { withCredentials: true }));

  let source: EventSourceLike | null = null;

  const open = () => {
    if (source || !createEventSource) return;
    const next = createEventSource(url);
    next.addEventListener('message', (event) => {
      const parsed = parseServerEvent(event.data);
      if (parsed) bus.emit(parsed.topic, parsed.payload);
    });
    source = next;
  };

  const close = () => {
    source?.close();
    source = null;
  };

  const unlisten = bus.onActiveChange((active) => {
    if (active) open();
    else close();
  });
  if (bus.active) open();

  return {
    get connected() {
      return source !== null;
    },
    dispose() {
      unlisten();
      close();
    },
  };
}
