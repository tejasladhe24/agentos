import { hmacSha256Hex, timingSafeEqualString } from '@agentos/core/api/hmac';
import { verifyTimestampSkew } from '@agentos/core/api/webhook';

import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '../constants';
import { normalizeAddress } from '../http';
import type { InboundAttachment, NormalizedInboundEmail } from '../types';
import type { InboundEmailProvider } from './types';

export type MailgunProviderOptions = {
  /** Mailgun signing key (HTTP webhook signing key / API key). */
  signingKey: string;
};

async function readAttachment(
  form: FormData,
  index: number,
): Promise<InboundAttachment | null> {
  const entry = form.get(`attachment-${index}`);
  if (typeof entry === 'string' || entry == null) return null;
  // FormData file parts are Blob/File in Bun; avoid `instanceof Blob` after
  // excluding File (TS narrows FormDataEntryValue to string).
  const file = entry as Blob & { name?: string };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return null;
  }
  const filename =
    typeof file.name === 'string' && file.name.length > 0
      ? file.name
      : `attachment-${index}.bin`;
  const fromForm = String(
    form.get(`attachment-${index}-content-type`) ?? '',
  ).trim();
  const contentType =
    (file.type && file.type.length > 0 ? file.type : '') ||
    fromForm ||
    'application/octet-stream';
  return { filename, contentType, bytes };
}

/**
 * Mailgun Inbound Parse webhook adapter.
 * Signature: HMAC-SHA256(signingKey, timestamp + token) as hex.
 */
export function createMailgunProvider(
  options: MailgunProviderOptions,
): InboundEmailProvider {
  return {
    name: 'mailgun',
    async verify(input) {
      if (!options.signingKey) return false;
      const form = input.form;
      if (!form) return false;
      const timestamp = String(form.get('timestamp') ?? '');
      const token = String(form.get('token') ?? '');
      const signature = String(form.get('signature') ?? '');
      if (!timestamp || !token || !signature) return false;
      if (!verifyTimestampSkew({ timestamp })) return false;
      const expected = await hmacSha256Hex(
        options.signingKey,
        `${timestamp}${token}`,
      );
      return timingSafeEqualString(expected, signature.toLowerCase());
    },
    async parse(input): Promise<NormalizedInboundEmail> {
      const form = input.form;
      if (!form) throw new Error('mailgun webhook requires multipart form');

      const recipient = normalizeAddress(String(form.get('recipient') ?? ''));
      const toField = String(form.get('To') ?? form.get('to') ?? '');
      const to = [
        ...(recipient ? [recipient] : []),
        ...toField
          .split(',')
          .map((p) => normalizeAddress(p))
          .filter(Boolean),
      ];
      const uniqueTo = [...new Set(to)];
      if (uniqueTo.length === 0) {
        throw new Error('mailgun payload missing recipient');
      }

      const deliveryId =
        String(form.get('Message-Id') ?? '') ||
        String(form.get('message-id') ?? '') ||
        String(form.get('token') ?? '');
      if (!deliveryId) {
        throw new Error('mailgun payload missing message id');
      }

      const countRaw = Number(form.get('attachment-count') ?? 0);
      const count = Number.isFinite(countRaw)
        ? Math.min(Math.max(0, Math.floor(countRaw)), MAX_ATTACHMENTS)
        : 0;
      const attachments: InboundAttachment[] = [];
      for (let i = 1; i <= count; i++) {
        const att = await readAttachment(form, i);
        if (att) attachments.push(att);
      }

      return {
        deliveryId,
        to: uniqueTo,
        from: normalizeAddress(
          String(
            form.get('sender') ?? form.get('from') ?? 'unknown@example.com',
          ),
        ),
        subject: String(form.get('subject') ?? ''),
        text: String(form.get('body-plain') ?? '') || undefined,
        html: String(form.get('body-html') ?? '') || undefined,
        attachments,
        provider: 'mailgun',
      };
    },
  };
}
