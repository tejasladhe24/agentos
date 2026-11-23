import { getSecret } from '@agentos/core/api/secrets';
import {
  verifyAndHandleWebhook,
  WebhookVerifyError,
} from '@agentos/core/api/webhook';
import type { RouteHandlers } from '@agentos/core/api';

/**
 * Example inbound webhook (ticket 78) — open prefix.
 * Verifies HMAC + timestamp skew, dedupes via cache-store idempotency.
 */
export const POST: RouteHandlers['POST'] = async (c) => {
  const rawBody = await c.req.text();
  const signature =
    c.req.headers.get('x-signature') ??
    c.req.headers.get('x-hub-signature-256') ??
    '';
  const timestamp =
    c.req.headers.get('x-timestamp') ??
    c.req.headers.get('x-webhook-timestamp');
  const deliveryId =
    c.req.headers.get('x-delivery-id') ??
    c.req.headers.get('idempotency-key') ??
    '';

  if (!deliveryId) {
    return c.json({ error: 'missing_delivery_id' }, { status: 400 });
  }

  const orgId = c.req.headers.get('x-agentos-org-id');
  if (!orgId) {
    return c.json({ error: 'org_required' }, { status: 400 });
  }

  let secretValue: string;
  try {
    const secret = await getSecret(
      'integrations/example/webhook_secret',
      undefined,
      {
        orgId,
      },
    );
    secretValue = secret.value;
  } catch {
    secretValue = Bun.env.AGENT_OS_EXT_DEMO_WEBHOOK_SECRET ?? '';
  }
  if (!secretValue) {
    return c.json({ error: 'webhook_secret_missing' }, { status: 500 });
  }

  try {
    const result = await verifyAndHandleWebhook({
      rawBody,
      secret: secretValue,
      signature,
      prefix: signature.startsWith('sha256=') ? 'sha256=' : undefined,
      timestamp: timestamp ?? undefined,
      idempotencyKey: `${orgId}:${deliveryId}`,
      run: async () => {
        const payload = rawBody ? JSON.parse(rawBody) : {};
        return { received: true, payload };
      },
    });
    return c.json(result);
  } catch (err) {
    if (err instanceof WebhookVerifyError) {
      return c.json({ error: err.code }, { status: 401 });
    }
    throw err;
  }
};
