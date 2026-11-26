import type {
  Approval,
  ApprovalStatus,
  ApprovalsStore,
} from './approvals-store';

/**
 * `orgId` is the signed-in actor's org when it could be resolved. Only
 * org-scoped events reach browser sessions; without one the event stays
 * platform-scoped (service subscribers only).
 */
export type HitlResolvePublisher = (
  payload: {
    approvalId: string;
    decision: 'approved' | 'rejected';
    title: string;
    resolvedAt?: string;
  },
  orgId?: string,
) => Promise<void>;

/** Published when an approval is created so open Approvals pages refresh. */
export type HitlRequestPublisher = (
  payload: { approvalId: string; title: string },
  orgId?: string,
) => Promise<void>;

export type HitlHandlerOptions = {
  /** Publish `hitl.resolved` after a successful approve/reject (ticket 74). */
  publishResolved?: HitlResolvePublisher;
  /** Publish `hitl.requested` after an approval is created (ticket 145). */
  publishRequested?: HitlRequestPublisher;
  /** Resolve the caller's active org from the request (session cookie). */
  resolveOrgId?: (request: Request) => Promise<string | undefined>;
};

type HitlDeps = {
  store: ApprovalsStore;
  options: HitlHandlerOptions;
};

type HitlRouteHandler = (
  deps: HitlDeps,
  request: Request,
  url: URL,
) => Promise<Response>;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function decodeSegment(segment: string | undefined): string | null {
  if (!segment) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function parseResolvePath(path: string): string | null {
  return decodeSegment(path.match(/^\/approvals\/([^/]+)\/resolve$/)?.[1]);
}

function parseApprovalPath(path: string): string | null {
  return decodeSegment(path.match(/^\/approvals\/([^/]+)$/)?.[1]);
}

function unavailable(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  return json(
    { error: 'db-store unavailable', detail: message },
    { status: 502 },
  );
}

async function orgIdOf(
  options: HitlHandlerOptions,
  request: Request,
): Promise<string | undefined> {
  try {
    return (await options.resolveOrgId?.(request)) || undefined;
  } catch {
    return undefined;
  }
}

async function emitResolved(
  options: HitlHandlerOptions,
  request: Request,
  approval: Approval,
): Promise<void> {
  const publishResolved = options.publishResolved;
  if (!publishResolved) return;
  if (approval.status !== 'approved' && approval.status !== 'rejected') return;
  try {
    await publishResolved(
      {
        approvalId: approval.id,
        decision: approval.status,
        title: approval.title,
        ...(approval.resolvedAt ? { resolvedAt: approval.resolvedAt } : {}),
      },
      await orgIdOf(options, request),
    );
  } catch (error) {
    console.error('[agentos hitl] hitl.resolved publish failed', error);
  }
}

async function emitRequested(
  options: HitlHandlerOptions,
  request: Request,
  approval: Approval,
): Promise<void> {
  const publishRequested = options.publishRequested;
  if (!publishRequested) return;
  try {
    await publishRequested(
      { approvalId: approval.id, title: approval.title },
      await orgIdOf(options, request),
    );
  } catch (error) {
    console.error('[agentos hitl] hitl.requested publish failed', error);
  }
}

async function handleHealth(): Promise<Response> {
  return json({ ok: true, backend: 'db-store' });
}

async function handleListApprovals(
  deps: HitlDeps,
  _request: Request,
  url: URL,
): Promise<Response> {
  const statusParam = url.searchParams.get('status');
  const status =
    statusParam === 'pending' ||
    statusParam === 'approved' ||
    statusParam === 'rejected'
      ? (statusParam as ApprovalStatus)
      : undefined;
  try {
    return json({ approvals: await deps.store.list(status) });
  } catch (error) {
    return unavailable(error);
  }
}

async function handleCreateApproval(
  deps: HitlDeps,
  request: Request,
): Promise<Response> {
  const body = await readJsonBody(request);
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return json({ error: 'title required' }, { status: 400 });
  }
  try {
    const approval = await deps.store.create({
      title,
      body: typeof body?.body === 'string' ? body.body : undefined,
      metadata:
        body?.metadata &&
        typeof body.metadata === 'object' &&
        !Array.isArray(body.metadata)
          ? (body.metadata as Record<string, unknown>)
          : undefined,
    });
    await emitRequested(deps.options, request, approval);
    return json(approval, { status: 201 });
  } catch (error) {
    return unavailable(error);
  }
}

async function handleGetApproval(
  deps: HitlDeps,
  approvalId: string,
): Promise<Response> {
  try {
    const approval = await deps.store.get(approvalId);
    if (!approval) return json({ error: 'not found' }, { status: 404 });
    return json(approval);
  } catch (error) {
    return unavailable(error);
  }
}

async function handleResolveApproval(
  deps: HitlDeps,
  request: Request,
  resolveId: string,
): Promise<Response> {
  const body = await readJsonBody(request);
  const decision = body?.decision;
  if (decision !== 'approved' && decision !== 'rejected') {
    return json(
      { error: 'decision must be "approved" or "rejected"' },
      { status: 400 },
    );
  }
  try {
    const existing = await deps.store.get(resolveId);
    if (!existing) {
      return json({ error: 'not found' }, { status: 404 });
    }
    if (existing.status !== 'pending') {
      return json(
        { error: 'already resolved', approval: existing },
        { status: 409 },
      );
    }
    const approval = (await deps.store.resolve(resolveId, decision))!;
    await emitResolved(deps.options, request, approval);
    return json(approval);
  } catch (error) {
    return unavailable(error);
  }
}

const HITL_EXACT_ROUTES: ReadonlyArray<{
  method: string;
  path: string;
  handle: HitlRouteHandler;
}> = [
  { method: 'GET', path: '/health', handle: () => handleHealth() },
  {
    method: 'GET',
    path: '/approvals',
    handle: (d, r, u) => handleListApprovals(d, r, u),
  },
  {
    method: 'POST',
    path: '/approvals',
    handle: (d, r) => handleCreateApproval(d, r),
  },
];

/**
 * Thin Bun request router for `/api/ext/hitl/*` upstream paths.
 * Persistence goes through db-store only (ADR 004).
 */
export async function handleHitlRequest(
  store: ApprovalsStore,
  request: Request,
  options: HitlHandlerOptions = {},
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();
  const deps: HitlDeps = { store, options };

  for (const route of HITL_EXACT_ROUTES) {
    if (route.method === method && route.path === path) {
      return route.handle(deps, request, url);
    }
  }

  const resolveId = parseResolvePath(path);
  if (method === 'POST' && resolveId) {
    return handleResolveApproval(deps, request, resolveId);
  }

  const approvalId = parseApprovalPath(path);
  if (method === 'GET' && approvalId) {
    return handleGetApproval(deps, approvalId);
  }

  return json({ error: 'not found' }, { status: 404 });
}
