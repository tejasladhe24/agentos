import type { EventPayload } from '@agentos/core/sdk';
import { isValidEventTopic } from '@agentos/core/vite/lib/types';

/** Topics one extension declared in `meta.json` `events`. */
export type EventDeclarations = {
  publishes?: readonly string[];
  subscribes?: readonly string[];
};

/** Delivers an event to one frame (its `ExtensionAPI.onEvent`). */
export type EventDeliver = (
  topic: string,
  payload: EventPayload,
) => void | Promise<void>;

/** Raised when an extension uses a topic it did not declare (or a bad name). */
export class EventDeclarationError extends Error {
  readonly code = 'EVENT_NOT_DECLARED' as const;

  constructor(
    public readonly extensionId: string,
    public readonly topic: string,
    public readonly action: 'publish' | 'subscribe',
    reason: string,
  ) {
    super(`Extension "${extensionId}" cannot ${action} "${topic}": ${reason}`);
    this.name = 'EventDeclarationError';
  }
}

type FrameRecord = {
  extensionId: string;
  /** `null` until the frame's remote is attached (subscribe can race it). */
  deliver: EventDeliver | null;
  /** subscription id → topics. */
  subscriptions: Map<string, Set<string>>;
};

/**
 * In-memory, Shell-owned event bus. Frames never see each other's
 * `MessagePort`s: they register a delivery callback (their remote `onEvent`)
 * and topic subscriptions here, and the Shell fans events out.
 */
export interface ShellEventBus {
  /** Register the frame's remote `onEvent`; returns a detach function. */
  attachFrame(
    frameId: string,
    extensionId: string,
    deliver: EventDeliver,
  ): () => void;
  /** Remove a frame and all its subscriptions (frame disposed). */
  dropFrame(frameId: string): void;
  /** Subscribe a frame to declared topics; returns a subscription id. */
  subscribe(frameId: string, extensionId: string, topics: string[]): string;
  unsubscribe(frameId: string, subscriptionId: string): void;
  /**
   * UI-only publish from an extension. Validates `events.publishes`, then
   * delivers in-process to subscribed frames. The publishing frame
   * (`fromFrameId`) is skipped: it already knows what it published, and the
   * client SDK notifies its own in-frame subscribers directly. Returns the
   * delivery count.
   */
  publishLocal(
    extensionId: string,
    topic: string,
    payload: EventPayload,
    fromFrameId?: string,
  ): number;
  /** Throws {@link EventDeclarationError} if `extensionId` may not publish. */
  assertCanPublish(extensionId: string, topic: string): void;
  /**
   * Re-emit a server-originated event (already authorized and org-scoped by
   * the events builtin). No publisher declaration check.
   */
  emit(topic: string, payload: EventPayload): number;
  /**
   * Shell-internal subscription (no extension frame, no declaration check):
   * for Shell code that reacts to server events, e.g. waiting on an approval.
   * Returns an unsubscribe function.
   */
  listen(topics: readonly string[], deliver: EventDeliver): () => void;
  /** True while at least one frame subscription exists. */
  readonly active: boolean;
  /** Called when the bus goes from 0 → ≥1 (true) or back to 0 (false). */
  onActiveChange(listener: (active: boolean) => void): () => void;
}

export function createShellEventBus(
  getDeclarations: (extensionId: string) => EventDeclarations | undefined,
): ShellEventBus {
  const frames = new Map<string, FrameRecord>();
  const activeListeners = new Set<(active: boolean) => void>();
  let subscriptionCount = 0;
  let nextSubscriptionId = 0;

  function frameFor(frameId: string, extensionId: string): FrameRecord {
    let frame = frames.get(frameId);
    if (!frame) {
      frame = { extensionId, deliver: null, subscriptions: new Map() };
      frames.set(frameId, frame);
    }
    return frame;
  }

  function setCount(next: number): void {
    const wasActive = subscriptionCount > 0;
    subscriptionCount = next;
    const isActive = subscriptionCount > 0;
    if (wasActive !== isActive) {
      for (const listener of [...activeListeners]) listener(isActive);
    }
  }

  function assertTopic(
    extensionId: string,
    topic: string,
    action: 'publish' | 'subscribe',
  ): void {
    if (!isValidEventTopic(topic)) {
      throw new EventDeclarationError(
        extensionId,
        topic,
        action,
        'invalid topic name',
      );
    }
    const declared = getDeclarations(extensionId);
    const list =
      action === 'publish' ? declared?.publishes : declared?.subscribes;
    if (!list?.includes(topic)) {
      throw new EventDeclarationError(
        extensionId,
        topic,
        action,
        `not declared in meta.json events.${action === 'publish' ? 'publishes' : 'subscribes'}`,
      );
    }
  }

  function fanOut(
    topic: string,
    payload: EventPayload,
    skipFrameId?: string,
  ): number {
    let delivered = 0;
    for (const [frameId, frame] of frames) {
      if (frameId === skipFrameId || !frame.deliver) continue;
      let matches = false;
      for (const topics of frame.subscriptions.values()) {
        if (topics.has(topic)) {
          matches = true;
          break;
        }
      }
      if (!matches) continue;
      delivered += 1;
      try {
        // A slow or crashed frame must never block or break its siblings.
        void Promise.resolve(frame.deliver(topic, payload)).catch(() => {});
      } catch {
        /* synchronous deliver failure: isolate to this frame */
      }
    }
    return delivered;
  }

  return {
    attachFrame(frameId, extensionId, deliver) {
      frameFor(frameId, extensionId).deliver = deliver;
      return () => this.dropFrame(frameId);
    },

    dropFrame(frameId) {
      const frame = frames.get(frameId);
      if (!frame) return;
      frames.delete(frameId);
      setCount(subscriptionCount - frame.subscriptions.size);
    },

    subscribe(frameId, extensionId, topics) {
      if (topics.length === 0) {
        throw new EventDeclarationError(
          extensionId,
          '',
          'subscribe',
          'no topics given',
        );
      }
      for (const topic of topics) assertTopic(extensionId, topic, 'subscribe');
      nextSubscriptionId += 1;
      const id = `sub-${nextSubscriptionId}`;
      frameFor(frameId, extensionId).subscriptions.set(id, new Set(topics));
      setCount(subscriptionCount + 1);
      return id;
    },

    unsubscribe(frameId, subscriptionId) {
      const frame = frames.get(frameId);
      if (!frame?.subscriptions.delete(subscriptionId)) return;
      setCount(subscriptionCount - 1);
    },

    listen(topics, deliver) {
      nextSubscriptionId += 1;
      const frameId = `shell:${nextSubscriptionId}`;
      const frame = frameFor(frameId, 'shell');
      frame.deliver = deliver;
      frame.subscriptions.set(`sub-${nextSubscriptionId}`, new Set(topics));
      setCount(subscriptionCount + 1);
      return () => this.dropFrame(frameId);
    },

    assertCanPublish(extensionId, topic) {
      assertTopic(extensionId, topic, 'publish');
    },

    publishLocal(extensionId, topic, payload, fromFrameId) {
      assertTopic(extensionId, topic, 'publish');
      return fanOut(topic, payload, fromFrameId);
    },

    emit(topic, payload) {
      return fanOut(topic, payload);
    },

    get active() {
      return subscriptionCount > 0;
    },

    onActiveChange(listener) {
      activeListeners.add(listener);
      return () => {
        activeListeners.delete(listener);
      };
    },
  };
}
