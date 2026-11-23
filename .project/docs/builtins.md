# Built-in extensions

Shipped in `packages/core/builtins/`. Registry flags: `kind: "builtin"`, `driven: true`, `toggleable: false`.

## Driving (required)

| Id              | Role                                                                                                                                                                                                                                                                                            | Tech                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **auth**        | Identity, sessions, **RBAC**, **organizations (tenancy)**; public gate at `/login` `/register` `/reset-password`; Activity Bar **secondary** `ui/page.tsx` + `ui/sidebar.tsx` = **account settings** (profile / organization / roles / security / session) — distinct from builtin **settings** | Better Auth (+ org tables on auth DB)                                  |
| **db-store**    | Sole SQL owner; **org-scoped** `documents` (`org_id` column + PK `(collection, org_id, id)`)                                                                                                                                                                                                    | Drizzle (SQLite default; Postgres + RLS)                               |
| **cache-store** | Sole cache owner                                                                                                                                                                                                                                                                                | In-memory v1                                                           |
| **ai**          | generateText/Image/embed, tools/skills/agents runtime                                                                                                                                                                                                                                           | Vercel AI SDK v7 (mock default; [ADR 006](./adr/006-vercel-ai-sdk.md)) |

## Supporting (default-on)

| Id                | Role                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **hitl**          | Approvals API (durable via db-store); Activity Bar **secondary** opens HITL panel in left sidebar (no `ui/`)                   |
| **settings**      | App/platform preferences; Activity Bar **secondary** (`GearSix`) opens `ui/page.tsx` (distinct from Auth **account** settings) |
| **events**        | Cross-extension pub/sub                                                                                                        |
| **files**         | Blob/object API (local FS default; optional S3-compatible)                                                                     |
| **notifications** | Toast/fan-out; recent inbox durable via db-store                                                                               |
| **secrets**       | Secret resolution                                                                                                              |
| **audit**         | Append-only audit via db-store                                                                                                 |

## Access pattern

Customer (and most) APIs call builtins through `@agentos/core/api/*` or `agentos.*` — never hold `DATABASE_URL` themselves.

Extension Manager shows builtins as **locked**.

## Scale / replicas

HITL approvals and the notifications recent inbox persist through **db-store** (SQLite or Postgres), so a **single-replica** restart keeps pending approvals and recent toasts. Keep Cloudflare `max_instances` / ECS/EKS replicas at **1** until **cache-store** (Redis) and **events** are also externalized — multi-instance would still diverge on in-memory cache/pubsub. Redis via cache-store is an optional follow-up for horizontal scale.

## Auth production env

Secrets stay in `createEnv` / runtime env — never `agentos.config.ts`.

| Variable                                 | Production                       | Notes                                                                                           |
| ---------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `AGENT_OS_EXT_AUTH_SECRET`               | **Required** (≥32 chars)         | No default; must not be the local dev secret                                                    |
| `AGENT_OS_GLOBAL_APP_ORIGIN`             | **Required** for HTTPS Shell     | e.g. `https://app.example.com` — trustedOrigins + secure cookies + reset links                  |
| `AGENT_OS_EXT_AUTH_BASE_URL`             | **Required** for public auth URL | Better Auth `baseURL` as seen by the browser / gateway                                          |
| `AGENT_OS_GLOBAL_NODE_ENV` or `NODE_ENV` | `production`                     | Disables demo admin/viewer seed; requires real secret                                           |
| `AGENT_OS_EXT_AUTH_SEED_DEMO`            | Optional `true`/`false`          | Override seed default (`false` in production, `true` otherwise)                                 |
| `AGENT_OS_EXT_AUTH_DB`                   | Optional                         | SQLite path (default `~/.agentos/store/auth.sqlite`) **or** `postgres://` / `postgresql://` URL |

When `AGENT_OS_GLOBAL_APP_ORIGIN` or `AGENT_OS_EXT_AUTH_BASE_URL` is `https:`, auth sets `useSecureCookies` and `Secure` cookie attributes.

**Production storage:** prefer managed Postgres (Neon / RDS / Cloud SQL) via `AGENT_OS_EXT_AUTH_DB`. Same single env key as local SQLite — do not set a customer `DATABASE_URL`. Auth (like db-store’s `AGENT_OS_EXT_DB_STORE_DATABASE_URL`) is one of the only builtins allowed to hold SQL credentials ([ADR 004](./adr/004-db-store-sole-sql-owner.md)). On Neon, prefer the **direct** (non-pooler) host for startup migrations.

## Tenancy (org model + org-scoped db-store)

**Auth org APIs** (cookie session required):

| Method | Path                        | Role                                           |
| ------ | --------------------------- | ---------------------------------------------- |
| `GET`  | `/api/ext/auth/orgs`        | List memberships + active `orgId`              |
| `POST` | `/api/ext/auth/orgs`        | Create org (creator → `owner`, becomes active) |
| `POST` | `/api/ext/auth/orgs/switch` | `{ orgId }` — membership required              |

`GET /session` includes `orgId` and `orgs: { id, name, role }[]`. Kit: `requireOrg()` from `@agentos/core/api/auth`.

**db-store isolation**

- Every tenant row has `org_id`. PK is `(collection, org_id, id)`.
- Inserts stamp `org_id` (and mirror `data.orgId`). Client `orgId` that disagrees → 403.
- Queries / updates / deletes always filter by the resolved org.
- Resolve order: platform collection → `__platform__`; else auth session cookie → `orgId`; else header `X-AgentOS-Org-Id` (peer / FDE via `dbStore.collection(name, { orgId })`).
- Platform collections (no session): `agentos_gateway`, `hitl_approvals`, `audit_entries`, `notifications`.

**Postgres RLS:** on boot, db-store enables RLS and policy `documents_org_isolation` requiring `org_id = current_setting('app.current_org_id', true)`. Each request calls `set_config(..., true)` (transaction-local) before CRUD. Drizzle `WHERE org_id = ?` remains the primary filter.

**SQLite:** no RLS — mandatory `WHERE org_id = ?` in `collections.ts` (covered by isolation tests).

**Backfill:** existing DBs without `org_id` are migrated in-place; legacy rows get `org_id = '__unscoped__'`. Treat that sentinel as orphaned — reassign or delete before production multi-tenant use. New installs create the org-scoped schema from day one.

## Files storage env

Secrets stay in `createEnv` / runtime env — never `agentos.config.ts`. Default backend is **local filesystem** (`AGENT_OS_EXT_FILES_PATH` or OS temp `agentos-files`). When `AGENT_OS_EXT_FILES_S3_BUCKET` is set, the builtin uses Bun’s portable `S3Client` (works with **Cloudflare R2**, **AWS S3**, and **GCS** S3-compatible endpoints). Do **not** import Cloudflare R2 bindings into `@agentos/core` — ticket 62 only injects credentials into the container env.

| Variable                                  | Role                                                           |
| ----------------------------------------- | -------------------------------------------------------------- |
| `AGENT_OS_EXT_FILES_PATH`                 | Optional local root (ignored when S3 bucket is set)            |
| `AGENT_OS_EXT_FILES_S3_BUCKET`            | Enables S3-compatible backend                                  |
| `AGENT_OS_EXT_FILES_S3_ENDPOINT`          | Endpoint URL (required for R2 / GCS / MinIO; optional for AWS) |
| `AGENT_OS_EXT_FILES_S3_REGION`            | Region (`auto` for R2; e.g. `us-east-1` for AWS)               |
| `AGENT_OS_EXT_FILES_S3_ACCESS_KEY_ID`     | Access key (required when bucket is set)                       |
| `AGENT_OS_EXT_FILES_S3_SECRET_ACCESS_KEY` | Secret key (required when bucket is set)                       |
| `AGENT_OS_EXT_FILES_S3_SESSION_TOKEN`     | Optional session token                                         |

### Example env values

**Cloudflare R2**

```bash
AGENT_OS_EXT_FILES_S3_BUCKET=agentos-files
AGENT_OS_EXT_FILES_S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
AGENT_OS_EXT_FILES_S3_REGION=auto
AGENT_OS_EXT_FILES_S3_ACCESS_KEY_ID=…
AGENT_OS_EXT_FILES_S3_SECRET_ACCESS_KEY=…
```

**AWS S3**

```bash
AGENT_OS_EXT_FILES_S3_BUCKET=agentos-files
AGENT_OS_EXT_FILES_S3_REGION=us-east-1
# endpoint optional — defaults to AWS
AGENT_OS_EXT_FILES_S3_ACCESS_KEY_ID=…
AGENT_OS_EXT_FILES_S3_SECRET_ACCESS_KEY=…
```

**GCS (S3-compatible XML API)**

```bash
AGENT_OS_EXT_FILES_S3_BUCKET=agentos-files
AGENT_OS_EXT_FILES_S3_ENDPOINT=https://storage.googleapis.com
AGENT_OS_EXT_FILES_S3_REGION=auto
AGENT_OS_EXT_FILES_S3_ACCESS_KEY_ID=…   # HMAC key
AGENT_OS_EXT_FILES_S3_SECRET_ACCESS_KEY=…
```
