export type VectorStoreMode = 'memory' | 'pgvector';

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
  /** Flat metadata equality filter (`metadata.key === value`). */
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

export type VectorStore = {
  mode: VectorStoreMode;
  dimensions: number;
  upsert: (
    indexName: string,
    orgId: string,
    input: UpsertInput,
  ) => Promise<UpsertResult>;
  query: (
    indexName: string,
    orgId: string,
    input: QueryInput,
  ) => Promise<QueryResult>;
  delete: (
    indexName: string,
    orgId: string,
    input: DeleteInput,
  ) => Promise<DeleteResult>;
  close?: () => Promise<void> | void;
};
