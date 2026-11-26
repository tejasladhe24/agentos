import { createShellEventBus, type ShellEventBus } from './event-bus';
import { createEventsBridge, type EventsBridge } from './events-bridge';
import { useShellStore } from './store';

/** The Shell's one in-memory event bus; declarations come from the registry. */
export const shellEventBus: ShellEventBus = createShellEventBus(
  (extensionId) =>
    useShellStore.getState().extensions.find((e) => e.id === extensionId)
      ?.events,
);

let bridge: EventsBridge | null = null;

/**
 * Install the SSE → bus bridge once per Shell session. Idempotent; the bridge
 * itself only holds a connection open while a frame is subscribed.
 */
export function ensureEventsBridge(): EventsBridge {
  bridge ??= createEventsBridge(shellEventBus);
  return bridge;
}

/** Tear down the bridge (tests, sign-out). */
export function disposeEventsBridge(): void {
  bridge?.dispose();
  bridge = null;
}
