import { backoffMs } from './backoff';
import { PLATFORM_ORG_ID } from './constants';
import type {
  DbStoreClient,
  OutboxRecord,
  OutboxStatus,
} from './db-store-client';

export type Clock = () => Date;

export type OutboxStore = {
  publish: (
    topic: string,
    payload: unknown,
    orgId?: string,
  ) => Promise<OutboxRecord>;
  claim: (input: {
    limit: number;
    workerId: string;
    leaseMs: number;
  }) => Promise<OutboxRecord[]>;
  ack: (id: string) => Promise<OutboxRecord | undefined>;
  nack: (
    id: string,
    opts: { maxAttempts: number; error?: string },
  ) => Promise<OutboxRecord | undefined>;
  get: (id: string) => Promise<OutboxRecord | undefined>;
  list: (status?: OutboxStatus) => Promise<OutboxRecord[]>;
};

function isClaimable(record: OutboxRecord, nowIso: string): boolean {
  if (record.status === 'pending') {
    return record.availableAt <= nowIso;
  }
  if (record.status === 'leased') {
    return Boolean(record.leaseUntil && record.leaseUntil <= nowIso);
  }
  return false;
}

/** Durable outbox over db-store with lease-based claim / ack / nack. */
export function createOutboxStore(
  db: DbStoreClient,
  clock: Clock,
): OutboxStore {
  return {
    async publish(topic, payload, orgId = PLATFORM_ORG_ID) {
      const now = clock().toISOString();
      const record: OutboxRecord = {
        id: crypto.randomUUID(),
        orgId,
        topic,
        payload: payload ?? null,
        status: 'pending',
        attempts: 0,
        availableAt: now,
        createdAt: now,
      };
      return db.insertOutbox(record);
    },

    async claim({ limit, workerId, leaseMs }) {
      const now = clock();
      const nowIso = now.toISOString();
      const pending = await db.listOutbox('pending');
      const leased = await db.listOutbox('leased');
      const candidates = [...pending, ...leased]
        .filter((r) => isClaimable(r, nowIso))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, Math.max(0, limit));

      const leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
      const claimed: OutboxRecord[] = [];
      for (const row of candidates) {
        const next: OutboxRecord = {
          ...row,
          status: 'leased',
          leaseOwner: workerId,
          leaseUntil,
        };
        claimed.push(await db.updateOutbox(next));
      }
      return claimed;
    },

    async ack(id) {
      const existing = await db.getOutbox(id);
      if (!existing) return undefined;
      if (existing.status === 'acked' || existing.status === 'dead') {
        return existing;
      }
      const next: OutboxRecord = {
        ...existing,
        status: 'acked',
        ackedAt: clock().toISOString(),
      };
      delete next.leaseOwner;
      delete next.leaseUntil;
      return db.updateOutbox(next);
    },

    async nack(id, { maxAttempts, error }) {
      const existing = await db.getOutbox(id);
      if (!existing) return undefined;
      if (existing.status === 'acked' || existing.status === 'dead') {
        return existing;
      }
      const attempts = existing.attempts + 1;
      const now = clock();
      if (attempts >= maxAttempts) {
        const dead: OutboxRecord = {
          ...existing,
          status: 'dead',
          attempts,
          ...(error ? { lastError: error } : {}),
        };
        delete dead.leaseOwner;
        delete dead.leaseUntil;
        return db.updateOutbox(dead);
      }
      const next: OutboxRecord = {
        ...existing,
        status: 'pending',
        attempts,
        availableAt: new Date(
          now.getTime() + backoffMs(attempts),
        ).toISOString(),
        ...(error ? { lastError: error } : {}),
      };
      delete next.leaseOwner;
      delete next.leaseUntil;
      return db.updateOutbox(next);
    },

    get: (id) => db.getOutbox(id),
    list: (status) => db.listOutbox(status),
  };
}
