import {
  CollectionError,
  deleteDocuments,
  insertDocument,
  insertDocumentsBulk,
  queryCollection,
  updateDocument,
} from './collections';
import { setRequestOrgId, type DbStoreContext } from './create-db';
import {
  clearOrgRetention,
  getOrgRetention,
  parseOrgRetentionConfig,
  setOrgRetention,
} from './org-retention';
import {
  resolveOrgForRequest,
  resolveTenantOrgForRequest,
} from './resolve-org';
import {
  clearRetentionPolicy,
  getRetentionPolicy,
  parseRetentionPolicy,
  pruneAfterWrite,
  pruneAllPolicies,
  pruneCollection,
  setRetentionPolicy,
} from './retention';
import { deleteSubject, parseSubjectDeleteInput } from './subject-deletion';

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

const COLLECTION_ACTIONS =
  /^(query|insert|insert-bulk|update|delete|retention|prune)$/;

/** `/collections/:name/(query|insert|insert-bulk|update|delete|retention|prune)` */
function parseCollectionPath(
  path: string,
): { name: string; action: string } | null {
  const match = path.match(/^\/collections\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  const name = decodeURIComponent(match[1]!);
  const action = match[2]!;
  if (!name || !COLLECTION_ACTIONS.test(action)) return null;
  return { name, action };
}

/**
 * Thin Bun request router for `/api/ext/db-store/*` upstream paths.
 */
export async function handleDbStoreRequest(
  ctx: DbStoreContext,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (method === 'GET' && path === '/health') {
    return json({ ok: true, dialect: ctx.dialect });
  }

  if (method === 'POST' && path === '/prune-all') {
    try {
      const result = await pruneAllPolicies(ctx);
      return json(result);
    } catch (error) {
      if (error instanceof CollectionError) {
        return json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  }

  if (method === 'POST' && path === '/org-retention') {
    const org = await resolveTenantOrgForRequest(request);
    if (!org.ok) {
      return json({ error: org.error }, { status: org.status });
    }
    const body = (await readJsonBody(request)) ?? {};
    try {
      if (body.clear === true) {
        const result = await clearOrgRetention(ctx, org.orgId);
        return json(result);
      }
      if (body.get === true || Object.keys(body).length === 0) {
        const config = await getOrgRetention(ctx, org.orgId);
        return json({ config });
      }
      const parsed = parseOrgRetentionConfig(body);
      const config = await setOrgRetention(ctx, org.orgId, parsed);
      return json({ config }, { status: 201 });
    } catch (error) {
      if (error instanceof CollectionError) {
        return json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  }

  if (method === 'POST' && path === '/subjects/delete') {
    const org = await resolveTenantOrgForRequest(request);
    if (!org.ok) {
      return json({ error: org.error }, { status: org.status });
    }
    const body = (await readJsonBody(request)) ?? {};
    try {
      const input = parseSubjectDeleteInput(body);
      const result = await deleteSubject(ctx, org.orgId, input);
      return json(result);
    } catch (error) {
      if (error instanceof CollectionError) {
        return json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  }

  const parsed = parseCollectionPath(path);
  if (method === 'POST' && parsed) {
    const org = await resolveOrgForRequest(parsed.name, request);
    if (!org.ok) {
      return json({ error: org.error }, { status: org.status });
    }
    await setRequestOrgId(ctx, org.orgId);

    const body = (await readJsonBody(request)) ?? {};
    try {
      switch (parsed.action) {
        case 'query': {
          const result = await queryCollection(
            ctx,
            parsed.name,
            {
              where:
                body.where && typeof body.where === 'object'
                  ? (body.where as Record<string, unknown>)
                  : undefined,
              sort:
                body.sort &&
                typeof body.sort === 'object' &&
                !Array.isArray(body.sort)
                  ? (body.sort as Record<string, 'asc' | 'desc'>)
                  : undefined,
              limit: typeof body.limit === 'number' ? body.limit : undefined,
              offset: typeof body.offset === 'number' ? body.offset : undefined,
            },
            org.orgId,
          );
          return json(result);
        }
        case 'insert': {
          const data = body.data;
          const id = typeof body.id === 'string' ? body.id : undefined;
          if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return json(
              { error: 'data must be a JSON object' },
              { status: 400 },
            );
          }
          const doc = await insertDocument(
            ctx,
            parsed.name,
            {
              id,
              data: data as Record<string, unknown>,
            },
            org.orgId,
          );
          await pruneAfterWrite(ctx, parsed.name, org.orgId);
          return json(doc, { status: 201 });
        }
        case 'insert-bulk': {
          const docs = body.docs;
          if (!Array.isArray(docs)) {
            return json({ error: 'docs must be an array' }, { status: 400 });
          }
          const result = await insertDocumentsBulk(
            ctx,
            parsed.name,
            {
              docs: docs as Array<{
                id?: string;
                data: Record<string, unknown>;
              }>,
            },
            org.orgId,
          );
          await pruneAfterWrite(ctx, parsed.name, org.orgId);
          return json(result, { status: 201 });
        }
        case 'update': {
          const id = typeof body.id === 'string' ? body.id : '';
          const data = body.data;
          if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return json(
              { error: 'data must be a JSON object' },
              { status: 400 },
            );
          }
          const doc = await updateDocument(
            ctx,
            parsed.name,
            {
              id,
              data: data as Record<string, unknown>,
              merge: body.merge === true,
            },
            org.orgId,
          );
          return json(doc);
        }
        case 'delete': {
          const result = await deleteDocuments(
            ctx,
            parsed.name,
            {
              id: typeof body.id === 'string' ? body.id : undefined,
              ids: Array.isArray(body.ids)
                ? (body.ids as unknown[]).filter(
                    (v): v is string => typeof v === 'string',
                  )
                : undefined,
            },
            org.orgId,
          );
          return json(result);
        }
        case 'retention': {
          if (body.clear === true) {
            const result = await clearRetentionPolicy(
              ctx,
              parsed.name,
              org.orgId,
            );
            return json(result);
          }
          if (body.get === true || Object.keys(body).length === 0) {
            const policy = await getRetentionPolicy(
              ctx,
              parsed.name,
              org.orgId,
            );
            return json({ policy });
          }
          const parsedPolicy = parseRetentionPolicy(body);
          const record = await setRetentionPolicy(
            ctx,
            parsed.name,
            org.orgId,
            parsedPolicy,
          );
          return json({ policy: record }, { status: 201 });
        }
        case 'prune': {
          const result = await pruneCollection(
            ctx,
            parsed.name,
            org.orgId,
            undefined,
          );
          return json(result);
        }
        default:
          return json({ error: 'not found' }, { status: 404 });
      }
    } catch (error) {
      if (error instanceof CollectionError) {
        return json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  }

  return json({ error: 'not found' }, { status: 404 });
}
