import {
  verifyTimestampSkew,
  verifyWebhookSignature,
} from '@agentos/core/api/webhook';

import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '../constants';
import { normalizeAddress } from '../http';
import type { InboundAttachment, NormalizedInboundEmail } from '../types';
import type { InboundEmailProvider } from './types';

export type FixtureProviderOptions = {
  secret: string;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseAttachments(raw: unknown): InboundAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: InboundAttachment[] = [];
  for (const item of raw.slice(0, MAX_ATTACHMENTS)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const filename = asString(row.filename) || 'attachment.bin';
    const contentType =
      asString(row.contentType) ||
      asString(row.content_type) ||
      'application/octet-stream';
    const b64 = asString(row.base64) || asString(row.data);
    if (!b64) continue;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) continue;
    out.push({ filename, contentType, bytes });
  }
  return out;
}

/**
 * Demo / test provider: JSON body with HMAC-SHA256 hex signature
 * (`x-signature` or `x-hub-signature-256`) and optional `x-timestamp`.
 */
export function createFixtureProvider(
  options: FixtureProviderOptions,
): InboundEmailProvider {
  return {
    name: 'fixture',
    async verify(input) {
      if (!options.secret) return false;
      const signature =
        input.headers.get('x-signature') ??
        input.headers.get('x-hub-signature-256') ??
        '';
      const prefix = signature.startsWith('sha256=') ? 'sha256=' : undefined;
      const ok = await verifyWebhookSignature({
        rawBody: input.rawBody,
        secret: options.secret,
        signature,
        encoding: 'hex',
        prefix,
      });
      if (!ok) return false;
      const timestamp =
        input.headers.get('x-timestamp') ??
        input.headers.get('x-webhook-timestamp');
      if (timestamp != null && timestamp !== '') {
        return verifyTimestampSkew({ timestamp });
      }
      return true;
    },
    async parse(input): Promise<NormalizedInboundEmail> {
      const text =
        typeof input.rawBody === 'string'
          ? input.rawBody
          : new TextDecoder().decode(input.rawBody);
      const body = JSON.parse(text || '{}') as Record<string, unknown>;
      const deliveryId =
        asString(body.deliveryId) ||
        asString(body.id) ||
        asString(body.messageId) ||
        input.headers.get('x-delivery-id') ||
        '';
      if (!deliveryId) {
        throw new Error('fixture payload missing deliveryId');
      }
      const toRaw = body.to;
      const to = Array.isArray(toRaw)
        ? toRaw.map((v) => normalizeAddress(String(v))).filter(Boolean)
        : asString(toRaw)
          ? [normalizeAddress(asString(toRaw))]
          : [];
      if (to.length === 0) {
        throw new Error('fixture payload missing to');
      }
      return {
        deliveryId,
        to,
        from: normalizeAddress(asString(body.from) || 'unknown@example.com'),
        subject: asString(body.subject),
        text: asString(body.text) || undefined,
        html: asString(body.html) || undefined,
        attachments: parseAttachments(body.attachments),
        provider: 'fixture',
      };
    },
  };
}
