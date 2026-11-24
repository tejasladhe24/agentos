import PostalMime from 'postal-mime';

import { hmacSha256Hex, timingSafeEqualString } from '@agentos/core/api/hmac';
import { verifyTimestampSkew } from '@agentos/core/api/webhook';

import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '../constants';
import { normalizeAddress } from '../http';
import type {
  EmailAuthentication,
  InboundAttachment,
  NormalizedInboundEmail,
} from '../types';
import type { InboundEmailProvider, ProviderVerifyInput } from './types';

/**
 * Headers set by the Cloudflare Email Worker (`deploy/cloudflare`). The
 * signature covers the envelope and the raw MIME so neither can be swapped.
 */
export const CLOUDFLARE_EMAIL_HEADERS = {
  timestamp: 'x-agentos-email-timestamp',
  from: 'x-agentos-email-from',
  to: 'x-agentos-email-to',
  signature: 'x-agentos-email-signature',
} as const;

const SIGNATURE_PREFIX = 'v1=';
const CLOUDFLARE_AUTHSERV_ID = 'mx.cloudflare.net';

function toBytes(raw: string | Uint8Array): Uint8Array {
  return typeof raw === 'string' ? new TextEncoder().encode(raw) : raw;
}

/** `v1=<hex>` HMAC-SHA256 over `<timestamp>\n<from>\n<to>\n` + raw MIME. */
export async function signCloudflareEmail(input: {
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
  return `${SIGNATURE_PREFIX}${await hmacSha256Hex(input.secret, message)}`;
}

/**
 * Read SPF / DKIM / DMARC verdicts from the `Authentication-Results` header
 * added by Cloudflare's MX. Headers from other authserv-ids are ignored —
 * the sender controls those.
 */
export function parseCloudflareAuthentication(
  headers: Array<{ key: string; value: string }>,
): EmailAuthentication | undefined {
  const header = headers.find(
    (h) =>
      h.key.toLowerCase() === 'authentication-results' &&
      h.value.trim().toLowerCase().startsWith(CLOUDFLARE_AUTHSERV_ID),
  );
  if (!header) return undefined;
  const result: EmailAuthentication = {};
  for (const method of ['spf', 'dkim', 'dmarc'] as const) {
    const match = header.value.match(new RegExp(`\\b${method}=([a-z]+)`, 'i'));
    if (match?.[1]) result[method] = match[1].toLowerCase();
  }
  return result;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function attachmentBytes(content: ArrayBuffer | Uint8Array | string) {
  if (typeof content === 'string') return new TextEncoder().encode(content);
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

export type CloudflareProviderOptions = {
  /** Shared with the Email Worker (`AGENT_OS_EXT_INBOUND_EMAIL_CLOUDFLARE_SECRET`). */
  secret: string;
};

/**
 * Cloudflare Email Routing adapter: the Email Worker posts raw MIME
 * (`message/rfc822`) with the SMTP envelope in signed headers. Routing uses
 * the envelope recipient only; header `To` is kept for display.
 */
export function createCloudflareInboundProvider(
  options: CloudflareProviderOptions,
): InboundEmailProvider {
  return {
    name: 'cloudflare',
    async verify(input: ProviderVerifyInput) {
      if (!options.secret) return false;
      const h = CLOUDFLARE_EMAIL_HEADERS;
      const timestamp = input.headers.get(h.timestamp) ?? '';
      const from = input.headers.get(h.from) ?? '';
      const to = input.headers.get(h.to) ?? '';
      const signature = input.headers.get(h.signature) ?? '';
      if (!timestamp || !to || !signature) return false;
      if (!verifyTimestampSkew({ timestamp })) return false;
      const expected = await signCloudflareEmail({
        secret: options.secret,
        timestamp,
        from,
        to,
        raw: toBytes(input.rawBody),
      });
      return timingSafeEqualString(expected, signature);
    },
    async parse(input): Promise<NormalizedInboundEmail> {
      const raw = toBytes(input.rawBody);
      if (raw.byteLength === 0) throw new Error('empty MIME message');
      const envelopeTo = normalizeAddress(
        input.headers.get(CLOUDFLARE_EMAIL_HEADERS.to) ?? '',
      );
      if (!envelopeTo) throw new Error('missing envelope recipient');
      const envelopeFrom = normalizeAddress(
        input.headers.get(CLOUDFLARE_EMAIL_HEADERS.from) ?? '',
      );

      const email = await PostalMime.parse(raw);
      const headerTo = (email.to ?? [])
        .map((a) => normalizeAddress(a.address ?? ''))
        .filter(Boolean);
      const attachments: InboundAttachment[] = [];
      for (const att of email.attachments.slice(0, MAX_ATTACHMENTS)) {
        const bytes = attachmentBytes(att.content);
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
          continue;
        }
        attachments.push({
          filename: att.filename || 'attachment.bin',
          contentType: att.mimeType || 'application/octet-stream',
          bytes,
        });
      }
      const messageId = email.messageId?.replace(/^<|>$/g, '').trim();
      const authentication = parseCloudflareAuthentication(email.headers);

      return {
        deliveryId: messageId || `sha256:${await sha256Hex(raw)}`,
        to: [...new Set([envelopeTo, ...headerTo])],
        routeTo: [envelopeTo],
        from:
          normalizeAddress(email.from?.address ?? '') ||
          envelopeFrom ||
          'unknown@example.com',
        subject: email.subject ?? '',
        text: email.text || undefined,
        html: email.html || undefined,
        attachments,
        provider: 'cloudflare',
        ...(authentication ? { authentication } : {}),
      };
    },
  };
}
