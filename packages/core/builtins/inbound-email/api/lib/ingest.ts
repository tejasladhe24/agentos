import { toFileRef } from '@agentos/core/api/files-ref';
import { withIdempotency } from '@agentos/core/api/webhook';

import type { AddressStore } from './address-store';
import { EMAIL_RECEIVED_TOPIC } from './constants';
import type { MessageDb } from './message-store';
import type {
  EventsClient,
  FilesClient,
  IdempotencyStore,
  InboundMessage,
  IngestResult,
  NormalizedInboundEmail,
  StoredAttachment,
} from './types';

export type IngestDeps = {
  addresses: AddressStore;
  messages: MessageDb;
  files: FilesClient;
  events: EventsClient;
  idempotency?: IdempotencyStore;
};

function safeFilename(name: string): string {
  const base = name.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'attachment.bin';
  return base.slice(0, 180);
}

export async function ingestInboundEmail(
  deps: IngestDeps,
  email: NormalizedInboundEmail,
): Promise<IngestResult> {
  const orgId = await deps.addresses.resolveOrgId(email.to);
  if (!orgId) {
    throw new IngestError('unknown_recipient', 'no org mapped for recipient');
  }

  const idempotencyKey = `inbound-email:${orgId}:${email.deliveryId}`;

  const run = async (): Promise<IngestResult> => {
    const existing = await deps.messages
      .getByDeliveryId(orgId, email.deliveryId)
      .catch(() => undefined);
    if (existing) {
      return { ok: true, duplicate: true, message: existing };
    }

    const messageId = crypto.randomUUID();
    const attachments: StoredAttachment[] = [];
    for (let i = 0; i < email.attachments.length; i++) {
      const att = email.attachments[i]!;
      const path = `inbound/${messageId}/${i}-${safeFilename(att.filename)}`;
      const put = await deps.files.putBlob(path, att.bytes, orgId);
      const stored: StoredAttachment = {
        filename: att.filename,
        contentType: att.contentType,
        key: put.key,
        ref: put.ref ?? toFileRef(put.key, orgId),
        bytes: put.bytes,
      };
      if (put.mountId) stored.mountId = put.mountId;
      attachments.push(stored);
    }

    const message: InboundMessage = {
      id: messageId,
      orgId,
      deliveryId: email.deliveryId,
      provider: email.provider,
      from: email.from,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      attachments,
      receivedAt: new Date().toISOString(),
    };

    await deps.messages.insertMessage(message);

    const published = await deps.events.publish(EMAIL_RECEIVED_TOPIC, {
      orgId,
      messageId: message.id,
      deliveryId: message.deliveryId,
      provider: message.provider,
      from: message.from,
      to: message.to,
      subject: message.subject,
      attachmentKeys: attachments.map((a) => a.key),
      attachmentRefs: attachments.map((a) => a.ref),
      attachments,
      receivedAt: message.receivedAt,
    });

    return {
      ok: true,
      message,
      eventId: published.event?.id,
    };
  };

  if (!deps.idempotency) {
    return run();
  }

  const result = await withIdempotency({
    key: idempotencyKey,
    store: deps.idempotency,
    run,
  });
  if (result.status === 'duplicate') {
    const cached = result.result as IngestResult;
    return { ...cached, duplicate: true };
  }
  return result.result;
}

export class IngestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'IngestError';
    this.code = code;
  }
}
