/** Default upstream port — must match `meta.json`. */
export const VECTOR_STORE_PORT = 6120;

/** Trusted peer / FDE header carrying the active org id (matches db-store). */
export const ORG_ID_HEADER = 'x-agentos-org-id';

/** Default embedding dimension (OpenAI text-embedding-3-small / ada-002). */
export const DEFAULT_DIMENSIONS = 1536;

/** Default topK for similarity query. */
export const DEFAULT_TOP_K = 5;

/** Max items per upsert batch. */
export const MAX_UPSERT_BATCH = 500;
