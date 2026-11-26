import { PLATFORM_ORG_ID } from './constants';
import type { EventBus } from './event-bus';
import type { JobRecord } from './db-store-client';
import type { JobsStore } from './jobs-store';
import type { OutboxStore } from './outbox-store';
import { jobUrlError } from './policy';

export type SchedulerDeps = {
  jobs: JobsStore;
  outbox: OutboxStore;
  bus: EventBus;
  /** Optional override for HTTP job delivery (tests). */
  fetchImpl?: typeof fetch;
};

async function runHttp(job: JobRecord, fetchImpl: typeof fetch): Promise<void> {
  const url = job.url;
  if (!url) throw new Error('job missing url');
  // Re-check at run time so jobs stored before validation existed stay safe.
  const blocked = jobUrlError(url);
  if (blocked) throw new Error(blocked);
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(job.body ?? {}),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      `http job failed (${res.status}): ${detail || res.statusText}`,
    );
  }
}

/**
 * Process due jobs once: publish into outbox (+ SSE) or POST configured URL.
 * Returns how many jobs were attempted.
 */
export async function runSchedulerTick(deps: SchedulerDeps): Promise<number> {
  const due = await deps.jobs.due();
  const fetchImpl = deps.fetchImpl ?? fetch;
  let ran = 0;

  for (const job of due) {
    ran += 1;
    try {
      if (job.action === 'publish') {
        const topic = job.topic?.trim();
        if (!topic) throw new Error('job missing topic');
        const orgId = job.orgId ?? PLATFORM_ORG_ID;
        const record = await deps.outbox.publish(
          topic,
          job.payload ?? null,
          orgId,
        );
        deps.bus.publish(topic, record.payload, orgId);
      } else {
        await runHttp(job, fetchImpl);
      }
      await deps.jobs.markRan(job, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await deps.jobs.markRan(job, { ok: false, error: message });
    }
  }

  return ran;
}
