/**
 * @agentos/core/api/inbound-email — HTTP client for builtin `inbound-email` (ticket 99).
 */

import { jsonFetch, resolveExtApiBase, type EnvMap } from './http';

/** Resolve builtin inbound-email API base. */
export function resolveInboundEmailApiBase(env: EnvMap = Bun.env): string {
  return resolveExtApiBase(
    'inbound-email',
    'AGENT_OS_INBOUND_EMAIL_API_BASE',
    env,
  );
}

export const INBOUND_EMAIL_ORG_ID_HEADER = 'x-agentos-org-id';

export type StoredAttachment = {
  filename: string;
  contentType: string;
  key: string;
  bytes: number;
};

export type InboundMessage = {
  id: string;
  orgId: string;
  deliveryId: string;
  provider: string;
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  attachments: StoredAttachment[];
  receivedAt: string;
  readAt?: string;
  /** SPF / DKIM / DMARC verdicts from the receiving MX (Cloudflare inbound). */
  authentication?: { spf?: string; dkim?: string; dmarc?: string };
};

export type InboundAddress = {
  id: string;
  address: string;
  orgId: string;
  purpose?: string;
  createdAt: string;
};

export type ListMessagesInput = {
  limit?: number;
  offset?: number;
  from?: string;
  to?: string;
  q?: string;
};

export type InboundEmailCallInit = {
  headers?: HeadersInit;
  orgId?: string;
};

function inboundHeaders(init?: InboundEmailCallInit): Headers {
  const headers = new Headers(init?.headers);
  if (init?.orgId) {
    headers.set(INBOUND_EMAIL_ORG_ID_HEADER, init.orgId);
  }
  return headers;
}

/** List inbound messages for an org (`GET /messages`). */
export async function listMessages(
  input: ListMessagesInput = {},
  env?: EnvMap,
  init?: InboundEmailCallInit,
): Promise<InboundMessage[]> {
  const base = resolveInboundEmailApiBase(env ?? Bun.env);
  const params = new URLSearchParams();
  if (input.limit !== undefined) params.set('limit', String(input.limit));
  if (input.offset !== undefined) params.set('offset', String(input.offset));
  if (input.from) params.set('from', input.from);
  if (input.to) params.set('to', input.to);
  if (input.q) params.set('q', input.q);
  const qs = params.toString();
  const result = await jsonFetch<{ messages: InboundMessage[] }>(
    `${base}/messages${qs ? `?${qs}` : ''}`,
    { method: 'GET', headers: inboundHeaders(init) },
    'inbound-email listMessages',
  );
  return result.messages;
}

/** Get one inbound message (`GET /messages/:id`). */
export async function getMessage(
  id: string,
  env?: EnvMap,
  init?: InboundEmailCallInit,
): Promise<InboundMessage> {
  const base = resolveInboundEmailApiBase(env ?? Bun.env);
  const result = await jsonFetch<{ message: InboundMessage }>(
    `${base}/messages/${encodeURIComponent(id)}`,
    { method: 'GET', headers: inboundHeaders(init) },
    'inbound-email getMessage',
  );
  return result.message;
}

/** Mark message read (`PATCH /messages/:id`). */
export async function markMessageRead(
  id: string,
  env?: EnvMap,
  init?: InboundEmailCallInit,
): Promise<InboundMessage> {
  const base = resolveInboundEmailApiBase(env ?? Bun.env);
  const result = await jsonFetch<{ message: InboundMessage }>(
    `${base}/messages/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: { read: true },
      headers: inboundHeaders(init),
    },
    'inbound-email markMessageRead',
  );
  return result.message;
}

/** List inbound addresses for an org (`GET /addresses`). */
export async function listAddresses(
  env?: EnvMap,
  init?: InboundEmailCallInit,
): Promise<InboundAddress[]> {
  const base = resolveInboundEmailApiBase(env ?? Bun.env);
  const result = await jsonFetch<{ addresses: InboundAddress[] }>(
    `${base}/addresses`,
    { method: 'GET', headers: inboundHeaders(init) },
    'inbound-email listAddresses',
  );
  return result.addresses;
}

/** Provision an inbound address (`POST /addresses`). */
export async function provisionAddress(
  input: { address: string; orgId?: string; purpose?: string },
  env?: EnvMap,
  init?: InboundEmailCallInit,
): Promise<InboundAddress> {
  const base = resolveInboundEmailApiBase(env ?? Bun.env);
  const result = await jsonFetch<{ ok: true; address: InboundAddress }>(
    `${base}/addresses`,
    {
      method: 'POST',
      body: input,
      headers: inboundHeaders(init),
    },
    'inbound-email provisionAddress',
  );
  return result.address;
}
