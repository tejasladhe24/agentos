/**
 * Cloudflare Email Routing → AgentOS inbound-email. The Worker's `email()`
 * handler signs the raw MIME + SMTP envelope and posts it to the container.
 *
 * The signing scheme must match `createCloudflareInboundProvider` in
 * `packages/core/builtins/inbound-email/api/lib/providers/cloudflare.ts`.
 */

export const INBOUND_EMAIL_WEBHOOK_PATH =
  '/api/ext/inbound-email/webhooks/cloudflare';

export const EMAIL_HEADERS = {
  timestamp: 'x-agentos-email-timestamp',
  from: 'x-agentos-email-from',
  to: 'x-agentos-email-to',
  signature: 'x-agentos-email-signature',
} as const;

/** Subset of `ForwardableEmailMessage` used here (keeps the helper testable). */
export type InboundEmailMessage = {
  readonly from: string;
  readonly to: string;
  readonly raw: ReadableStream<Uint8Array>;
  setReject(reason: string): void;
};

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function signEmail(input: {
  secret: string;
  timestamp: string;
  from: string;
  to: string;
  raw: Uint8Array;
}): Promise<string> {
  const prefix = new TextEncoder().encode(
    `${input.timestamp}\n${input.from}\n${input.to}\n`,
  );
  const message = new Uint8Array(prefix.byteLength + input.raw.byteLength);
  message.set(prefix, 0);
  message.set(input.raw, prefix.byteLength);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(input.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return `v1=${toHex(await crypto.subtle.sign('HMAC', key, message))}`;
}

function rejectReason(status: number): string {
  if (status === 404) return 'Unknown recipient';
  if (status === 401) return 'Message rejected';
  if (status >= 500) return 'Mailbox temporarily unavailable';
  return 'Message rejected';
}

/**
 * Forward one inbound message. Any non-2xx (or a network failure) rejects
 * the message so the sender gets a bounce instead of silent loss.
 */
export async function forwardEmail(
  message: InboundEmailMessage,
  options: {
    secret: string | undefined;
    send: (request: Request) => Promise<Response>;
    origin?: string;
    nowSeconds?: number;
  },
): Promise<{ ok: boolean; status: number }> {
  if (!options.secret) {
    message.setReject('Inbound email is not configured');
    return { ok: false, status: 0 };
  }
  const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
  const timestamp = String(options.nowSeconds ?? Math.floor(Date.now() / 1000));
  const signature = await signEmail({
    secret: options.secret,
    timestamp,
    from: message.from,
    to: message.to,
    raw,
  });
  const origin = (options.origin ?? 'http://agentos.internal').replace(
    /\/+$/,
    '',
  );
  let status = 0;
  try {
    const res = await options.send(
      new Request(`${origin}${INBOUND_EMAIL_WEBHOOK_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'message/rfc822',
          [EMAIL_HEADERS.timestamp]: timestamp,
          [EMAIL_HEADERS.from]: message.from,
          [EMAIL_HEADERS.to]: message.to,
          [EMAIL_HEADERS.signature]: signature,
        },
        body: raw,
      }),
    );
    status = res.status;
    await res.body?.cancel();
  } catch {
    status = 0;
  }
  const ok = status >= 200 && status < 300;
  if (!ok) message.setReject(rejectReason(status || 503));
  return { ok, status };
}
