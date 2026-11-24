import { describe, expect, test } from 'bun:test';

import {
  EMAIL_HEADERS,
  forwardEmail,
  INBOUND_EMAIL_WEBHOOK_PATH,
  signEmail,
} from './email-forward';

const RAW = 'From: a@example.com\r\nTo: acme@in.example.com\r\n\r\nhi\r\n';

function message(raw = RAW) {
  const rejects: string[] = [];
  return {
    rejects,
    from: 'a@example.com',
    to: 'acme@in.example.com',
    raw: new Response(raw).body!,
    setReject(reason: string) {
      rejects.push(reason);
    },
  };
}

describe('Cloudflare email forwarder', () => {
  test('signature matches the shared test vector', async () => {
    expect(
      await signEmail({
        secret: 'cf-test-secret',
        timestamp: '1700000000',
        from: 'a@example.com',
        to: 'acme@in.example.com',
        raw: new TextEncoder().encode(RAW),
      }),
    ).toBe(
      'v1=4a157ef63b7bf9367aa226718ec4ca4a414d64ac6210552636d86dccc2daa133',
    );
  });

  test('posts signed raw MIME with the envelope', async () => {
    const msg = message();
    let seen: Request | undefined;
    const result = await forwardEmail(msg, {
      secret: 'cf-test-secret',
      nowSeconds: 1700000000,
      send: async (request) => {
        seen = request;
        return new Response('{}', { status: 200 });
      },
    });
    expect(result).toEqual({ ok: true, status: 200 });
    expect(msg.rejects).toEqual([]);
    expect(new URL(seen!.url).pathname).toBe(INBOUND_EMAIL_WEBHOOK_PATH);
    expect(seen!.headers.get('content-type')).toBe('message/rfc822');
    expect(seen!.headers.get(EMAIL_HEADERS.to)).toBe('acme@in.example.com');
    expect(seen!.headers.get(EMAIL_HEADERS.signature)).toBe(
      await signEmail({
        secret: 'cf-test-secret',
        timestamp: '1700000000',
        from: 'a@example.com',
        to: 'acme@in.example.com',
        raw: new TextEncoder().encode(RAW),
      }),
    );
    expect(await seen!.text()).toBe(RAW);
  });

  test('non-2xx and network failures reject the message', async () => {
    const unknown = message();
    await forwardEmail(unknown, {
      secret: 's',
      send: async () => new Response('', { status: 404 }),
    });
    expect(unknown.rejects).toEqual(['Unknown recipient']);

    const down = message();
    const result = await forwardEmail(down, {
      secret: 's',
      send: async () => {
        throw new Error('container unavailable');
      },
    });
    expect(result.ok).toBe(false);
    expect(down.rejects).toEqual(['Mailbox temporarily unavailable']);
  });

  test('missing secret rejects without sending', async () => {
    const msg = message();
    let sent = false;
    await forwardEmail(msg, {
      secret: undefined,
      send: async () => {
        sent = true;
        return new Response();
      },
    });
    expect(sent).toBe(false);
    expect(msg.rejects).toEqual(['Inbound email is not configured']);
  });
});
