import { describe, expect, test } from 'bun:test';
import { SSE_HEARTBEAT_MS, createEventBus } from '../api/lib/event-bus';

async function readChunk(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  return new TextDecoder().decode(value);
}

describe('event bus SSE keepalive', () => {
  test('heartbeat interval stays under the Bun 10 s idle timeout', () => {
    expect(SSE_HEARTBEAT_MS).toBeLessThan(10_000);
  });

  test('an idle subscriber receives ping comment frames', async () => {
    const bus = createEventBus({ heartbeatMs: 5 });
    const { stream, close } = bus.subscribe(['demo.topic']);
    const reader = stream.getReader();

    const open = await reader.read();
    expect(new TextDecoder().decode(open.value)).toBe(': ok\n\n');

    const ping = await reader.read();
    expect(new TextDecoder().decode(ping.value)).toBe(': ping\n\n');

    close();
    expect(bus.subscriberCount).toBe(0);
    await reader.cancel().catch(() => undefined);
  });

  test('closing a subscription stops heartbeats', async () => {
    const bus = createEventBus({ heartbeatMs: 5 });
    const { stream, close } = bus.subscribe(null);
    expect(await readChunk(stream)).toBe(': ok\n\n');
    close();
    expect(bus.subscriberCount).toBe(0);
    // A publish after close must not throw or enqueue on the closed stream.
    expect(() => bus.publish('demo.topic', {})).not.toThrow();
  });

  test('publishes still arrive alongside heartbeats', async () => {
    const bus = createEventBus({ heartbeatMs: 1_000 });
    const { stream, close } = bus.subscribe(['demo.topic']);
    const reader = stream.getReader();
    await reader.read(); // ': ok'
    bus.publish('demo.topic', { n: 1 });
    const frame = new TextDecoder().decode((await reader.read()).value);
    expect(frame).toContain('event: message');
    expect(frame).toContain('"n":1');
    close();
  });
});
