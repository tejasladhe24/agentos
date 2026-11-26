import { afterEach, describe, expect, test } from 'bun:test';
import { dispatchHostEvent, subscribeHostEvent } from '@agentos/core/client';
import { hostEventHandlerCount } from '@agentos/core/client/lib/host-events';
import type { HostAPIClient } from '@agentos/core/sdk';
import { createStubHost } from './stub-host';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('subscribeHostEvent (useHostEvent core)', () => {
  test('subscribes through the host and delivers dispatched events', async () => {
    const calls: string[] = [];
    const host = createStubHost(new Map(), calls);
    const seen: Array<[string, unknown]> = [];

    cleanups.push(
      subscribeHostEvent(host, 'files.selection.changed', (payload, topic) => {
        seen.push([topic, payload]);
      }),
    );
    await flush();

    expect(calls).toEqual(['events.subscribe:files.selection.changed']);
    dispatchHostEvent('files.selection.changed', { keys: ['a'] });
    dispatchHostEvent('some.other.topic', { ignored: true });
    expect(seen).toEqual([['files.selection.changed', { keys: ['a'] }]]);
  });

  test('cleanup unsubscribes and stops delivery', async () => {
    const calls: string[] = [];
    const host = createStubHost(new Map(), calls);
    const seen: unknown[] = [];

    const stop = subscribeHostEvent(host, 'a.b', (payload) => {
      seen.push(payload);
    });
    await flush();
    stop();
    await flush();
    dispatchHostEvent('a.b', 1);

    expect(calls).toEqual([
      'events.subscribe:a.b',
      'events.unsubscribe:sub-a.b',
    ]);
    expect(seen).toEqual([]);
    expect(hostEventHandlerCount('a.b')).toBe(0);
  });

  test('cleanup before the subscribe resolves still unsubscribes', async () => {
    const calls: string[] = [];
    const base = createStubHost(new Map(), calls);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host: HostAPIClient = {
      ...base,
      events: {
        ...base.events,
        subscribe: async (topics) => {
          await gate;
          return base.events.subscribe(topics);
        },
      },
    };

    const stop = subscribeHostEvent(host, 'late.topic', () => {});
    stop();
    release();
    await flush();

    expect(calls).toEqual([
      'events.subscribe:late.topic',
      'events.unsubscribe:sub-late.topic',
    ]);
  });

  test('multiple handlers on one topic each receive the event', async () => {
    const host = createStubHost();
    const a: unknown[] = [];
    const b: unknown[] = [];
    cleanups.push(
      subscribeHostEvent(host, 'x.y', (p) => a.push(p)),
      subscribeHostEvent(host, 'x.y', (p) => b.push(p)),
    );
    await flush();
    dispatchHostEvent('x.y', 'hi');
    expect(a).toEqual(['hi']);
    expect(b).toEqual(['hi']);
    expect(hostEventHandlerCount('x.y')).toBe(2);
  });

  test('a throwing handler does not stop the others', async () => {
    const host = createStubHost();
    const got: unknown[] = [];
    const originalError = console.error;
    console.error = () => {};
    try {
      cleanups.push(
        subscribeHostEvent(host, 'x.y', () => {
          throw new Error('boom');
        }),
        subscribeHostEvent(host, 'x.y', (p) => got.push(p)),
      );
      await flush();
      dispatchHostEvent('x.y', 1);
    } finally {
      console.error = originalError;
    }
    expect(got).toEqual([1]);
  });

  test('a rejected subscribe (undeclared topic) is logged, not thrown', async () => {
    const base = createStubHost();
    const host: HostAPIClient = {
      ...base,
      events: {
        ...base.events,
        subscribe: async () => {
          throw new Error('not declared');
        },
      },
    };
    const logged: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => logged.push(args);
    try {
      cleanups.push(subscribeHostEvent(host, 'nope.topic', () => {}));
      await flush();
    } finally {
      console.error = originalError;
    }
    expect(String(logged[0]?.[0])).toContain('useHostEvent("nope.topic")');
  });
});
