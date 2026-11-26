import { canManageJobs, type EventsAuthenticator } from './auth';
import type { EventBus } from './event-bus';
import { json, parseJobId } from './http';
import type { JobsStore } from './jobs-store';
import type { OutboxStore } from './outbox-store';
import {
  EVENTS_EXACT_ROUTES,
  handleDeleteJob,
  type EventsRouteHandler,
  type RouteAccess,
  type RouteContext,
} from './routes';

export type EventsHandlerDeps = {
  bus: EventBus;
  outbox: OutboxStore;
  jobs: JobsStore;
  workerId: string;
  leaseMs: number;
  maxAttempts: number;
  /**
   * Resolves the caller. When absent every non-public route fails closed with
   * 503 rather than running unauthenticated.
   */
  authenticate?: EventsAuthenticator;
  /** Optional fetch for scheduler HTTP jobs (tests). */
  fetchImpl?: typeof fetch;
};

type Matched = { access: RouteAccess; handle: EventsRouteHandler };

function matchRoute(method: string, path: string): Matched | null {
  for (const route of EVENTS_EXACT_ROUTES) {
    if (route.method === method && route.path === path) {
      return { access: route.access, handle: route.handle };
    }
  }
  if (method === 'DELETE' && parseJobId(path)) {
    return { access: 'admin', handle: handleDeleteJob };
  }
  return null;
}

/**
 * Thin Bun request router for `/api/ext/events/*` upstream paths.
 * Exact routes live in `routes.ts`; `DELETE /jobs/:id` is matched by pattern.
 * Every route except `GET /health` authenticates first (see `RouteAccess`).
 */
export async function handleEventsRequest(
  deps: EventsHandlerDeps,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  const matched = matchRoute(method, path);
  if (!matched) {
    return json({ error: 'not found' }, { status: 404 });
  }

  const ctx: RouteContext = { request, url, path, principal: null };

  if (matched.access !== 'public') {
    if (!deps.authenticate) {
      return json({ error: 'events auth not configured' }, { status: 503 });
    }
    const auth = await deps.authenticate(request);
    if (!auth.ok) {
      return json({ error: auth.error }, { status: auth.status });
    }
    const { principal } = auth;
    if (matched.access === 'service' && principal.kind !== 'service') {
      return json({ error: 'service credential required' }, { status: 403 });
    }
    if (matched.access === 'admin' && !canManageJobs(principal)) {
      return json({ error: 'admin role required' }, { status: 403 });
    }
    ctx.principal = principal;
  }

  return matched.handle(deps, ctx);
}
