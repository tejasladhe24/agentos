import { describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { toConnectMiddleware } from '../lib/connect-adapter';

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

describe('toConnectMiddleware streaming', () => {
  test('streams the first chunk before the upstream body finishes', async () => {
    let releaseSecond!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const enc = new TextEncoder();

    const handler = toConnectMiddleware(async () => {
      return new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(enc.encode('data: first\n\n'));
            await gate;
            controller.enqueue(enc.encode('data: second\n\n'));
            controller.close();
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    });

    const server = createServer((req, res) => {
      handler(req, res, () => {
        res.statusCode = 500;
        res.end();
      });
    });
    const port = await listen(server);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(res.headers.get('content-type')).toBe('text/event-stream');
      const reader = res.body!.getReader();
      const first = await reader.read();
      // The first event arrived while the second is still gated upstream.
      expect(new TextDecoder().decode(first.value)).toContain('first');
      releaseSecond();
      let rest = '';
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        rest += new TextDecoder().decode(chunk.value);
      }
      expect(rest).toContain('second');
    } finally {
      releaseSecond();
      server.close();
    }
  });
});
