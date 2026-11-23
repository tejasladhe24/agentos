# Built-in extensions

Shipped in `packages/core/builtins/`. Registry flags: `kind: "builtin"`, `driven: true`, `toggleable: false`.

## Driving (required)

| Id              | Role                                                                                                                                                                                                                                                                                            | Tech                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **auth**        | Identity, sessions, **RBAC**, **organizations (tenancy)**; public gate at `/login` `/register` `/reset-password`; Activity Bar **secondary** `ui/page.tsx` + `ui/sidebar.tsx` = **account settings** (profile / organization / roles / security / session) — distinct from builtin **settings** | Better Auth (+ org tables on auth DB)                                  |
| **db-store**    | Sole SQL owner; **org-scoped** `documents` (`org_id` column + PK `(collection, org_id, id)`)                                                                                                                                                                                                    | Drizzle (SQLite default; Postgres + RLS)                               |
| **cache-store** | Sole cache owner                                                                                                                                                                                                                                                                                | In-memory default; Redis when `AGENT_OS_EXT_CACHE_STORE_REDIS_URL` set |
| **ai**          | generateText/Image/embed, tools/skills/agents runtime                                                                                                                                                                                                                                           | Vercel AI SDK v7 (mock default; [ADR 006](./adr/006-vercel-ai-sdk.md)) |

## Supporting (default-on)

| Id                | Role                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **hitl**          | Approvals API (durable via db-store); Activity Bar **secondary** opens HITL panel in left sidebar (no `ui/`)                   |
| **settings**      | App/platform preferences; Activity Bar **secondary** (`GearSix`) opens `ui/page.tsx` (distinct from Auth **account** settings) |
| **events**        | Cross-extension pub/sub                                                                                                        |
| **files**         | Blob/object API (local FS default; optional S3-compatible)                                                                     |
| **notifications** | Toast/fan-out + email/SMS delivery; recent inbox + delivery status via db-store                                                |
| **secrets**       | Per-tenant credential vault (encrypted) + env fallback                                                                         |
| **audit**         | Append-only audit via db-store                                                                                                 |
| **vector-store**  | Org-scoped embedding upsert / similarity query (pgvector; in-memory for local/tests)                                           |

## Access pattern

Customer (and most) APIs call builtins through `@agentos/core/api/*` or `agentos.*` — never hold `DATABASE_URL` themselves.

Extension Manager shows builtins as **locked**.

## Scale / replicas

HITL approvals, the notifications recent inbox, and the **events** durable outbox / job scheduler persist through **db-store** (SQLite or Postgres), so a **single-replica** restart keeps pending approvals, recent toasts, undelivered events, and scheduled jobs. **SSE live subscribe** on `events` is still process-local — multiple Shell/gateway replicas will not share one SSE fanout. Prefer `max_instances` / ECS/EKS replicas at **1** for live Shell SSE until a shared pub/sub exists; durable **claim / ack** consumers can already run multi-replica because leases live in db-store.

**cache-store** defaults to in-memory. Set `AGENT_OS_EXT_CACHE_STORE_REDIS_URL` (`redis://…` / `rediss://…`, portable protocol — Upstash, ElastiCache, local) before raising `max_instances` / replicas above **1** when replicas must share permission caches, rate limits, or page fingerprints. `GET /health` reports `backend: "memory" | "redis"`. Redis via cache-store is still optional for events SSE fanout (not implemented yet).

## Cache-store env

Secrets stay in `createEnv` / runtime env — never `agentos.config.ts`. Default backend is **in-memory**. When `AGENT_OS_EXT_CACHE_STORE_REDIS_URL` is set, the builtin uses Bun’s portable `RedisClient` (no Cloudflare KV in core).

| Variable                             | Role                                               |
| ------------------------------------ | -------------------------------------------------- |
| `AGENT_OS_EXT_CACHE_STORE_REDIS_URL` | Enables Redis backend (`redis://…` / `rediss://…`) |
| `AGENT_OS_EXT_CACHE_STORE_PORT`      | Upstream listen port (default `6112`)              |

Keys are stored under the prefix `agentos:cache:`. Customers never hold Redis credentials — only this builtin.

## Events (durable outbox + scheduler)

Builtin **`events`** writes every `POST /publish` to platform collection `events_outbox`, then fans out to in-process SSE subscribers. Workers pull with lease-based claim:

| Method   | Path                          | Role                                                                |
| -------- | ----------------------------- | ------------------------------------------------------------------- |
| `POST`   | `/api/ext/events/publish`     | Durable insert + SSE fanout                                         |
| `GET`    | `/api/ext/events/subscribe`   | SSE (live, process-local)                                           |
| `POST`   | `/api/ext/events/queue/claim` | Claim due messages (`limit`)                                        |
| `POST`   | `/api/ext/events/queue/ack`   | Ack by `id`                                                         |
| `POST`   | `/api/ext/events/queue/nack`  | Nack → backoff; after max attempts → `dead`                         |
| `POST`   | `/api/ext/events/jobs`        | Register `kind: "at" \| "cron"` job (`action: "publish" \| "http"`) |
| `GET`    | `/api/ext/events/jobs`        | List jobs                                                           |
| `DELETE` | `/api/ext/events/jobs/:id`    | Delete job                                                          |
| `POST`   | `/api/ext/events/jobs/tick`   | Run due jobs once (also on an internal timer)                       |

**Cron expr:** `@every 30s` / `@every 5m` / `@every 1h`, or standard 5-field UTC cron. **Poison messages:** after `AGENT_OS_EXT_EVENTS_MAX_ATTEMPTS` (default 5) nacks, status becomes `dead` — inspect via claim/list tooling or db-store; replay is a manual re-publish for now. HITL approve/reject publishes topic **`hitl.resolved`** with `{ approvalId, decision, title, resolvedAt }`.

| Variable                                      | Role                                      |
| --------------------------------------------- | ----------------------------------------- |
| `AGENT_OS_EXT_EVENTS_DB_STORE_HOST` / `_PORT` | Peer db-store (defaults `127.0.0.1:6111`) |
| `AGENT_OS_EXT_EVENTS_LEASE_MS`                | Claim visibility timeout (default 30000)  |
| `AGENT_OS_EXT_EVENTS_MAX_ATTEMPTS`            | Nacks before `dead` (default 5)           |
| `AGENT_OS_EXT_EVENTS_TICK_MS`                 | Scheduler poll interval (default 1000)    |

## Notifications delivery env

Secrets stay in `createEnv` / runtime env — never `agentos.config.ts`. Default providers are **log sinks** (print and mark `sent`) so local/dev works without Resend / Cloudflare / Twilio.

| Variable                                      | Role                                                            |
| --------------------------------------------- | --------------------------------------------------------------- |
| `AGENT_OS_EXT_NOTIFICATIONS_EMAIL_PROVIDER`   | `log` (default), `resend`, or `cloudflare` (Email Sending REST) |
| `AGENT_OS_EXT_NOTIFICATIONS_EMAIL_API_KEY`    | Resend API key, or Cloudflare API token (`Email Sending Write`) |
| `AGENT_OS_EXT_NOTIFICATIONS_EMAIL_FROM`       | From address (required for `resend` / `cloudflare`)             |
| `AGENT_OS_EXT_NOTIFICATIONS_EMAIL_ACCOUNT_ID` | Cloudflare account id (required when provider is `cloudflare`)  |
| `AGENT_OS_EXT_NOTIFICATIONS_SMS_PROVIDER`     | `log` (default) or `twilio`                                     |
| `AGENT_OS_EXT_NOTIFICATIONS_SMS_ACCOUNT_SID`  | Twilio Account SID                                              |
| `AGENT_OS_EXT_NOTIFICATIONS_SMS_AUTH_TOKEN`   | Twilio Auth Token                                               |
| `AGENT_OS_EXT_NOTIFICATIONS_SMS_FROM`         | Twilio from number (E.164)                                      |

**Cloudflare Email Sending** uses the public REST API (`POST /accounts/{account_id}/email/sending/send`) — no Workers binding inside the Bun builtin. Domain must be onboarded under Email Service; token needs **Email Sending Write**.

**API**

| Method | Path                                    | Role                                                                                                                                           |
| ------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/ext/notifications/notify`         | Enqueue: `channel` `in_app` \| `email` \| `sms` (default `in_app`); optional `templateId`, `vars`, `to`, `subject`, `message`, `type`, `orgId` |
| `GET`  | `/api/ext/notifications/recent`         | In-app inbox only (Shell toasts)                                                                                                               |
| `GET`  | `/api/ext/notifications/deliveries/:id` | Delivery status (`queued` \| `sent` \| `failed`)                                                                                               |

**Templates** (builtin catalog ids): `client-reminder` (`name`, `title`, `message`, `appName`), `digest` (`date`, `summary`). Placeholders use `{{var}}`; missing vars render as empty strings. Per-org custom templates are a follow-up.

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
| `AGENT_OS_EXT_AUTH_SSO_ISSUER`           | Optional                         | OIDC issuer URL for defaultSSO (Auth0 / Okta / Entra / Keycloak / …)                            |
| `AGENT_OS_EXT_AUTH_SSO_CLIENT_ID`        | Optional                         | OIDC client id (required with issuer + secret to enable defaultSSO)                             |
| `AGENT_OS_EXT_AUTH_SSO_CLIENT_SECRET`    | Optional                         | OIDC client secret                                                                              |
| `AGENT_OS_EXT_AUTH_SSO_DOMAIN`           | Optional                         | Email domain matched to the IdP (default `example.com`)                                         |
| `AGENT_OS_EXT_AUTH_SSO_PROVIDER_ID`      | Optional                         | Better Auth provider id (default `default-oidc`)                                                |
| `AGENT_OS_EXT_AUTH_SSO_TRUSTED_ORIGINS`  | Optional                         | Comma-separated extra IdP origins for OIDC discovery                                            |

When `AGENT_OS_GLOBAL_APP_ORIGIN` or `AGENT_OS_EXT_AUTH_BASE_URL` is `https:`, auth sets `useSecureCookies` and `Secure` cookie attributes.

**SSO (OIDC / SAML):** Better Auth `@better-auth/sso` plugin. Email/password stays enabled. Set the SSO env vars above for a demo/default OIDC IdP, or register providers at runtime via Better Auth (`POST /api/ext/auth/sso/register` — forwarded to the plugin). SAML ACS / OIDC callback URLs are under `/api/ext/auth/sso/…` (gateway → Bun). `POST /api/ext/auth/sign-in/sso` with `{ callbackURL, providerId | email | domain }` returns `{ url, redirect: true }` for the IdP.

**Production storage:** prefer managed Postgres (Neon / RDS / Cloud SQL) via `AGENT_OS_EXT_AUTH_DB`. Same single env key as local SQLite — do not set a customer `DATABASE_URL`. Auth, db-store, and **vector-store** are the builtins allowed to hold SQL credentials ([ADR 004](./adr/004-db-store-sole-sql-owner.md) — customers never get a product `DATABASE_URL`). On Neon, prefer the **direct** (non-pooler) host for startup migrations.

## Tenancy (org model + org-scoped db-store)

**Auth org APIs** (cookie session required):

| Method | Path                        | Role                                           |
| ------ | --------------------------- | ---------------------------------------------- |
| `GET`  | `/api/ext/auth/orgs`        | List memberships + active `orgId`              |
| `POST` | `/api/ext/auth/orgs`        | Create org (creator → `owner`, becomes active) |
| `POST` | `/api/ext/auth/orgs/switch` | `{ orgId }` — membership required              |

`GET /session` includes `orgId` and `orgs: { id, name, role }[]`. Kit: `requireOrg()` from `@agentos/core/api/auth`.

**Role admin APIs** (require permission `auth.roles.manage` — seeded on `admin` / `owner`):

| Method | Path                                    | Role                                                    |
| ------ | --------------------------------------- | ------------------------------------------------------- |
| `GET`  | `/api/ext/auth/roles`                   | Role catalog + `role_permissions` rows                  |
| `GET`  | `/api/ext/auth/orgs/members`            | Members of the active org with roles                    |
| `POST` | `/api/ext/auth/orgs/members/roles`      | `{ userId, role }` — set org membership role            |
| `PUT`  | `/api/ext/auth/roles/:role/permissions` | `{ permissions: string[] }` — replace grants for a role |

Permission checks resolve **active org membership role** plus global `user_roles`. Seeded roles: `admin`, `owner`, `reviewer`, `sales`, `viewer`, `external_viewer`. Product permissions (e.g. `trustdesk.*`) are added by apps via the permissions PUT.

**db-store isolation**

- Every tenant row has `org_id`. PK is `(collection, org_id, id)`.
- Inserts stamp `org_id` (and mirror `data.orgId`). Client `orgId` that disagrees → 403.
- Queries / updates / deletes always filter by the resolved org.
- Resolve order: platform collection → `__platform__`; else auth session cookie → `orgId`; else header `X-AgentOS-Org-Id` (peer / FDE via `dbStore.collection(name, { orgId })`).
- Platform collections (no session): `agentos_gateway`, `hitl_approvals`, `audit_entries`, `notifications`.

**Postgres RLS:** on boot, db-store enables RLS and policy `documents_org_isolation` requiring `org_id = current_setting('app.current_org_id', true)`. Each request calls `set_config(..., true)` (transaction-local) before CRUD. Drizzle `WHERE org_id = ?` remains the primary filter.

**SQLite:** no RLS — mandatory `WHERE org_id = ?` in `collections.ts` (covered by isolation tests).

**Backfill:** existing DBs without `org_id` are migrated in-place; legacy rows get `org_id = '__unscoped__'`. Treat that sentinel as orphaned — reassign or delete before production multi-tenant use. New installs create the org-scoped schema from day one.

### db-store query operators (ticket 76)

`POST /collections/:name/query` accepts Mongo-style field filters. Equality shorthand still works. Operators nest **under a field** (never top-level `$gt`).

| Shape                                        | Meaning                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `{ city: "London" }`                         | `$eq`                                                                                                              |
| `{ amount: { $eq: 10 } }`                    | explicit equality                                                                                                  |
| `{ amount: { $ne: 0 } }`                     | not equal                                                                                                          |
| `{ amount: { $gt / $gte / $lt / $lte: n } }` | range (numbers compare numerically; other scalars lexicographically via string coerce — ISO dates work as strings) |
| `{ status: { $in: ["open", "held"] } }`      | membership (non-empty scalar array)                                                                                |
| `{ amount: { $gte: 10, $lt: 100 } }`         | AND of operators on one field                                                                                      |

**Also:** `sort: { createdAt: "desc", amount: "asc" }` (object key order = priority; fields may be document keys or meta `id` / `createdAt` / `updatedAt`), plus existing `limit` / `offset`.

**Rejected:** unknown `$ops`, top-level `$gt`, empty `$in`, non-scalar comparisons, invalid field names (top-level `A-Za-z0-9_` only — no dotted paths in v1).

**Dialects:** SQLite and Postgres share the **same** operator + sort semantics (evaluated in-process over the org+collection partition). That moves filtering out of portfolio services; it is not yet a SQL pushdown of every predicate.

**Postgres indexes** (created on boot when using Postgres):

| Index                                                                  | Purpose                               |
| ---------------------------------------------------------------------- | ------------------------------------- |
| `documents_data_gin` (`GIN` / `jsonb_path_ops`)                        | Containment-style lookups on `data`   |
| `documents_expiry_at_expr` `(collection, org_id, (data->>'expiryAt'))` | VendorGate / expiry-style range scans |
| `documents_created_at_meta` `(collection, org_id, created_at DESC)`    | Recent-first lists                    |

Extra expression indexes for app-specific paths (e.g. `data->>'transactedAt'`) can be added in ops without changing the HTTP API — keep the single `documents` table ([ADR 004](./adr/004-db-store-sole-sql-owner.md)).

## Secrets vault (per-tenant)

Builtin **`secrets`** stores OAuth refresh tokens and API keys **per org** in db-store collection `secrets_vault` (tenant-scoped — not `__platform__`). Values are **AES-256-GCM** encrypted with a platform master key before insert. Plaintext is never written to db-store and must not be logged.

**Resolve order (GET):** vault decrypt for the active org → env fallback (`AGENT_OS_EXT_SECRETS_MAP` or `AGENT_OS_EXT_SECRETS_<KEY>`).

| Method   | Path                      | Role                                                                               |
| -------- | ------------------------- | ---------------------------------------------------------------------------------- |
| `GET`    | `/api/ext/secrets/:key`   | Vault (needs org) then env fallback; permission `secrets.read` when session cookie |
| `PUT`    | `/api/ext/secrets/:key`   | `{ value, expiresAt? }` — encrypt + upsert; `secrets.write` / peer org header      |
| `DELETE` | `/api/ext/secrets/:key`   | Remove vault row; `secrets.write` / peer org header                                |
| `GET`    | `/api/ext/secrets/health` | `{ ok, vault, masterKey }`                                                         |

**Org context:** auth session cookie `orgId`, or peer header `X-AgentOS-Org-Id` (services / FDE). Session callers need RBAC; peer header is trusted (same pattern as db-store). Kit: `getSecret` / `putSecret` / `deleteSecret` from `@agentos/core/api/secrets` with `{ orgId }` or forwarded `cookie`.

**Threat model (v1)**

| Asset                        | Control                                                                    |
| ---------------------------- | -------------------------------------------------------------------------- |
| Vault ciphertext in db-store | AES-256-GCM; unique IV per write; master key never in documents            |
| Master key                   | Process env only (`AGENT_OS_EXT_SECRETS_MASTER_KEY`); rotate by re-encrypt |
| Cross-org read               | db-store `org_id` filter + secrets checks `orgId` on the row               |
| Bootstrap / local demos      | Env map / per-key env still work without a master key (read-only)          |
| Config misuse                | Never put customer tokens in `agentos.config.ts`                           |

KMS (Cloudflare / AWS) can wrap the master key later; the vault API stays the same.

| Variable                                       | Role                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `AGENT_OS_EXT_SECRETS_MASTER_KEY`              | 32-byte AES key as **base64** (preferred) or **64-char hex**; required for PUT |
| `AGENT_OS_EXT_SECRETS_MAP`                     | Optional JSON object key→value (env fallback)                                  |
| `AGENT_OS_EXT_SECRETS_<KEY>`                   | Per-key env fallback (`api-token` → `AGENT_OS_EXT_SECRETS_API_TOKEN`)          |
| `AGENT_OS_EXT_SECRETS_DB_STORE_HOST` / `_PORT` | Peer db-store (defaults `127.0.0.1:6111`)                                      |
| `AGENT_OS_EXT_SECRETS_AUTH_API_BASE`           | Optional auth base for session / permission checks                             |

Generate a local master key: `openssl rand -base64 32`.

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

## Vector store (pgvector)

Builtin **`vector-store`** owns embedding **storage and similarity search** only. Generate vectors with builtin **`ai`** (`embed` / `agentos.ai.embed`), then upsert. Customer code never holds a DB URL.

| Method | Path                                         | Role                                                                                      |
| ------ | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `GET`  | `/api/ext/vector-store/health`               | `{ ok, mode, dimensions }` — `mode` is `memory` or `pgvector`                             |
| `POST` | `/api/ext/vector-store/indexes/:name/upsert` | `{ items: [{ id, embedding, content?, metadata? }] }`                                     |
| `POST` | `/api/ext/vector-store/indexes/:name/query`  | `{ embedding, topK?, filter? }` → cosine hits with optional flat metadata equality filter |
| `POST` | `/api/ext/vector-store/indexes/:name/delete` | `{ id? \| ids? }`                                                                         |

**Org context:** auth session cookie `orgId`, or peer header `X-AgentOS-Org-Id` (services / FDE). Rows are keyed by `(index_name, org_id, id)`.

| Variable                                 | Role                                                                |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `AGENT_OS_EXT_VECTOR_STORE_PORT`         | Upstream port (default `6120`)                                      |
| `AGENT_OS_EXT_VECTOR_STORE_MODE`         | `auto` (default), `memory`, or `pgvector`                           |
| `AGENT_OS_EXT_VECTOR_STORE_DATABASE_URL` | `postgres://…` for production RAG (requires **pgvector** extension) |
| `AGENT_OS_EXT_VECTOR_STORE_DIMENSIONS`   | Embedding length (default `1536`); must match `ai.embed` output     |

**Postgres required for RAG:** set `DATABASE_URL` + install pgvector. Without a Postgres URL, `auto` falls back to an **in-memory** cosine index (fine for local/tests; not durable / not multi-replica). Non-Postgres URLs and missing pgvector return **501** with a clear error. Kit: `@agentos/core/api/vector-store` / `agentos.vector_store`.
