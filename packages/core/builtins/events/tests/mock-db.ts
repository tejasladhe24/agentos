import type {
  DbStoreClient,
  JobRecord,
  OutboxRecord,
  OutboxStatus,
} from '@agentos/core/builtins/events/api/lib/db-store-client';

/** In-memory db-store stand-in for the events outbox + jobs collections. */
export function mockDb(fail = false): DbStoreClient & {
  outbox: Map<string, OutboxRecord>;
  jobs: Map<string, JobRecord>;
} {
  const outbox = new Map<string, OutboxRecord>();
  const jobs = new Map<string, JobRecord>();
  return {
    outbox,
    jobs,
    async insertOutbox(record) {
      if (fail) throw new Error('connection refused');
      outbox.set(record.id, structuredClone(record));
      return structuredClone(record);
    },
    async updateOutbox(record) {
      if (fail) throw new Error('connection refused');
      outbox.set(record.id, structuredClone(record));
      return structuredClone(record);
    },
    async listOutbox(status?: OutboxStatus) {
      if (fail) throw new Error('connection refused');
      const all = [...outbox.values()].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      );
      if (!status) return all.map((r) => structuredClone(r));
      return all
        .filter((r) => r.status === status)
        .map((r) => structuredClone(r));
    },
    async getOutbox(id) {
      if (fail) throw new Error('connection refused');
      const row = outbox.get(id);
      return row ? structuredClone(row) : undefined;
    },
    async insertJob(record) {
      if (fail) throw new Error('connection refused');
      jobs.set(record.id, structuredClone(record));
      return structuredClone(record);
    },
    async updateJob(record) {
      if (fail) throw new Error('connection refused');
      jobs.set(record.id, structuredClone(record));
      return structuredClone(record);
    },
    async listJobs() {
      if (fail) throw new Error('connection refused');
      return [...jobs.values()]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((r) => structuredClone(r));
    },
    async getJob(id) {
      if (fail) throw new Error('connection refused');
      const row = jobs.get(id);
      return row ? structuredClone(row) : undefined;
    },
    async deleteJob(id) {
      if (fail) throw new Error('connection refused');
      return jobs.delete(id);
    },
  };
}
