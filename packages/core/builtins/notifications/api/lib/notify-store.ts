import { NOTIFICATIONS_MAX } from './constants';
import type {
  DbStoreClient,
  NotificationEntry,
  NotificationType,
} from './db-store-client';

export type { NotificationEntry, NotificationType };

/** Durable notifications inbox backed by db-store (ticket 61). */
export function createNotifyStore(db: DbStoreClient, max = NOTIFICATIONS_MAX) {
  return {
    async add(
      message: string,
      type: NotificationType = 'info',
    ): Promise<NotificationEntry> {
      const entry: NotificationEntry = {
        id: crypto.randomUUID(),
        message,
        type,
        at: new Date().toISOString(),
      };
      await db.insert(entry);
      const all = await db.query();
      if (all.length > max) {
        const overflow = all.slice(max);
        await db.delete(overflow.map((e) => e.id));
      }
      return entry;
    },

    async list(): Promise<NotificationEntry[]> {
      const all = await db.query();
      return all.slice(0, max);
    },
  };
}

export type NotifyStore = ReturnType<typeof createNotifyStore>;
