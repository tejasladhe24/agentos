import { PLATFORM_ORG_ID } from './constants';

export type EventMessage = {
  topic: string;
  payload: unknown;
  at: string;
};

type Subscriber = {
  topics: Set<string> | null;
  /** Tenant this subscriber may see; `null` sees every org (service callers). */
  orgId: string | null;
  enqueue: (msg: EventMessage) => void;
  close: () => void;
};

/**
 * SSE comment frame sent on an otherwise idle subscription. Bun.serve closes a
 * connection that writes nothing for 10 s (default `idleTimeout`), which made
 * every quiet `/subscribe` stream drop and reconnect. Keep this well under 10 s.
 */
export const SSE_HEARTBEAT_MS = 5_000;

export type EventBusOptions = {
  heartbeatMs?: number;
};

/** In-process pub/sub bus for SSE subscribers, scoped per org. */
export function createEventBus(options: EventBusOptions = {}) {
  const subscribers = new Set<Subscriber>();
  const heartbeatMs = options.heartbeatMs ?? SSE_HEARTBEAT_MS;

  return {
    publish(
      topic: string,
      payload: unknown,
      orgId: string = PLATFORM_ORG_ID,
    ): EventMessage {
      const msg: EventMessage = {
        topic,
        payload,
        at: new Date().toISOString(),
      };
      for (const sub of subscribers) {
        const topicMatch = sub.topics === null || sub.topics.has(topic);
        const orgMatch = sub.orgId === null || sub.orgId === orgId;
        if (topicMatch && orgMatch) {
          sub.enqueue(msg);
        }
      }
      return msg;
    },

    subscribe(
      topics: string[] | null,
      orgId: string | null = null,
    ): {
      stream: ReadableStream<Uint8Array>;
      close: () => void;
    } {
      const encoder = new TextEncoder();
      let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const sub: Subscriber = {
        topics: topics && topics.length > 0 ? new Set(topics) : null,
        orgId,
        enqueue(msg) {
          if (!controller || closed) return;
          const data = `event: message\ndata: ${JSON.stringify(msg)}\n\n`;
          controller.enqueue(encoder.encode(data));
        },
        close() {
          if (closed) return;
          closed = true;
          if (heartbeat) clearInterval(heartbeat);
          subscribers.delete(sub);
          try {
            controller?.close();
          } catch {
            // already closed
          }
        },
      };

      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
          subscribers.add(sub);
          c.enqueue(encoder.encode(': ok\n\n'));
          heartbeat = setInterval(() => {
            if (closed) return;
            try {
              c.enqueue(encoder.encode(': ping\n\n'));
            } catch {
              sub.close();
            }
          }, heartbeatMs);
          // Never keep the process alive just for an idle subscriber.
          heartbeat.unref?.();
        },
        cancel() {
          sub.close();
        },
      });

      return { stream, close: () => sub.close() };
    },

    get subscriberCount() {
      return subscribers.size;
    },
  };
}

export type EventBus = ReturnType<typeof createEventBus>;
