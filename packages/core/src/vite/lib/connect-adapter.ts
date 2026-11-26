import type { IncomingMessage, ServerResponse } from 'node:http';

import type { GatewayHandler } from '@agentos/core/gateway/lib/types';

/** Vite / Connect middleware signature. */
export type ConnectMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;

/**
 * Wrap `IncomingMessage` body as a ReadableStream that only attaches listeners
 * on first pull — so unmatched handlers can `next()` without consuming the body.
 */
function lazyBodyStream(req: IncomingMessage): ReadableStream<Uint8Array> {
  let attached = false;
  return new ReadableStream({
    pull(controller) {
      if (attached) return;
      attached = true;
      req.on('data', (chunk: Buffer | string) => {
        const bytes =
          typeof chunk === 'string'
            ? new TextEncoder().encode(chunk)
            : new Uint8Array(chunk);
        controller.enqueue(bytes);
      });
      req.on('end', () => {
        controller.close();
      });
      req.on('error', (err) => {
        controller.error(err);
      });
    },
    cancel() {
      req.resume();
    },
  });
}

/** Build a Fetch `Request` from a Connect/Node incoming message. */
export function connectToFetchRequest(req: IncomingMessage): Request {
  const incomingHeaders = req.headers ?? {};
  const host = incomingHeaders.host ?? 'localhost';
  const url = new URL(req.url ?? '/', `http://${host}`);
  const method = (req.method ?? 'GET').toUpperCase();

  const headers = new Headers();
  for (const [name, value] of Object.entries(incomingHeaders)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(name, v);
    } else {
      headers.set(name, value);
    }
  }

  const hasBody = method !== 'GET' && method !== 'HEAD';
  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
  };
  if (hasBody) {
    init.body = lazyBodyStream(req);
    init.duplex = 'half';
  }

  return new Request(url, init);
}

/**
 * Write a Fetch `Response` onto a Connect/Node server response.
 *
 * Streams chunk by chunk. Buffering with `arrayBuffer()` would hold SSE
 * (`/api/ext/events/subscribe`) until upstream closed, so events never reached
 * the browser in dev. When the browser disconnects, the upstream reader is
 * cancelled so the upstream subscription closes too.
 */
export async function writeFetchResponse(
  res: ServerResponse,
  response: Response,
): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    res.setHeader(name, value);
  });
  if (response.body == null) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  res.on('close', () => {
    void reader.cancel().catch(() => undefined);
  });

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) {
        await new Promise<void>((resolve) => {
          const done = () => {
            res.off('drain', done);
            res.off('close', done);
            resolve();
          };
          res.once('drain', done);
          res.once('close', done);
        });
      }
    }
  } catch {
    // Upstream dropped mid-stream. End below; EventSource clients reconnect.
  }
  res.end();
}

/**
 * Bridge a portable gateway handler into Vite Connect middleware.
 * `null` from the handler calls `next()`.
 */
export function toConnectMiddleware(
  handler: GatewayHandler,
): ConnectMiddleware {
  return (req, res, next) => {
    void (async () => {
      const request = connectToFetchRequest(req);
      const response = await handler(request);
      if (response == null) {
        next();
        return;
      }
      await writeFetchResponse(res, response);
    })().catch((err) => {
      next(err);
    });
  };
}
