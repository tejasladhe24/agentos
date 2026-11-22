import type {
  Approval,
  ApprovalStatus,
  DbStoreClient,
} from './db-store-client';

export type { Approval, ApprovalStatus };

/** Durable approvals store backed by db-store (ticket 61). */
export function createApprovalsStore(db: DbStoreClient) {
  return {
    async create(input: {
      title: string;
      body?: string;
      metadata?: Record<string, unknown>;
    }): Promise<Approval> {
      const approval: Approval = {
        id: crypto.randomUUID(),
        title: input.title,
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      return db.insert(approval);
    },

    async list(status?: ApprovalStatus): Promise<Approval[]> {
      return db.query(status);
    },

    async get(id: string): Promise<Approval | undefined> {
      return db.get(id);
    },

    async resolve(
      id: string,
      decision: 'approved' | 'rejected',
    ): Promise<Approval | undefined> {
      const existing = await db.get(id);
      if (!existing) return undefined;
      if (existing.status !== 'pending') return existing;
      const updated: Approval = {
        ...existing,
        status: decision,
        resolvedAt: new Date().toISOString(),
      };
      return db.update(updated);
    },
  };
}

export type ApprovalsStore = ReturnType<typeof createApprovalsStore>;
