/**
 * @agentos/core/api/notifications — HTTP client for builtin `notifications` (ticket 82).
 */

import { jsonFetch, resolveExtApiBase, type EnvMap } from './http';

/** Resolve builtin notifications API base (`…/api/ext/notifications` or test override). */
export function resolveNotificationsApiBase(env: EnvMap = Bun.env): string {
  return resolveExtApiBase(
    'notifications',
    'AGENT_OS_NOTIFICATIONS_API_BASE',
    env,
  );
}

/** Trusted peer / FDE header for active org (matches notifications + db-store). */
export const NOTIFICATIONS_ORG_ID_HEADER = 'x-agentos-org-id';

export type NotificationType = 'info' | 'success' | 'error';
export type DeliveryChannel = 'in_app' | 'email' | 'sms';
export type DeliveryStatus = 'queued' | 'sent' | 'failed';

export type NotificationEntry = {
  id: string;
  message: string;
  type: NotificationType;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  at: string;
  to?: string;
  templateId?: string;
  subject?: string;
  orgId?: string;
  provider?: string;
  error?: string;
  sentAt?: string;
};

export type NotifyInput = {
  channel: DeliveryChannel;
  message?: string;
  subject?: string;
  type?: NotificationType;
  templateId?: string;
  vars?: Record<string, string>;
  to?: string;
  orgId?: string;
};

export type NotifyResult = {
  ok: true;
  notification: NotificationEntry;
};

export type NotificationsCallInit = {
  /** Forward cookie / auth headers from the inbound FDE request. */
  headers?: HeadersInit;
  /** Active org id sent as `X-AgentOS-Org-Id` (peer / service path). */
  orgId?: string;
};

function notificationsHeaders(init?: NotificationsCallInit): Headers {
  const headers = new Headers(init?.headers);
  if (init?.orgId) {
    headers.set(NOTIFICATIONS_ORG_ID_HEADER, init.orgId);
  }
  return headers;
}

/** Enqueue a notification (`POST /notify`). */
export async function notify(
  input: NotifyInput,
  env?: EnvMap,
  init?: NotificationsCallInit,
): Promise<NotifyResult> {
  const base = resolveNotificationsApiBase(env ?? Bun.env);
  return jsonFetch<NotifyResult>(
    `${base}/notify`,
    {
      method: 'POST',
      body: input,
      headers: notificationsHeaders(init),
    },
    'notifications notify',
  );
}

/** Recent in-app inbox (`GET /recent`). */
export async function listRecent(
  env?: EnvMap,
  init?: NotificationsCallInit,
): Promise<NotificationEntry[]> {
  const base = resolveNotificationsApiBase(env ?? Bun.env);
  const result = await jsonFetch<{ notifications: NotificationEntry[] }>(
    `${base}/recent`,
    { method: 'GET', headers: notificationsHeaders(init) },
    'notifications listRecent',
  );
  return result.notifications;
}

/** Delivery status by id (`GET /deliveries/:id`). */
export async function getDelivery(
  id: string,
  env?: EnvMap,
  init?: NotificationsCallInit,
): Promise<NotificationEntry> {
  const base = resolveNotificationsApiBase(env ?? Bun.env);
  const result = await jsonFetch<{ notification: NotificationEntry }>(
    `${base}/deliveries/${encodeURIComponent(id)}`,
    { method: 'GET', headers: notificationsHeaders(init) },
    'notifications getDelivery',
  );
  return result.notification;
}

export type ListDeliveriesInput = {
  channel?: DeliveryChannel;
  limit?: number;
  offset?: number;
};

/** Org-scoped deliveries (`GET /deliveries?channel=`). */
export async function listDeliveries(
  input: ListDeliveriesInput = {},
  env?: EnvMap,
  init?: NotificationsCallInit,
): Promise<NotificationEntry[]> {
  const base = resolveNotificationsApiBase(env ?? Bun.env);
  const params = new URLSearchParams();
  if (input.channel) params.set('channel', input.channel);
  if (input.limit !== undefined) params.set('limit', String(input.limit));
  if (input.offset !== undefined) params.set('offset', String(input.offset));
  const qs = params.toString();
  const result = await jsonFetch<{ notifications: NotificationEntry[] }>(
    `${base}/deliveries${qs ? `?${qs}` : ''}`,
    { method: 'GET', headers: notificationsHeaders(init) },
    'notifications listDeliveries',
  );
  return result.notifications;
}
