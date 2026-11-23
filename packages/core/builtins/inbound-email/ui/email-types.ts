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
  error?: string;
  sentAt?: string;
};

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

export function filesBlobUrl(key: string): string {
  return `/api/ext/files/blobs/${encodeURIComponent(key)}`;
}
