import type { EventBus } from './event-bus';
import { json, parseJobId } from './http';
import type { JobsStore } from './jobs-store';
import type { OutboxStore } from './outbox-store';
import { EVENTS_EXACT_ROUTES, handleDeleteJob } from './routes';

export type EventsHandlerDeps = {
  bus: EventBus;
  outbox: OutboxStore;
  jobs: JobsStore;
  workerId: string;
  leaseMs: number;
  maxAttempts: number;
  /** Optional fetch for scheduler HTTP jobs (tests). */
  fetchImpl?: typeof fetch;
};

/**
 * Thin Bun request router for `/api/ext/events/*` upstream paths.
 * Exact routes live in `routes.ts`; `DELETE /jobs/:id` is matched by pattern.
 */
export async function handleEventsRequest(
  deps: EventsHandlerDeps,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  for (const route of EVENTS_EXACT_ROUTES) {
    if (route.method === method && route.path === path) {
      return route.handle(deps, request, url, path);
    }
  }

  if (method === 'DELETE' && parseJobId(path)) {
    return handleDeleteJob(deps, request, url, path);
  }

  return json({ error: 'not found' }, { status: 404 });
}
