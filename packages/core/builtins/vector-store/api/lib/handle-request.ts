import { resolveOrgForRequest, type ResolveOrgResult } from './resolve-org';
import type { VectorStore } from './types';
import {
  assertIndexName,
  parseDeleteBody,
  parseQueryBody,
  parseUpsertBody,
} from './validate';
import { VectorStoreError } from './vector-store-error';

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

function parseIndexAction(
  path: string,
): { indexName: string; action: 'upsert' | 'query' | 'delete' } | null {
  const match = path.match(/^\/indexes\/([^/]+)\/(upsert|query|delete)$/);
  if (!match?.[1] || !match[2]) return null;
  try {
    return {
      indexName: decodeURIComponent(match[1]),
      action: match[2] as 'upsert' | 'query' | 'delete',
    };
  } catch {
    return null;
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export type VectorStoreContext = {
  store: VectorStore;
  runtimeEnv?: Record<string, string | undefined>;
  /** Override org resolution (tests). */
  resolveOrg?: (
    request: Request,
    env?: Record<string, string | undefined>,
  ) => Promise<ResolveOrgResult>;
};

/**
 * Bun request router for `/api/ext/vector-store/*`.
 */
export async function handleVectorStoreRequest(
  ctx: VectorStoreContext,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (method === 'GET' && path === '/health') {
    return json({
      ok: true,
      mode: ctx.store.mode,
      dimensions: ctx.store.dimensions,
    });
  }

  if (method === 'GET' && path === '/stats') {
    const resolve = ctx.resolveOrg ?? resolveOrgForRequest;
    const org = await resolve(request, ctx.runtimeEnv);
    if (!org.ok) {
      return json({ error: org.error }, { status: org.status });
    }
    return json(await ctx.store.stats(org.orgId));
  }

  if (method !== 'POST') {
    return json({ error: 'method not allowed' }, { status: 405 });
  }

  const parsed = parseIndexAction(path);
  if (!parsed) {
    return json({ error: 'not found' }, { status: 404 });
  }

  try {
    const indexName = assertIndexName(parsed.indexName);
    const resolve = ctx.resolveOrg ?? resolveOrgForRequest;
    const org = await resolve(request, ctx.runtimeEnv);
    if (!org.ok) {
      return json({ error: org.error }, { status: org.status });
    }

    const body = await readJsonBody(request);

    if (parsed.action === 'upsert') {
      const input = parseUpsertBody(body, ctx.store.dimensions);
      const result = await ctx.store.upsert(indexName, org.orgId, input);
      return json(result);
    }

    if (parsed.action === 'query') {
      const input = parseQueryBody(body, ctx.store.dimensions);
      const result = await ctx.store.query(indexName, org.orgId, input);
      return json(result);
    }

    const input = parseDeleteBody(body);
    const result = await ctx.store.delete(indexName, org.orgId, input);
    return json(result);
  } catch (error) {
    if (error instanceof VectorStoreError) {
      return json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
