import { NOTIFICATIONS_MAX } from './constants';
import type {
  DbStoreClient,
  DeliveryChannel,
  DeliveryStatus,
  NotificationEntry,
  NotificationType,
} from './db-store-client';

export type {
  NotificationEntry,
  NotificationType,
  DeliveryChannel,
  DeliveryStatus,
};

export type EnqueueInput = {
  message: string;
  type?: NotificationType;
  channel?: DeliveryChannel;
  to?: string;
  templateId?: string;
  subject?: string;
  orgId?: string;
};

/** Durable notifications inbox + delivery records backed by db-store. */
export function createNotifyStore(db: DbStoreClient, max = NOTIFICATIONS_MAX) {
  const store = {
    async enqueue(input: EnqueueInput): Promise<NotificationEntry> {
      const channel = input.channel ?? 'in_app';
      const entry: NotificationEntry = {
        id: crypto.randomUUID(),
        message: input.message,
        type: input.type ?? 'info',
        channel,
        status: 'queued' as DeliveryStatus,
        at: new Date().toISOString(),
      };
      if (input.to) entry.to = input.to;
      if (input.templateId) entry.templateId = input.templateId;
      if (input.subject) entry.subject = input.subject;
      if (input.orgId) entry.orgId = input.orgId;

      await db.insert(entry);

      if (channel === 'in_app') {
        const inbox = (await db.query()).filter((e) => e.channel === 'in_app');
        if (inbox.length > max) {
          const overflow = inbox.slice(max);
          await db.delete(overflow.map((e) => e.id));
        }
      }

      return entry;
    },

    /** Back-compat helper used by older call sites / tests. */
    async add(
      message: string,
      type: NotificationType = 'info',
    ): Promise<NotificationEntry> {
      const entry = await store.enqueue({ message, type, channel: 'in_app' });
      return store.markStatus(entry.id, 'sent');
    },

    async markStatus(
      id: string,
      status: DeliveryStatus,
      patch: Partial<
        Pick<
          NotificationEntry,
          'provider' | 'source' | 'error' | 'sentAt' | 'message' | 'subject'
        >
      > = {},
    ): Promise<NotificationEntry> {
      const current = await db.get(id);
      if (!current) {
        throw new Error(`notification not found: ${id}`);
      }
      const updated: NotificationEntry = {
        ...current,
        ...patch,
        status,
      };
      if (status === 'sent' && !updated.sentAt) {
        updated.sentAt = new Date().toISOString();
      }
      if (status !== 'failed') {
        delete updated.error;
      }
      return db.update(updated);
    },

    async get(id: string): Promise<NotificationEntry | undefined> {
      return db.get(id);
    },

    /** Recent in-app inbox for Shell toasts (email/SMS excluded). */
    async list(): Promise<NotificationEntry[]> {
      const all = await db.query();
      return all.filter((e) => e.channel === 'in_app').slice(0, max);
    },

    /** Org-scoped delivery list (email/SMS/in_app via channel filter). */
    async listDeliveries(input: {
      orgId: string;
      channel?: DeliveryChannel;
      limit?: number;
      offset?: number;
    }): Promise<NotificationEntry[]> {
      const limit = Math.min(Math.max(input.limit ?? max, 1), max);
      const offset = Math.max(input.offset ?? 0, 0);
      const all = await db.query();
      return all
        .filter((e) => e.orgId === input.orgId)
        .filter((e) => (input.channel ? e.channel === input.channel : true))
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(offset, offset + limit);
    },
  };
  return store;
}

export type NotifyStore = ReturnType<typeof createNotifyStore>;
