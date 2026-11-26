import { useEffect, useMemo, useRef } from 'react';
import type { EventPayload, HostAPIClient } from '@agentos/core/sdk';
import { subscribeHostEvent, type HostEventHandler } from './host-events';
import { useHost } from './use-host';

/**
 * Subscribe to a Shell event-bus topic for the lifetime of the component.
 * The topic must be declared in this extension's `meta.json`
 * `events.subscribes`. The latest `handler` is always called (no resubscribe
 * on re-render).
 */
export function useHostEvent(topic: string, handler: HostEventHandler): void {
  const host = useHost();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(
    () =>
      subscribeHostEvent(host, topic, (payload, name) =>
        handlerRef.current(payload, name),
      ),
    [host, topic],
  );
}

export type HostPublish = {
  /** Durable publish via the `events` builtin (also reaches other tabs). */
  publish: (topic: string, payload: EventPayload) => Promise<void>;
  /** In-process, UI-only publish (no server round trip). */
  publishLocal: (topic: string, payload: EventPayload) => Promise<void>;
};

/**
 * Publish to the Shell event bus. Topics must be declared in `meta.json`
 * `events.publishes` and namespaced `<extId>.<event>`.
 */
export function useHostPublish(): HostPublish {
  const host: HostAPIClient = useHost();
  return useMemo(
    () => ({
      publish: (topic, payload) => host.events.publish(topic, payload),
      publishLocal: (topic, payload) =>
        host.events.publishLocal(topic, payload),
    }),
    [host],
  );
}
