import postgres from 'postgres';

import type {
  DeleteInput,
  QueryInput,
  UpsertInput,
  VectorStore,
} from './types';
import { metadataMatches } from './validate';
import { VectorStoreError } from './vector-store-error';

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

function isPgvectorMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /extension ["']?vector["']?/i.test(message) ||
    /type ["']?vector["']? does not exist/i.test(message) ||
    /pgvector/i.test(message)
  );
}

/**
 * Postgres + pgvector backend. Requires `CREATE EXTENSION vector` on the DB.
 */
export async function createPgvectorStore(
  databaseUrl: string,
  dimensions: number,
): Promise<VectorStore> {
  if (
    !databaseUrl.startsWith('postgres://') &&
    !databaseUrl.startsWith('postgresql://')
  ) {
    throw new VectorStoreError(
      'Postgres + pgvector required for RAG (set AGENT_OS_EXT_VECTOR_STORE_DATABASE_URL to a postgres:// URL)',
      501,
    );
  }

  const sql = postgres(databaseUrl, { max: 4 });

  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  } catch (error) {
    await sql.end({ timeout: 5 });
    if (isPgvectorMissing(error)) {
      throw new VectorStoreError(
        'pgvector extension unavailable — install pgvector on Postgres (Postgres required for RAG)',
        501,
      );
    }
    throw error;
  }

  // Dimension is baked into the column type; recreate is out of scope for v1.
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS vectors (
      index_name TEXT NOT NULL,
      org_id TEXT NOT NULL,
      id TEXT NOT NULL,
      embedding vector(${dimensions}) NOT NULL,
      content TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (index_name, org_id, id)
    )
  `);

  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS vectors_embedding_hnsw
    ON vectors USING hnsw (embedding vector_cosine_ops)
  `);

  return {
    mode: 'pgvector',
    dimensions,

    async upsert(indexName, orgId, input: UpsertInput) {
      const now = new Date().toISOString();
      for (const item of input.items) {
        const vec = toVectorLiteral(item.embedding);
        const metadata = item.metadata ?? {};
        try {
          await sql`
            INSERT INTO vectors (
              index_name, org_id, id, embedding, content, metadata, created_at, updated_at
            ) VALUES (
              ${indexName},
              ${orgId},
              ${item.id},
              ${vec}::vector,
              ${item.content ?? null},
              ${sql.json(metadata as never)},
              ${now},
              ${now}
            )
            ON CONFLICT (index_name, org_id, id) DO UPDATE SET
              embedding = EXCLUDED.embedding,
              content = EXCLUDED.content,
              metadata = EXCLUDED.metadata,
              updated_at = EXCLUDED.updated_at
          `;
        } catch (error) {
          if (isPgvectorMissing(error)) {
            throw new VectorStoreError(
              'pgvector extension unavailable — Postgres + pgvector required for RAG',
              501,
            );
          }
          throw error;
        }
      }
      return { upserted: input.items.length };
    },

    async query(indexName, orgId, input: QueryInput) {
      const topK = input.topK ?? 5;
      const vec = toVectorLiteral(input.embedding);
      // Fetch a wider candidate set when filtering in app (metadata equality).
      const fetchLimit = input.filter ? Math.min(topK * 20, 500) : topK;

      let rows: Array<{
        id: string;
        content: string | null;
        metadata: Record<string, unknown>;
        distance: number;
      }>;
      try {
        rows = await sql`
          SELECT
            id,
            content,
            metadata,
            (embedding <=> ${vec}::vector) AS distance
          FROM vectors
          WHERE index_name = ${indexName}
            AND org_id = ${orgId}
          ORDER BY embedding <=> ${vec}::vector
          LIMIT ${fetchLimit}
        `;
      } catch (error) {
        if (isPgvectorMissing(error)) {
          throw new VectorStoreError(
            'pgvector extension unavailable — Postgres + pgvector required for RAG',
            501,
          );
        }
        throw error;
      }

      const items = [];
      for (const row of rows) {
        const metadata =
          row.metadata && typeof row.metadata === 'object'
            ? (row.metadata as Record<string, unknown>)
            : undefined;
        if (!metadataMatches(metadata, input.filter)) continue;
        // cosine distance ∈ [0, 2] → similarity ≈ 1 - distance
        const score = 1 - Number(row.distance);
        items.push({
          id: row.id,
          score,
          content: row.content ?? undefined,
          metadata,
        });
        if (items.length >= topK) break;
      }
      return { items };
    },

    async delete(indexName, orgId, input: DeleteInput) {
      const ids = input.ids ?? (input.id ? [input.id] : []);
      if (ids.length === 0) return { deleted: 0 };
      const result = await sql`
        DELETE FROM vectors
        WHERE index_name = ${indexName}
          AND org_id = ${orgId}
          AND id IN ${sql(ids)}
      `;
      return { deleted: result.count };
    },

    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
