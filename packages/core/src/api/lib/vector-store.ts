/**
 * @agentos/core/api/vector-store — HTTP client for builtin `vector-store` (ticket 79).
 * Storage/search only; generate embeddings via `@agentos/core/api/ai` embed.
 */

import { getJson, jsonFetch, resolveExtApiBase, type EnvMap } from './http';

/** Resolve builtin vector-store API base (`…/api/ext/vector-store` or test override). */
export function resolveVectorStoreApiBase(env: EnvMap = Bun.env): string {
  return resolveExtApiBase(
    'vector-store',
    'AGENT_OS_VECTOR_STORE_API_BASE',
    env,
  );
}

/** Trusted peer / FDE header for active org (matches vector-store + db-store). */
export const VECTOR_STORE_ORG_ID_HEADER = 'x-agentos-org-id';

export type VectorItem = {
  id: string;
  embedding: number[];
  content?: string;
  metadata?: Record<string, unknown>;
};

export type UpsertInput = {
  items: VectorItem[];
};

export type UpsertResult = {
  upserted: number;
};

export type QueryInput = {
  embedding: number[];
  topK?: number;
  filter?: Record<string, unknown>;
};

export type QueryHit = {
  id: string;
  score: number;
  content?: string;
  metadata?: Record<string, unknown>;
};

export type QueryResult = {
  items: QueryHit[];
};

export type DeleteInput = {
  id?: string;
  ids?: string[];
};

export type DeleteResult = {
  deleted: number;
};

export type VectorStoreHealth = {
  ok: boolean;
  mode: 'memory' | 'pgvector';
  dimensions: number;
};

export type VectorStoreCallInit = {
  /** Forward cookie / auth headers from the inbound FDE request. */
  headers?: HeadersInit;
  /** Active org id sent as `X-AgentOS-Org-Id` (peer / service path). */
  orgId?: string;
  env?: EnvMap;
};

function callHeaders(init?: VectorStoreCallInit): Headers {
  const headers = new Headers(init?.headers);
  if (init?.orgId) {
    headers.set(VECTOR_STORE_ORG_ID_HEADER, init.orgId);
  }
  return headers;
}

function indexUrl(base: string, indexName: string, action: string): string {
  return `${base}/indexes/${encodeURIComponent(indexName)}/${action}`;
}

export async function health(env?: EnvMap): Promise<VectorStoreHealth> {
  const base = resolveVectorStoreApiBase(env ?? Bun.env);
  return getJson<VectorStoreHealth>(`${base}/health`, 'vector-store health');
}

/** Upsert vectors into an org-scoped index (caller supplies embeddings). */
export async function upsert(
  indexName: string,
  input: UpsertInput,
  init?: VectorStoreCallInit,
): Promise<UpsertResult> {
  const base = resolveVectorStoreApiBase(init?.env ?? Bun.env);
  return jsonFetch<UpsertResult>(
    indexUrl(base, indexName, 'upsert'),
    {
      method: 'POST',
      body: input,
      headers: callHeaders(init),
    },
    'vector-store upsert',
  );
}

/** Similarity query (cosine) with optional flat metadata equality filter. */
export async function query(
  indexName: string,
  input: QueryInput,
  init?: VectorStoreCallInit,
): Promise<QueryResult> {
  const base = resolveVectorStoreApiBase(init?.env ?? Bun.env);
  return jsonFetch<QueryResult>(
    indexUrl(base, indexName, 'query'),
    {
      method: 'POST',
      body: input,
      headers: callHeaders(init),
    },
    'vector-store query',
  );
}

/** Delete vectors by id(s) within an org-scoped index. */
export async function deleteVectors(
  indexName: string,
  input: DeleteInput,
  init?: VectorStoreCallInit,
): Promise<DeleteResult> {
  const base = resolveVectorStoreApiBase(init?.env ?? Bun.env);
  return jsonFetch<DeleteResult>(
    indexUrl(base, indexName, 'delete'),
    {
      method: 'POST',
      body: input,
      headers: callHeaders(init),
    },
    'vector-store delete',
  );
}
