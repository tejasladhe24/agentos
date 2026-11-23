# 79 — `vector-store` builtin (pgvector)

**Status:** todo

## Goal

Add a **`vector-store`** builtin (pgvector) with upsert/query and TS + Python clients so TrustDesk questionnaire drafting can retrieve cited policy chunks without embedding search inside ad-hoc services.

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — TrustDesk mapping; gap formerly **56**.

## Depends on

- Ticket **16** / **18** (db-store, ai) — done
- Ticket **71** (tenancy) — vectors must be org-scoped

## Done when

- [ ] Builtin `vector-store` with upsert, delete, and similarity query APIs
- [ ] Postgres + pgvector path; clear error when dialect lacks vectors
- [ ] Org scoping aligned with ticket **71**
- [ ] `@agentos/core/api/vector-store` (or equivalent) + Python `agentos` client
- [ ] Tests with mocked or optional pgvector
- [ ] Docs: embedding dimension config, metadata filters

## Notes

- Reuse ai builtin for embedding generation; vector-store owns storage/search only.
- SQLite fallback is optional; document “Postgres required for RAG” if skipped.
