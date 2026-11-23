import { describe, expect, test } from 'bun:test';

import { hmacSha256Hex } from '@agentos/core/api/hmac';
import {
  verifyAndHandleWebhook,
  verifyTimestampSkew,
  verifyWebhookSignature,
  WebhookVerifyError,
  withIdempotency,
  type IdempotencyStore,
} from '@agentos/core/api/webhook';

function memoryStore(): IdempotencyStore & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    async get(key) {
      return map.has(key) ? map.get(key)! : null;
    },
    async set(key, value) {
      map.set(key, value);
    },
  };
}

describe('webhook signature', () => {
  test('accepts valid hex HMAC and rejects mismatch', async () => {
    const secret = 'whsec_test_secret';
    const rawBody = '{"id":"evt_1","type":"invoice.updated"}';
    const signature = await hmacSha256Hex(secret, rawBody);

    expect(await verifyWebhookSignature({ rawBody, secret, signature })).toBe(
      true,
    );
    expect(
      await verifyWebhookSignature({
        rawBody,
        secret,
        signature: 'deadbeef',
      }),
    ).toBe(false);
    expect(
      await verifyWebhookSignature({
        rawBody,
        secret,
        signature: `sha256=${signature}`,
        prefix: 'sha256=',
      }),
    ).toBe(true);
  });
});

describe('webhook timestamp skew', () => {
  test('accepts within window and rejects replay outside skew', () => {
    const now = 1_700_000_000;
    expect(
      verifyTimestampSkew({
        timestamp: now - 10,
        skewSeconds: 300,
        nowSeconds: now,
      }),
    ).toBe(true);
    expect(
      verifyTimestampSkew({
        timestamp: now - 301,
        skewSeconds: 300,
        nowSeconds: now,
      }),
    ).toBe(false);
    expect(
      verifyTimestampSkew({
        timestamp: (now - 5) * 1000,
        skewSeconds: 60,
        nowSeconds: now,
      }),
    ).toBe(true);
  });
});

describe('webhook idempotency', () => {
  test('runs once then returns duplicate for same key', async () => {
    const store = memoryStore();
    let runs = 0;
    const first = await withIdempotency({
      key: 'evt_1',
      store,
      run: async () => {
        runs += 1;
        return { ok: true, n: runs };
      },
    });
    const second = await withIdempotency({
      key: 'evt_1',
      store,
      run: async () => {
        runs += 1;
        return { ok: true, n: runs };
      },
    });
    expect(first).toEqual({ status: 'executed', result: { ok: true, n: 1 } });
    expect(second).toEqual({ status: 'duplicate', result: { ok: true, n: 1 } });
    expect(runs).toBe(1);
  });

  test('verifyAndHandleWebhook rejects bad signature before side effects', async () => {
    const store = memoryStore();
    let runs = 0;
    await expect(
      verifyAndHandleWebhook({
        rawBody: '{"id":"evt_2"}',
        secret: 'whsec',
        signature: 'bad',
        timestamp: Math.floor(Date.now() / 1000),
        idempotencyKey: 'evt_2',
        store,
        run: async () => {
          runs += 1;
          return { ok: true };
        },
      }),
    ).rejects.toBeInstanceOf(WebhookVerifyError);
    expect(runs).toBe(0);
  });

  test('verifyAndHandleWebhook rejects stale timestamp', async () => {
    const store = memoryStore();
    let runs = 0;
    const secret = 'whsec';
    const rawBody = '{"id":"evt_3"}';
    const signature = await hmacSha256Hex(secret, rawBody);
    await expect(
      verifyAndHandleWebhook({
        rawBody,
        secret,
        signature,
        timestamp: Math.floor(Date.now() / 1000) - 10_000,
        skewSeconds: 60,
        idempotencyKey: 'evt_3',
        store,
        run: async () => {
          runs += 1;
          return { ok: true };
        },
      }),
    ).rejects.toMatchObject({ code: 'timestamp' });
    expect(runs).toBe(0);
  });
});
