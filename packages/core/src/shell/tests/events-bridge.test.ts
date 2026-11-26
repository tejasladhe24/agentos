import { describe, expect, test } from 'bun:test';
import {
  createEventsBridge,
  createShellEventBus,
  EVENTS_SUBSCRIBE_URL,
  type EventSourceLike,
} from '@agentos/core/shell/lib';

class FakeEventSource implements EventSourceLike {
  closed = false;
  private listeners: Array<(event: { data: string }) => void> = [];
  constructor(readonly url: string) {}
  addEventListener(
    _type: 'message',
    listener: (event: { data: string }) => void,
  ) {
    this.listeners.push(listener);
  }
  close() {
    this.closed = true;
  }
  push(data: string) {
    for (const listener of this.listeners) listener({ data });
  }
}

function setup() {
  const bus = createShellEventBus((id) =>
    id === 'viewer' ? { subscribes: ['email.received'] } : undefined,
  );
  const sources: FakeEventSource[] = [];
  const bridge = createEventsBridge(bus, {
    createEventSource: (url) => {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source;
    },
  });
  const received: unknown[] = [];
  bus.attachFrame('viewer-1', 'viewer', (topic, payload) => {
    received.push([topic, payload]);
  });
  return { bus, bridge, sources, received };
}

const serverEvent = (topic: string, payload: unknown) =>
  JSON.stringify({ topic, payload, at: '2026-01-01T00:00:00.000Z' });

describe('events bridge (SSE → Shell bus)', () => {
  test('stays disconnected until a frame subscribes, then opens one stream', () => {
    const { bus, bridge, sources } = setup();
    expect(bridge.connected).toBe(false);
    expect(sources).toHaveLength(0);

    bus.subscribe('viewer-1', 'viewer', ['email.received']);
    bus.subscribe('viewer-2', 'viewer', ['email.received']);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.url).toBe(EVENTS_SUBSCRIBE_URL);
    expect(bridge.connected).toBe(true);
  });

  test('re-emits server events to declared subscribers only', () => {
    const { bus, sources, received } = setup();
    bus.subscribe('viewer-1', 'viewer', ['email.received']);

    sources[0]!.push(serverEvent('email.received', { id: 'm1' }));
    sources[0]!.push(serverEvent('unrelated.topic', { id: 'x' }));

    expect(received).toEqual([['email.received', { id: 'm1' }]]);
  });

  test('ignores malformed frames', () => {
    const { bus, sources, received } = setup();
    bus.subscribe('viewer-1', 'viewer', ['email.received']);
    sources[0]!.push('not json');
    sources[0]!.push('null');
    sources[0]!.push(JSON.stringify({ payload: 1 }));
    sources[0]!.push(JSON.stringify({ topic: '', payload: 1 }));
    expect(received).toEqual([]);
  });

  test('closes when the last subscription is removed and reopens on demand', () => {
    const { bus, bridge, sources } = setup();
    const id = bus.subscribe('viewer-1', 'viewer', ['email.received']);
    bus.unsubscribe('viewer-1', id);
    expect(sources[0]!.closed).toBe(true);
    expect(bridge.connected).toBe(false);

    bus.subscribe('viewer-1', 'viewer', ['email.received']);
    expect(sources).toHaveLength(2);
    expect(sources[1]!.closed).toBe(false);
  });

  test('frame dispose closes the stream', () => {
    const { bus, sources } = setup();
    bus.subscribe('viewer-1', 'viewer', ['email.received']);
    bus.dropFrame('viewer-1');
    expect(sources[0]!.closed).toBe(true);
  });

  test('dispose stops listening and closes the stream', () => {
    const { bus, bridge, sources } = setup();
    bus.subscribe('viewer-1', 'viewer', ['email.received']);
    bridge.dispose();
    expect(sources[0]!.closed).toBe(true);
    bus.subscribe('viewer-2', 'viewer', ['email.received']);
    expect(sources).toHaveLength(1);
  });

  test('opens immediately when frames were already subscribed', () => {
    const bus = createShellEventBus(() => ({ subscribes: ['a.b'] }));
    bus.subscribe('f', 'x', ['a.b']);
    const sources: FakeEventSource[] = [];
    createEventsBridge(bus, {
      createEventSource: (url) => {
        const s = new FakeEventSource(url);
        sources.push(s);
        return s;
      },
    });
    expect(sources).toHaveLength(1);
  });
});
