import type { EventPayload, HostAPIClient } from '@agentos/core/sdk';
import {
  publishLocalEvent,
  subscribeHostEvent,
  type HostEventDispatcher,
} from './host-events';

export type HostSharedStateOptions<T> = {
  /**
   * Bus topic announcing changes, namespaced `<extId>.<event>` and declared in
   * `meta.json` under both `events.publishes` and `events.subscribes`.
   */
  topic: string;
  /** Coerce a stored / received value (anything) into `T`; defaults to a cast. */
  parse?: (raw: unknown) => T;
};

export interface HostSharedState<T> {
  /** Optimistically apply, persist to host storage, then announce on the bus. */
  update(next: T): Promise<void>;
  /** Unsubscribe and stop applying remote changes. */
  stop(): void;
}

/**
 * Framework-free core of `useHostSharedState`: subscribes to `topic`, loads the
 * stored value once subscribed, and applies every announced change via
 * `onValue`. Exported separately so multi-frame sync is testable without a DOM.
 */
export function connectHostSharedState<T>(
  host: HostAPIClient,
  key: string,
  initial: T,
  options: HostSharedStateOptions<T>,
  onValue: (value: T) => void,
  dispatcher?: HostEventDispatcher,
): HostSharedState<T> {
  let stopped = false;
  const resolve = (raw: unknown): T => {
    if (options.parse) return options.parse(raw);
    return raw === null || raw === undefined ? initial : (raw as T);
  };

  const unsubscribe = subscribeHostEvent(
    host,
    options.topic,
    (payload) => onValue(resolve(payload)),
    // Read after subscribing: storage is written before each announcement, so
    // no change can slip between the read and the subscription.
    () => {
      void host.storage.get(key).then((stored) => {
        if (!stopped) onValue(resolve(stored));
      });
    },
    dispatcher,
  );

  return {
    async update(next) {
      onValue(next);
      await host.storage.set(key, next as EventPayload);
      await publishLocalEvent(
        host,
        options.topic,
        next as EventPayload,
        dispatcher,
      );
    },
    stop() {
      stopped = true;
      unsubscribe();
    },
  };
}
