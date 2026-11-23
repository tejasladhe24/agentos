import type {
  DeleteInput,
  QueryInput,
  UpsertInput,
  VectorItem,
  VectorStore,
} from './types';
import { cosineSimilarity, metadataMatches } from './validate';

type StoredRow = VectorItem & { orgId: string; indexName: string };

function rowKey(indexName: string, orgId: string, id: string): string {
  return `${indexName}\0${orgId}\0${id}`;
}

/** In-process cosine index for local/dev and unit tests. */
export function createMemoryStore(dimensions: number): VectorStore {
  const rows = new Map<string, StoredRow>();

  return {
    mode: 'memory',
    dimensions,

    async upsert(indexName, orgId, input: UpsertInput) {
      for (const item of input.items) {
        rows.set(rowKey(indexName, orgId, item.id), {
          ...item,
          indexName,
          orgId,
          metadata: item.metadata ? { ...item.metadata } : undefined,
          embedding: [...item.embedding],
        });
      }
      return { upserted: input.items.length };
    },

    async query(indexName, orgId, input: QueryInput) {
      const topK = input.topK ?? 5;
      const scored: Array<{ id: string; score: number; row: StoredRow }> = [];
      for (const row of rows.values()) {
        if (row.indexName !== indexName || row.orgId !== orgId) continue;
        if (!metadataMatches(row.metadata, input.filter)) continue;
        scored.push({
          id: row.id,
          score: cosineSimilarity(input.embedding, row.embedding),
          row,
        });
      }
      scored.sort((a, b) => b.score - a.score);
      return {
        items: scored.slice(0, topK).map(({ id, score, row }) => ({
          id,
          score,
          content: row.content,
          metadata: row.metadata,
        })),
      };
    },

    async delete(indexName, orgId, input: DeleteInput) {
      const ids = input.ids ?? (input.id ? [input.id] : []);
      let deleted = 0;
      for (const id of ids) {
        if (rows.delete(rowKey(indexName, orgId, id))) deleted += 1;
      }
      return { deleted };
    },
  };
}
