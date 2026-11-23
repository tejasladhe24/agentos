# 79 — `vector-store` builtin (pgvector)

**Status:** in-progress

## Goal

Add a **`vector-store`** builtin (pgvector) with upsert/query and TS + Python clients so TrustDesk questionnaire drafting can retrieve cited policy chunks without embedding search inside ad-hoc services.

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — TrustDesk mapping; gap formerly **56**.

## Depends on

- Ticket **16** / **18** (db-store, ai) — done
- Ticket **71** (tenancy) — vectors must be org-scoped

## Done when

- [x] Builtin `vector-store` with upsert, delete, and similarity query APIs
- [x] Postgres + pgvector path; clear error when dialect lacks vectors
- [x] Org scoping aligned with ticket **71**
- [x] `@agentos/core/api/vector-store` (or equivalent) + Python `agentos` client
- [x] Tests with mocked or optional pgvector
- [x] Docs: embedding dimension config, metadata filters

## Notes

- Reuse ai builtin for embedding generation; vector-store owns storage/search only.
- SQLite fallback is optional; document “Postgres required for RAG” if skipped.
- Default `MODE=auto`: in-memory when no `AGENT_OS_EXT_VECTOR_STORE_DATABASE_URL`; pgvector when set.
