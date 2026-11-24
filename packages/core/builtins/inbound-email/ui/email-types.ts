export type StoredAttachment = {
  filename: string;
  contentType: string;
  key: string;
  ref?: string;
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
};

export type InboundAddress = {
  id: string;
  address: string;
  orgId: string;
  purpose?: string;
  createdAt: string;
};

export type DeliveryEntry = {
  id: string;
  message: string;
  type: string;
  channel: string;
  status: 'queued' | 'sent' | 'failed' | string;
  at: string;
  to?: string;
  templateId?: string;
  subject?: string;
  orgId?: string;
  provider?: string;
  /** `org` = sent with the org's own provider key (BYOK). */
  source?: 'org' | 'platform';
  error?: string;
  sentAt?: string;
};

export function deliverySourceLabel(source?: string): string | null {
  if (source === 'org') return 'Your key';
  if (source === 'platform') return 'Platform default';
  return null;
}

export function parseErrorBody(body: string, fallback: string): string {
  try {
    const data = JSON.parse(body) as { error?: string; message?: string };
    if (typeof data.error === 'string' && data.error) return data.error;
    if (typeof data.message === 'string' && data.message) return data.message;
  } catch {
    // ignore
  }
  return body.trim() || fallback;
}

/** Files blob URL for a legacy key or `files://` reference. */
export function filesBlobUrl(key: string): string {
  return `/api/ext/files/blobs/${encodeURIComponent(key)}`;
}
