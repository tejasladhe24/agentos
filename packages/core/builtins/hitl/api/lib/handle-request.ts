import type { ApprovalStatus, ApprovalsStore } from './approvals-store';

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

function parseResolvePath(path: string): string | null {
  const match = path.match(/^\/approvals\/([^/]+)\/resolve$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function unavailable(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  return json(
    { error: 'db-store unavailable', detail: message },
    { status: 502 },
  );
}

/**
 * Thin Bun request router for `/api/ext/hitl/*` upstream paths.
 * Persistence goes through db-store only (ADR 004).
 */
export async function handleHitlRequest(
  store: ApprovalsStore,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (method === 'GET' && path === '/health') {
    return json({ ok: true, backend: 'db-store' });
  }

  if (method === 'GET' && path === '/approvals') {
    const statusParam = url.searchParams.get('status');
    const status =
      statusParam === 'pending' ||
      statusParam === 'approved' ||
      statusParam === 'rejected'
        ? (statusParam as ApprovalStatus)
        : undefined;
    try {
      return json({ approvals: await store.list(status) });
    } catch (error) {
      return unavailable(error);
    }
  }

  if (method === 'POST' && path === '/approvals') {
    const body = await readJsonBody(request);
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (!title) {
      return json({ error: 'title required' }, { status: 400 });
    }
    try {
      const approval = await store.create({
        title,
        body: typeof body?.body === 'string' ? body.body : undefined,
        metadata:
          body?.metadata &&
          typeof body.metadata === 'object' &&
          !Array.isArray(body.metadata)
            ? (body.metadata as Record<string, unknown>)
            : undefined,
      });
      return json(approval, { status: 201 });
    } catch (error) {
      return unavailable(error);
    }
  }

  const resolveId = parseResolvePath(path);
  if (method === 'POST' && resolveId) {
    const body = await readJsonBody(request);
    const decision = body?.decision;
    if (decision !== 'approved' && decision !== 'rejected') {
      return json(
        { error: 'decision must be "approved" or "rejected"' },
        { status: 400 },
      );
    }
    try {
      const existing = await store.get(resolveId);
      if (!existing) {
        return json({ error: 'not found' }, { status: 404 });
      }
      if (existing.status !== 'pending') {
        return json(
          { error: 'already resolved', approval: existing },
          { status: 409 },
        );
      }
      const approval = (await store.resolve(resolveId, decision))!;
      return json(approval);
    } catch (error) {
      return unavailable(error);
    }
  }

  return json({ error: 'not found' }, { status: 404 });
}
