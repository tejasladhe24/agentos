import { DEFAULT_TOP_K, MAX_UPSERT_BATCH } from './constants';
import type { DeleteInput, QueryInput, UpsertInput, VectorItem } from './types';
import { VectorStoreError } from './vector-store-error';

const INDEX_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

export function assertIndexName(name: string): string {
  const trimmed = name.trim();
  if (!INDEX_NAME_RE.test(trimmed)) {
    throw new VectorStoreError(
      'invalid index name (use letter-starting [a-zA-Z0-9_-], max 64)',
      400,
    );
  }
  return trimmed;
}

function assertEmbedding(
  embedding: unknown,
  dimensions: number,
  label: string,
): number[] {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new VectorStoreError(
      `${label}: embedding must be a non-empty array`,
      400,
    );
  }
  if (embedding.length !== dimensions) {
    throw new VectorStoreError(
      `${label}: embedding length ${embedding.length} !== configured dimensions ${dimensions}`,
      400,
    );
  }
  const out: number[] = [];
  for (let i = 0; i < embedding.length; i++) {
    const v = embedding[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new VectorStoreError(
        `${label}: embedding[${i}] must be a finite number`,
        400,
      );
    }
    out.push(v);
  }
  return out;
}

function assertMetadata(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new VectorStoreError('metadata must be a plain object', 400);
  }
  return value as Record<string, unknown>;
}

function parseItem(
  raw: unknown,
  dimensions: number,
  index: number,
): VectorItem {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new VectorStoreError(`items[${index}] must be an object`, 400);
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string' || !obj.id.trim()) {
    throw new VectorStoreError(`items[${index}].id required`, 400);
  }
  const item: VectorItem = {
    id: obj.id.trim(),
    embedding: assertEmbedding(obj.embedding, dimensions, `items[${index}]`),
  };
  if (typeof obj.content === 'string') item.content = obj.content;
  const metadata = assertMetadata(obj.metadata);
  if (metadata) item.metadata = metadata;
  return item;
}

export function parseUpsertBody(
  body: unknown,
  dimensions: number,
): UpsertInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new VectorStoreError('JSON body required', 400);
  }
  const itemsRaw = (body as { items?: unknown }).items;
  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
    throw new VectorStoreError('items must be a non-empty array', 400);
  }
  if (itemsRaw.length > MAX_UPSERT_BATCH) {
    throw new VectorStoreError(
      `items batch exceeds max ${MAX_UPSERT_BATCH}`,
      400,
    );
  }
  return {
    items: itemsRaw.map((item, i) => parseItem(item, dimensions, i)),
  };
}

export function parseQueryBody(body: unknown, dimensions: number): QueryInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new VectorStoreError('JSON body required', 400);
  }
  const obj = body as Record<string, unknown>;
  const embedding = assertEmbedding(obj.embedding, dimensions, 'query');
  let topK = DEFAULT_TOP_K;
  if (obj.topK !== undefined) {
    if (
      typeof obj.topK !== 'number' ||
      !Number.isInteger(obj.topK) ||
      obj.topK < 1 ||
      obj.topK > 100
    ) {
      throw new VectorStoreError('topK must be an integer 1..100', 400);
    }
    topK = obj.topK;
  }
  let filter: Record<string, unknown> | undefined;
  if (obj.filter !== undefined && obj.filter !== null) {
    filter = assertMetadata(obj.filter);
  }
  return { embedding, topK, filter };
}

export function parseDeleteBody(body: unknown): DeleteInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new VectorStoreError('JSON body required', 400);
  }
  const obj = body as Record<string, unknown>;
  const ids: string[] = [];
  if (typeof obj.id === 'string' && obj.id.trim()) {
    ids.push(obj.id.trim());
  }
  if (Array.isArray(obj.ids)) {
    for (const id of obj.ids) {
      if (typeof id !== 'string' || !id.trim()) {
        throw new VectorStoreError('ids must be non-empty strings', 400);
      }
      ids.push(id.trim());
    }
  }
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    throw new VectorStoreError('id or ids required', 400);
  }
  return { ids: unique };
}

/** Cosine similarity in [0, 2] distance terms → score = 1 - distance/2 ≈ cosine. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

export function metadataMatches(
  metadata: Record<string, unknown> | undefined,
  filter: Record<string, unknown> | undefined,
): boolean {
  if (!filter) return true;
  const meta = metadata ?? {};
  for (const [key, expected] of Object.entries(filter)) {
    if (meta[key] !== expected) return false;
  }
  return true;
}
