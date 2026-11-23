# ADR 004 — db-store is the sole SQL owner

## Status

Accepted

## Context

If every extension BFF opens Drizzle/SQL, we lose central policy, migrations, and security review surface.

## Decision

- Only **builtins** may hold SQL credentials. Document / document-query SQL lives in **`db-store`** (Drizzle). Related exceptions:
  - **`auth`** — Better Auth tables (`AGENT_OS_EXT_AUTH_DB`)
  - **`vector-store`** — pgvector tables (`AGENT_OS_EXT_VECTOR_STORE_DATABASE_URL`)
- All customer / extension code uses `@agentos/core/api/*` / `agentos.*` HTTP clients — never a product `DATABASE_URL`.
- Same pattern for **`cache-store`** (cache credentials stay in the builtin).

## Consequences

- Slightly higher latency per query (HTTP hop) — acceptable for v1 clarity.
- Customer extensions must never set `DATABASE_URL` for app data access.
- Adding another SQL-owning builtin requires an explicit ADR note; do not open Drizzle in customer extensions.
