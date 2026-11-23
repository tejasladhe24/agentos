import { DEFAULT_DIMENSIONS } from './constants';
import { createMemoryStore } from './memory-store';
import { createPgvectorStore } from './pgvector-store';
import type { VectorStore, VectorStoreMode } from './types';
import { VectorStoreError } from './vector-store-error';

export type CreateVectorStoreOptions = {
  mode?: VectorStoreMode | 'auto';
  databaseUrl?: string;
  dimensions?: number;
};

function resolveDimensions(raw: number | undefined): number {
  const n = raw ?? DEFAULT_DIMENSIONS;
  if (!Number.isInteger(n) || n < 1 || n > 16_384) {
    throw new VectorStoreError(
      'AGENT_OS_EXT_VECTOR_STORE_DIMENSIONS must be an integer 1..16384',
      500,
    );
  }
  return n;
}

/**
 * Build the vector backend.
 * - `memory` — in-process cosine (default when no DATABASE_URL)
 * - `pgvector` — Postgres + pgvector (required for production RAG)
 * - `auto` — pgvector when URL set, else memory
 */
export async function createVectorStore(
  options: CreateVectorStoreOptions = {},
): Promise<VectorStore> {
  const dimensions = resolveDimensions(options.dimensions);
  const mode = options.mode ?? 'auto';
  const url = options.databaseUrl?.trim();

  if (mode === 'memory') {
    return createMemoryStore(dimensions);
  }

  if (mode === 'pgvector') {
    if (!url) {
      throw new VectorStoreError(
        'Postgres + pgvector required for RAG (set AGENT_OS_EXT_VECTOR_STORE_DATABASE_URL)',
        501,
      );
    }
    return createPgvectorStore(url, dimensions);
  }

  // auto
  if (url) {
    return createPgvectorStore(url, dimensions);
  }
  return createMemoryStore(dimensions);
}
