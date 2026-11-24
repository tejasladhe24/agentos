import { timingSafeEqualString } from '@agentos/core/api/hmac';
import { verifyTimestampSkew } from '@agentos/core/api/webhook';

import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '../constants';
import { normalizeAddress } from '../http';
import type { InboundAttachment, NormalizedInboundEmail } from '../types';
import {
  ProviderUpstreamError,
  type InboundEmailProvider,
  type ProviderVerifyInput,
} from './types';

export const RESEND_API_BASE = 'https://api.resend.com';
export const RESEND_RECEIVED_EVENT = 'email.received';

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export class ResendApiError extends ProviderUpstreamError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = 'ResendApiError';
  }
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function bodyText(rawBody: string | Uint8Array): string {
  return typeof rawBody === 'string'
    ? rawBody
    : new TextDecoder().decode(rawBody);
}

/** Svix-format signature (`v1,<base64>`) over `<id>.<timestamp>.<body>`. */
export async function signResendWebhook(input: {
  secret: string;
  id: string;
  timestamp: string;
  body: string;
}): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    decodeBase64(input.secret.replace(/^whsec_/, '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${input.id}.${input.timestamp}.${input.body}`),
  );
  return `v1,${encodeBase64(new Uint8Array(sig))}`;
}

/**
 * Verify a Resend webhook (`svix-id`, `svix-timestamp`, `svix-signature`).
 * The signature header may list several space-separated `v1,<sig>` values
 * during secret rotation.
 */
export async function verifyResendWebhook(input: {
  secret: string;
  headers: Headers;
  rawBody: string | Uint8Array;
  nowSeconds?: number;
}): Promise<boolean> {
  if (!input.secret) return false;
  const id = input.headers.get('svix-id') ?? '';
  const timestamp = input.headers.get('svix-timestamp') ?? '';
  const header = input.headers.get('svix-signature') ?? '';
  if (!id || !timestamp || !header) return false;
  if (!verifyTimestampSkew({ timestamp, nowSeconds: input.nowSeconds })) {
    return false;
  }
  let expected: string;
  try {
    expected = await signResendWebhook({
      secret: input.secret,
      id,
      timestamp,
      body: bodyText(input.rawBody),
    });
  } catch {
    return false;
  }
  return header
    .split(' ')
    .filter(Boolean)
    .some((candidate) => timingSafeEqualString(candidate, expected));
}

export type ResendReceivedEmail = {
  id: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  text?: string | null;
  html?: string | null;
  message_id?: string;
};

export type ResendReceivedAttachment = {
  id: string;
  filename?: string;
  content_type?: string;
  size?: number;
  download_url?: string;
};

export type ResendWebhook = { id: string; signingSecret?: string };

export type ResendClient = {
  getReceivedEmail: (emailId: string) => Promise<ResendReceivedEmail>;
  listReceivedAttachments: (
    emailId: string,
  ) => Promise<ResendReceivedAttachment[]>;
  download: (url: string) => Promise<Uint8Array>;
  createWebhook: (endpoint: string) => Promise<ResendWebhook>;
  updateWebhook: (webhookId: string, endpoint: string) => Promise<void>;
  getWebhook: (webhookId: string) => Promise<{ id: string; status?: string }>;
  deleteWebhook: (webhookId: string) => Promise<void>;
};

export function createResendClient(options: {
  apiKey: string;
  fetchImpl?: FetchImpl;
  apiBase?: string;
}): ResendClient {
  const fetchImpl: FetchImpl = options.fetchImpl ?? fetch;
  const base = (options.apiBase ?? RESEND_API_BASE).replace(/\/+$/, '');

  const call = async <T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> => {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const payload = (await res.json()) as { message?: string };
        if (payload.message) detail = payload.message;
      } catch {
        // non-JSON error body
      }
      throw new ResendApiError(
        res.status,
        `Resend ${method} ${path} failed (${res.status}): ${detail}`,
      );
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  };

  return {
    getReceivedEmail(emailId) {
      return call('GET', `/emails/receiving/${encodeURIComponent(emailId)}`);
    },
    async listReceivedAttachments(emailId) {
      const payload = await call<{ data?: ResendReceivedAttachment[] }>(
        'GET',
        `/emails/receiving/${encodeURIComponent(emailId)}/attachments`,
      );
      return payload?.data ?? [];
    },
    async download(url) {
      const res = await fetchImpl(url);
      if (!res.ok) {
        throw new ResendApiError(
          res.status,
          `attachment download failed (${res.status})`,
        );
      }
      return new Uint8Array(await res.arrayBuffer());
    },
    async createWebhook(endpoint) {
      const payload = await call<{ id: string; signing_secret?: string }>(
        'POST',
        '/webhooks',
        { endpoint, events: [RESEND_RECEIVED_EVENT] },
      );
      return { id: payload.id, signingSecret: payload.signing_secret };
    },
    async updateWebhook(webhookId, endpoint) {
      await call('PATCH', `/webhooks/${encodeURIComponent(webhookId)}`, {
        endpoint,
        events: [RESEND_RECEIVED_EVENT],
        status: 'enabled',
      });
    },
    getWebhook(webhookId) {
      return call('GET', `/webhooks/${encodeURIComponent(webhookId)}`);
    },
    async deleteWebhook(webhookId) {
      await call('DELETE', `/webhooks/${encodeURIComponent(webhookId)}`);
    },
  };
}

type ResendWebhookEvent = {
  type?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[] | string;
    subject?: string;
  };
};

function parseEvent(rawBody: string | Uint8Array): ResendWebhookEvent {
  const parsed = JSON.parse(bodyText(rawBody) || '{}') as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('resend payload must be a JSON object');
  }
  return parsed as ResendWebhookEvent;
}

function toList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return raw.map((v) => normalizeAddress(String(v))).filter(Boolean);
}

/**
 * Fetch body + attachments for a received email. Attachment download URLs
 * expire after an hour, so this runs inline in the webhook; a failure returns
 * 5xx and Resend retries the delivery.
 */
export async function fetchResendEmail(
  client: ResendClient,
  emailId: string,
  hint: { to: string[]; from: string; subject: string },
): Promise<NormalizedInboundEmail> {
  const email = await client.getReceivedEmail(emailId);
  const listed = await client.listReceivedAttachments(emailId);
  const attachments: InboundAttachment[] = [];
  for (const att of listed.slice(0, MAX_ATTACHMENTS)) {
    if (!att.download_url) continue;
    if (att.size !== undefined && att.size > MAX_ATTACHMENT_BYTES) continue;
    const bytes = await client.download(att.download_url);
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) continue;
    attachments.push({
      filename: att.filename || `${att.id}.bin`,
      contentType: att.content_type || 'application/octet-stream',
      bytes,
    });
  }
  const to = toList(email.to);
  return {
    deliveryId: emailId,
    to: to.length > 0 ? to : hint.to,
    from: normalizeAddress(email.from || hint.from) || 'unknown@example.com',
    subject: email.subject ?? hint.subject,
    text: email.text || undefined,
    html: email.html || undefined,
    attachments,
    provider: 'resend',
  };
}

export type ResendProviderOptions = {
  signingSecret: string;
  apiKey: string;
  fetchImpl?: FetchImpl;
  apiBase?: string;
};

/**
 * Resend inbound adapter: verifies the Svix signature, ignores events other
 * than `email.received`, and fetches the body/attachments with `apiKey`.
 */
export function createResendInboundProvider(
  options: ResendProviderOptions,
): InboundEmailProvider {
  return {
    name: 'resend',
    verify(input: ProviderVerifyInput) {
      return verifyResendWebhook({
        secret: options.signingSecret,
        headers: input.headers,
        rawBody: input.rawBody,
      });
    },
    async parse(input) {
      const event = parseEvent(input.rawBody);
      if (event.type !== RESEND_RECEIVED_EVENT) return null;
      const emailId = event.data?.email_id;
      if (!emailId) throw new Error('resend payload missing data.email_id');
      if (!options.apiKey) {
        throw new Error('resend api key not configured');
      }
      return fetchResendEmail(
        createResendClient({
          apiKey: options.apiKey,
          fetchImpl: options.fetchImpl,
          apiBase: options.apiBase,
        }),
        emailId,
        {
          to: toList(event.data?.to),
          from: event.data?.from ?? '',
          subject: event.data?.subject ?? '',
        },
      );
    },
  };
}
