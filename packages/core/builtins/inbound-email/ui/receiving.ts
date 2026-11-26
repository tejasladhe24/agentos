import { extensionPath } from '@agentos/core/client';

/** Helpers for the Email settings → Receiving card (`email.receive`, ticket 106). */

export const RECEIVE_INTEGRATION_PATH = '/integrations/email.receive';
export const SEND_INTEGRATION_PATH = extensionPath(
  'notifications',
  '/integrations/email.send',
);
export const RESEND_WEBHOOK_PATH = extensionPath(
  'inbound-email',
  '/webhooks/resend',
);

export type WebhookStatus = 'registered' | 'manual' | 'failing';

export type ReceivingDraft = {
  receivingDomain: string;
  apiKey: string;
  signingSecret: string;
  useSendingKey: boolean;
};

export const EMPTY_RECEIVING_DRAFT: ReceivingDraft = {
  receivingDomain: '',
  apiKey: '',
  signingSecret: '',
  useSendingKey: false,
};

export function parseWebhookStatus(value: unknown): WebhookStatus | null {
  return value === 'registered' || value === 'manual' || value === 'failing'
    ? value
    : null;
}

export const WEBHOOK_STATUS_LABELS: Record<WebhookStatus, string> = {
  registered: 'Webhook registered',
  manual: 'Manual setup',
  failing: 'Webhook failing',
};

export function receivingWebhookUrl(
  connectionId: string,
  origin: string,
): string {
  return `${origin.replace(/\/+$/, '')}${RESEND_WEBHOOK_PATH}/${connectionId}`;
}

/** PUT body: blank secrets keep the stored value; the sending key wins over a typed key. */
export function receivingDraftBody(draft: ReceivingDraft) {
  const secrets: Record<string, string> = {};
  if (!draft.useSendingKey && draft.apiKey) secrets.apiKey = draft.apiKey;
  if (draft.signingSecret) secrets.signingSecret = draft.signingSecret;
  return {
    provider: 'resend',
    settings: draft.receivingDomain.trim()
      ? { receivingDomain: draft.receivingDomain.trim() }
      : {},
    secrets,
    ...(draft.useSendingKey ? { useSendingKey: true } : {}),
  };
}
