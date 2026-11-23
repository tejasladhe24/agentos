import { initialNextRun, nextCronRun, parseEveryMs } from './cron';
import type {
  DbStoreClient,
  JobAction,
  JobKind,
  JobRecord,
} from './db-store-client';
import type { Clock } from './outbox-store';

export type CreateJobInput = {
  kind: JobKind;
  action: JobAction;
  runAt?: string;
  cron?: string;
  topic?: string;
  payload?: unknown;
  url?: string;
  body?: unknown;
  enabled?: boolean;
};

export type JobsStore = {
  create: (input: CreateJobInput) => Promise<JobRecord>;
  list: () => Promise<JobRecord[]>;
  get: (id: string) => Promise<JobRecord | undefined>;
  remove: (id: string) => Promise<boolean>;
  due: () => Promise<JobRecord[]>;
  markRan: (
    job: JobRecord,
    opts: { ok: boolean; error?: string },
  ) => Promise<JobRecord>;
};

/** Scheduled jobs store (cron / run-at) backed by db-store. */
export function createJobsStore(db: DbStoreClient, clock: Clock): JobsStore {
  return {
    async create(input) {
      const now = clock();
      if (input.kind === 'at' && !input.runAt) {
        throw new Error('runAt required for kind "at"');
      }
      if (input.kind === 'cron' && !input.cron) {
        throw new Error('cron required for kind "cron"');
      }
      if (input.action === 'publish' && !input.topic?.trim()) {
        throw new Error('topic required for action "publish"');
      }
      if (input.action === 'http' && !input.url?.trim()) {
        throw new Error('url required for action "http"');
      }
      if (input.kind === 'cron' && input.cron) {
        const every = parseEveryMs(input.cron);
        if (every === null) {
          // Validate 5-field by computing a next run.
          nextCronRun(input.cron, now);
        }
      }

      const nextRunAt = initialNextRun(
        input.kind,
        { runAt: input.runAt, cron: input.cron },
        now,
      ).toISOString();

      const record: JobRecord = {
        id: crypto.randomUUID(),
        kind: input.kind,
        action: input.action,
        enabled: input.enabled !== false,
        nextRunAt,
        createdAt: now.toISOString(),
        ...(input.runAt ? { runAt: input.runAt } : {}),
        ...(input.cron ? { cron: input.cron } : {}),
        ...(input.topic ? { topic: input.topic.trim() } : {}),
        ...(input.payload !== undefined ? { payload: input.payload } : {}),
        ...(input.url ? { url: input.url.trim() } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
      };
      return db.insertJob(record);
    },

    list: () => db.listJobs(),
    get: (id) => db.getJob(id),
    remove: (id) => db.deleteJob(id),

    async due() {
      const nowIso = clock().toISOString();
      const jobs = await db.listJobs();
      return jobs.filter((j) => j.enabled && j.nextRunAt <= nowIso);
    },

    async markRan(job, { ok, error }) {
      const now = clock();
      let nextRunAt = job.nextRunAt;
      if (job.kind === 'at') {
        // One-shot: disable after run.
        const next: JobRecord = {
          ...job,
          enabled: false,
          lastRunAt: now.toISOString(),
        };
        if (ok) delete next.lastError;
        else if (error) next.lastError = error;
        return db.updateJob(next);
      }
      if (job.cron) {
        nextRunAt = nextCronRun(job.cron, now).toISOString();
      }
      const next: JobRecord = {
        ...job,
        nextRunAt,
        lastRunAt: now.toISOString(),
      };
      if (ok) delete next.lastError;
      else if (error) next.lastError = error;
      return db.updateJob(next);
    },
  };
}
