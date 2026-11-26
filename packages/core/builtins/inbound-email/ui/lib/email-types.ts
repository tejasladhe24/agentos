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
  /** SPF / DKIM / DMARC verdicts from the receiving MX (Cloudflare). */
  authentication?: { spf?: string; dkim?: string; dmarc?: string };
};

/** `SPF pass · DKIM fail` style summary, or null when not recorded. */
export function authenticationSummary(
  auth: InboundMessage['authentication'],
): { label: string; failing: boolean } | null {
  if (!auth) return null;
  const parts = (['spf', 'dkim', 'dmarc'] as const)
    .filter((k) => auth[k])
    .map((k) => `${k.toUpperCase()} ${auth[k]}`);
  if (parts.length === 0) return null;
  const failing = (['spf', 'dkim', 'dmarc'] as const).some(
    (k) => auth[k] !== undefined && auth[k] !== 'pass',
  );
  return { label: parts.join(' · '), failing };
}

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
