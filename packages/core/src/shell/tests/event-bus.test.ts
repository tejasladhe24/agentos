import { describe, expect, test } from 'bun:test';
import {
  createShellEventBus,
  EventDeclarationError,
  type EventDeclarations,
} from '@agentos/core/shell/lib';

const DECLARATIONS: Record<string, EventDeclarations> = {
  files: { publishes: ['files.selection.changed'] },
  viewer: { subscribes: ['files.selection.changed', 'email.received'] },
  other: { subscribes: ['other.thing'] },
};

function setup() {
  const bus = createShellEventBus((id) => DECLARATIONS[id]);
  const received: Record<string, Array<[string, unknown]>> = {};
  const attach = (frameId: string, extensionId: string) => {
    received[frameId] = [];
    return bus.attachFrame(frameId, extensionId, (topic, payload) => {
      received[frameId]!.push([topic, payload]);
    });
  };
  return { bus, received, attach };
}

describe('shell event bus', () => {
  test('delivers a local publish only to frames subscribed to the topic', () => {
    const { bus, received, attach } = setup();
    attach('viewer-1', 'viewer');
    attach('other-1', 'other');
    bus.subscribe('viewer-1', 'viewer', ['files.selection.changed']);
    bus.subscribe('other-1', 'other', ['other.thing']);

    const delivered = bus.publishLocal('files', 'files.selection.changed', {
      keys: ['a'],
    });

    expect(delivered).toBe(1);
    expect(received['viewer-1']).toEqual([
      ['files.selection.changed', { keys: ['a'] }],
    ]);
    expect(received['other-1']).toEqual([]);
  });

  test('undeclared publish is rejected and nothing is delivered', () => {
    const { bus, received, attach } = setup();
    attach('viewer-1', 'viewer');
    bus.subscribe('viewer-1', 'viewer', ['files.selection.changed']);

    // `viewer` declares no publishes; `files` does not declare this topic.
    expect(() =>
      bus.publishLocal('viewer', 'files.selection.changed', {}),
    ).toThrow(EventDeclarationError);
    expect(() => bus.publishLocal('files', 'files.other', {})).toThrow(
      /not declared in meta.json events.publishes/,
    );
    expect(() => bus.assertCanPublish('ghost', 'x.y')).toThrow(
      EventDeclarationError,
    );
    expect(received['viewer-1']).toEqual([]);
  });

  test('undeclared or malformed subscribe is rejected', () => {
    const { bus } = setup();
    expect(() =>
      bus.subscribe('other-1', 'other', ['files.selection.changed']),
    ).toThrow(/events.subscribes/);
    expect(() => bus.subscribe('f', 'viewer', ['Bad Topic'])).toThrow(
      /invalid topic/,
    );
    expect(() => bus.subscribe('f', 'viewer', [])).toThrow(/no topics/);
    // A rejected subscribe must not leave the bus active.
    expect(bus.active).toBe(false);
  });

  test('one rejected topic rejects the whole subscribe call', () => {
    const { bus } = setup();
    expect(() =>
      bus.subscribe('v', 'viewer', ['files.selection.changed', 'nope.topic']),
    ).toThrow(EventDeclarationError);
    expect(bus.active).toBe(false);
  });

  test('unsubscribe stops delivery; unknown ids are ignored', () => {
    const { bus, received, attach } = setup();
    attach('viewer-1', 'viewer');
    const id = bus.subscribe('viewer-1', 'viewer', ['email.received']);
    bus.emit('email.received', { n: 1 });
    bus.unsubscribe('viewer-1', id);
    bus.unsubscribe('viewer-1', id);
    bus.unsubscribe('missing-frame', 'sub-999');
    bus.emit('email.received', { n: 2 });
    expect(received['viewer-1']).toEqual([['email.received', { n: 1 }]]);
  });

  test('dropFrame (frame dispose) removes its subscriptions', () => {
    const { bus, received, attach } = setup();
    const detach = attach('viewer-1', 'viewer');
    bus.subscribe('viewer-1', 'viewer', ['email.received']);
    bus.subscribe('viewer-1', 'viewer', ['files.selection.changed']);
    expect(bus.active).toBe(true);

    detach();
    expect(bus.active).toBe(false);
    expect(bus.emit('email.received', {})).toBe(0);
    expect(received['viewer-1']).toEqual([]);
  });

  test('a subscribe that races ahead of attach still receives later events', () => {
    const { bus, received } = setup();
    // The frame subscribes before the Shell attached its remote.
    bus.subscribe('viewer-1', 'viewer', ['email.received']);
    expect(bus.emit('email.received', { early: true })).toBe(0);

    bus.attachFrame('viewer-1', 'viewer', (topic, payload) => {
      received['viewer-1'] = [[topic, payload]];
    });
    expect(bus.emit('email.received', { late: true })).toBe(1);
    expect(received['viewer-1']).toEqual([['email.received', { late: true }]]);
  });

  test('a throwing or rejecting frame does not block its siblings', async () => {
    const bus = createShellEventBus((id) => DECLARATIONS[id]);
    const got: string[] = [];
    bus.attachFrame('bad-sync', 'viewer', () => {
      throw new Error('boom');
    });
    bus.attachFrame('bad-async', 'viewer', async () => {
      throw new Error('boom');
    });
    bus.attachFrame('good', 'viewer', (topic) => {
      got.push(topic);
    });
    for (const frame of ['bad-sync', 'bad-async', 'good']) {
      bus.subscribe(frame, 'viewer', ['email.received']);
    }

    expect(bus.emit('email.received', {})).toBe(3);
    await Promise.resolve();
    expect(got).toEqual(['email.received']);
  });

  test('emit (server events) skips the publisher declaration check', () => {
    const { bus, received, attach } = setup();
    attach('viewer-1', 'viewer');
    bus.subscribe('viewer-1', 'viewer', ['email.received']);
    expect(bus.emit('email.received', { from: 'server' })).toBe(1);
    expect(received['viewer-1']).toEqual([
      ['email.received', { from: 'server' }],
    ]);
  });

  test('onActiveChange fires on the 0→1 and 1→0 transitions only', () => {
    const { bus } = setup();
    const changes: boolean[] = [];
    const stop = bus.onActiveChange((active) => changes.push(active));

    const a = bus.subscribe('f1', 'viewer', ['email.received']);
    const b = bus.subscribe('f2', 'viewer', ['email.received']);
    expect(changes).toEqual([true]);
    bus.unsubscribe('f1', a);
    expect(changes).toEqual([true]);
    bus.unsubscribe('f2', b);
    expect(changes).toEqual([true, false]);

    stop();
    bus.subscribe('f3', 'viewer', ['email.received']);
    expect(changes).toEqual([true, false]);
  });
});
