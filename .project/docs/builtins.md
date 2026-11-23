# Built-in extensions

Shipped in `packages/core/builtins/`. Registry flags: `kind: "builtin"`, `driven: true`, `toggleable: false`.

## Driving (required)

| Id              | Role                                                                                                                                                                                                                                                                                            | Tech                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **auth**        | Identity, sessions, **RBAC**, **organizations (tenancy)**; public gate at `/login` `/register` `/reset-password`; Activity Bar **secondary** `ui/page.tsx` + `ui/sidebar.tsx` = **account settings** (profile / organization / roles / security / session) — distinct from builtin **settings** | Better Auth (+ org tables on auth DB)                                  |
| **db-store**    | Sole SQL owner; **org-scoped** `documents` (`org_id` column + PK `(collection, org_id, id)`)                                                                                                                                                                                                    | Drizzle (SQLite default; Postgres + RLS)                               |
| **cache-store** | Sole cache owner                                                                                                                                                                                                                                                                                | In-memory default; Redis when `AGENT_OS_EXT_CACHE_STORE_REDIS_URL` set |
| **ai**          | generateText/Image/embed (+ optional JSON Schema / file inputs), tools/skills/agents runtime                                                                                                                                                                                                    | Vercel AI SDK v7 (mock default; [ADR 006](./adr/006-vercel-ai-sdk.md)) |

## Supporting (default-on)

| Id                | Role                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **hitl**          | Approvals API (durable via db-store); Activity Bar **secondary** opens HITL panel in left sidebar (no `ui/`)                                                   |
| **settings**      | App/platform preferences; Activity Bar **secondary** (`GearSix`) opens `ui/page.tsx` (distinct from Auth **account** settings)                                 |
| **events**        | Cross-extension pub/sub                                                                                                                                        |
| **files**         | Blob/object API + Drive-style Activity Bar UI (local FS default; optional S3-compatible; org-scoped)                                                           |
| **notifications** | Toast/fan-out + email/SMS delivery; recent inbox + delivery status via db-store                                                                                |
| **secrets**       | Per-tenant credential vault (encrypted) + env fallback                                                                                                         |
| **audit**         | Append-only Activity log via db-store; Activity Bar **secondary** (`ListBullets`, chrome label **Activity**) opens `ui/page.tsx` — **not** the `events` outbox |
| **vector-store**  | Org-scoped embedding upsert / similarity query (pgvector; in-memory for local/tests)                                                                           |
| **inbound-email** | Per-org inbound address → attachments in `files` + durable `email.received` event                                                                              |

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

### db-store bulk insert + retention (ticket 84)

For append-only collections (crawl snapshots, audit-like logs):

| Method | Path                             | Body                                           | Notes                                                                      |
| ------ | -------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------- |
| `POST` | `/collections/:name/insert-bulk` | `{ docs: [{ id?, data }] }`                    | **All-or-nothing** transaction; max **100** docs; 409 rolls back the batch |
| `POST` | `/collections/:name/retention`   | `{ ttlSeconds?, maxCount?, maxCountGroupBy? }` | Set per-org policy (201)                                                   |
| `POST` | `/collections/:name/retention`   | `{ get: true }` or `{}`                        | Read policy                                                                |
| `POST` | `/collections/:name/retention`   | `{ clear: true }`                              | Remove policy                                                              |
| `POST` | `/collections/:name/prune`       | `{}`                                           | Run TTL / `expiresAt` / maxCount prune for this org                        |
| `POST` | `/prune-all`                     | —                                              | Background-style sweep of every registered policy                          |

**Retention semantics**

- `ttlSeconds` — delete rows whose meta `createdAt` is older than now − ttl
- `data.expiresAt` (ISO string) — per-doc expiry, always honored on prune even without a collection policy
- `maxCount` — keep newest N by `createdAt` (optional `maxCountGroupBy` field, e.g. `targetId`)
- On-write: after `insert` / `insert-bulk`, maxCount prune runs automatically when a policy is set
- Background: db-store process ticks every `AGENT_OS_EXT_DB_STORE_PRUNE_INTERVAL_MS` (default 60s; `0` disables)

Policies live in platform collection `agentos_retention_policies` (doc id `${orgId}::${collection}`); org isolation still applies to the target collection rows.

**Patterns**

| Use case                                    | Approach                                                           |
| ------------------------------------------- | ------------------------------------------------------------------ |
| Append-only snapshots / logs                | `insertBulk` + `maxCount` / TTL (and optional `expiresAt`)         |
| Mutable domain docs (SKU, violation status) | single `insert` / `update`; **do not** attach retention            |
| “Latest” denorm on a parent                 | keep parent fields until history queries matter (ChannelGuard MVP) |

TS: `dbStore.collection(name, { orgId }).insertBulk / setRetention / prune`. Python: `insert_bulk` / `set_retention` / `prune`.

### Org retention + subject deletion (ticket 87)

Org-level defaults and **legal hold** live beside collection policies (ticket 84). Not full GDPR automation — focused, auditable delete for pilots.

| Method | Path               | Body                                                                  | Notes                                     |
| ------ | ------------------ | --------------------------------------------------------------------- | ----------------------------------------- |
| `POST` | `/org-retention`   | `{ defaultTtlSeconds?, legalHold, holdReason?, optedInCollections? }` | Set org config (201)                      |
| `POST` | `/org-retention`   | `{ get: true }` or `{}`                                               | Read config                               |
| `POST` | `/org-retention`   | `{ clear: true }`                                                     | Remove config                             |
| `POST` | `/subjects/delete` | `{ subjectId, mode?, collections?, fileKeys?, actor? }`               | Delete or anonymize matching docs + files |

**Org retention semantics**

- `legalHold: true` → **423** on subject delete and on explicit `/prune` for that org; background `/prune-all` skips held orgs; on-write maxCount prune is skipped (writes still succeed)
- `defaultTtlSeconds` applies only to collections listed in `optedInCollections` when those collections lack a ticket-84 `ttlSeconds`
- Collection policies still win when they set `ttlSeconds` / `maxCount`
- Platform doc: `agentos_org_retention` (id = `orgId`)

**Subject deletion**

- Caller declares matchers: `collections: [{ name, where, anonymizeFields? }]` using normal query `where`, plus optional explicit `fileKeys`
- `mode: "delete"` (default) removes matching docs; `mode: "anonymize"` merges listed fields to `"[redacted]"`
- Deletes file keys via builtin `files` `DELETE /blobs/:key` (best-effort per key)
- Appends audit entry `subject.delete` / `subject.anonymize` via builtin `audit` (`auditId` in response when reachable)

**Covered / not covered**

| Covered                                          | Not covered (document for contracts)                    |
| ------------------------------------------------ | ------------------------------------------------------- |
| Opted-in db-store collections for the active org | DB backups / PITR snapshots                             |
| Explicit file keys on the files builtin          | S3 versioning / soft-delete buckets                     |
| Audit log of the request                         | Auth user rows, vector-store embeddings (unless listed) |
| Legal hold gate                                  | Provider / ESP / CDN access logs                        |

TS: `dbStore.setOrgRetention / getOrgRetention / deleteSubject`. Python: `set_org_retention` / `get_org_retention` / `delete_subject`. Files: `deleteBlob` / `delete_blob`.

## Audit / Activity (ticket 97)

Builtin **`audit`** is the append-only **Activity** log (who did what). Product chrome label is **Activity**; extension id stays `audit`. It is **not** the **`events`** outbox / claim / dead-letter surface — keep those UIs separate.

`audit_entries` remains a **platform** db-store collection (`org_id = __platform__`). Soft tenancy stamps a top-level document **`orgId`** on append (session cookie or peer `X-AgentOS-Org-Id`). Session `GET /entries` filters `where: { orgId }` and requires permission **`audit.read`** (seeded on admin/owner/reviewer/sales). Peer header skips RBAC. Pre-97 rows without top-level `orgId` are not shown in the tenant Activity UI.

| Method | Path                     | Role                                                                                     |
| ------ | ------------------------ | ---------------------------------------------------------------------------------------- |
| `POST` | `/api/ext/audit/entries` | Append `{ action, actor?, resource?, meta? }`; stamps `orgId` + `at`                     |
| `GET`  | `/api/ext/audit/entries` | Query: `action`, `actor`, `resource`, `q`, `from`, `to`, `limit` (≤100), opaque `cursor` |
| `GET`  | `/api/ext/audit/health`  | `{ ok, backend: "db-store" }`                                                            |

**Pagination:** opaque `cursor` encodes a db-store scan **offset** (base64url). Response `{ entries, nextCursor? }` ordered by `at` desc. UI uses **Load more**. Free-text `q` and action prefix (`subject.*`) are applied in the audit API after structured db-store filters.

**Activity UI:** secondary Activity Bar → `ui/page.tsx` — filter/search, detail sheet (redacted `meta`), export JSON/CSV (cap 1000), optional auto-refresh (off by default). Deep-link: iframe `?action=` and/or host storage key `audit.activity.filters`.

TS: `appendEntry` / `listEntries` from `@agentos/core/api/audit` with `{ orgId }` or forwarded cookie. Python: `agentos.audit.append_entry` / `list_entries`.

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

## Files (blob API + Drive UI)

Builtin **`files`** is the platform object store. Activity Bar **secondary** (`Folder`) opens `ui/page.tsx` (+ `ui/sidebar.tsx`) — a Drive-style manager (browse, upload, download, preview, rename/move, delete, search). Tenants do **not** bring their own S3 credentials; the operator configures one shared backend via env. Isolation is **key prefix** `orgs/<orgId>/…`.

### Routes (`/api/ext/files`)

| Method   | Path                               | Notes                                                           |
| -------- | ---------------------------------- | --------------------------------------------------------------- |
| `GET`    | `/health`                          | Backend label; no auth                                          |
| `GET`    | `/blobs?prefix=&limit=&cursor=&q=` | List files + virtual folders; search by name when `q` set       |
| `PUT`    | `/blobs/:key`                      | Create/replace; JSON `{ base64, contentType? }` or octet-stream |
| `GET`    | `/blobs/:key`                      | Binary (stored content-type) or `?format=json`                  |
| `DELETE` | `/blobs/:key`                      | Idempotent single-object delete                                 |
| `DELETE` | `/blobs?prefix=`                   | Recursive folder-prefix delete                                  |
| `POST`   | `/blobs/move`                      | `{ from, to }` file or folder-prefix move                       |

Org context: session cookie `orgId` **or** peer header `X-AgentOS-Org-Id`. Session callers need RBAC `files.read` / `files.write` (seeded for admin/owner write; viewer/reviewer/sales read). Peer header path skips RBAC (trusted services). Max object size: **10 MiB** (aligned with AI attachments). Metadata (content-type, size, updatedAt) is indexed in db-store collection `files_objects`.

Clients: `@agentos/core/api/files` (`putBlob` / `getBlob` / `listBlobs` / `moveBlob` / …) and `agentos.files` — pass `orgId` for peer calls.

**Drive UI vs raw blob API:** the Activity Bar UI is for operators browsing org files. Extensions/services should keep using the raw blob client for attachments and ingest (same keys under `orgs/<orgId>/…`).

### Files storage env

Secrets stay in `createEnv` / runtime env — never `agentos.config.ts`. Default backend is **local filesystem** (`AGENT_OS_EXT_FILES_PATH` or OS temp `agentos-files`). When `AGENT_OS_EXT_FILES_S3_BUCKET` is set, the builtin uses Bun’s portable `S3Client` (works with **Cloudflare R2**, **AWS S3**, and **GCS** S3-compatible endpoints). Do **not** import Cloudflare R2 bindings into `@agentos/core` — ticket 62 only injects credentials into the container env.

| Variable                                   | Role                                                           |
| ------------------------------------------ | -------------------------------------------------------------- |
| `AGENT_OS_EXT_FILES_PATH`                  | Optional local root (ignored when S3 bucket is set)            |
| `AGENT_OS_EXT_FILES_S3_BUCKET`             | Enables S3-compatible backend                                  |
| `AGENT_OS_EXT_FILES_S3_ENDPOINT`           | Endpoint URL (required for R2 / GCS / MinIO; optional for AWS) |
| `AGENT_OS_EXT_FILES_S3_REGION`             | Region (`auto` for R2; e.g. `us-east-1` for AWS)               |
| `AGENT_OS_EXT_FILES_S3_ACCESS_KEY_ID`      | Access key (required when bucket is set)                       |
| `AGENT_OS_EXT_FILES_S3_SECRET_ACCESS_KEY`  | Secret key (required when bucket is set)                       |
| `AGENT_OS_EXT_FILES_S3_SESSION_TOKEN`      | Optional session token                                         |
| `AGENT_OS_EXT_FILES_DB_STORE_HOST`/`_PORT` | Peer db-store for metadata index (defaults `127.0.0.1:6111`)   |

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

## AI (structured + multimodal)

Builtin **`ai`** owns platform LLM calls via Vercel AI SDK v7 ([ADR 006](./adr/006-vercel-ai-sdk.md)). Clients: `@agentos/core/api/ai` / `agentos.ai`. Default models are **mocks** (`AGENT_OS_EXT_AI_MODEL` unset). Real providers stay env-gated; keep provider/region configurable and do **not** use customer documents for model training.

| Method | Path                         | Role                                                            |
| ------ | ---------------------------- | --------------------------------------------------------------- |
| `GET`  | `/api/ext/ai/health`         | `{ ok, mode }` — `mock` or `configured`                         |
| `POST` | `/api/ext/ai/generate-text`  | Text generate; optional **JSON Schema** + **file/image** inputs |
| `POST` | `/api/ext/ai/generate-image` | Image stub / provider generate                                  |
| `POST` | `/api/ext/ai/embed`          | Embedding vector                                                |
| `POST` | `/api/ext/ai/chat`           | Shell chat: composed instructions + tools                       |

### `POST /generate-text` body

| Field         | Role                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `prompt`      | Required user text (`message` / `text` aliases)                                                      |
| `schema`      | Optional **JSON Schema** object. When set, response is `{ object }` (validated); failures → **400**  |
| `files`       | Optional attachments: `{ mediaType, key? }` (files builtin) **or** `{ mediaType, base64? }` (inline) |
| `temperature` | Optional number                                                                                      |
| `maxTokens`   | Optional max output tokens                                                                           |

**Attachment limits:** max **8** files; **10 MB** each; **20 MB** total. Allowed MIME: `application/pdf`, `image/png`, `image/jpeg`, `image/webp`, `image/gif`. Keys resolve via gateway `GET /api/ext/files/blobs/:key?format=json`. Vision-capable providers are required for real image/PDF understanding; the mock path echoes prompt / marks `[files:N]` and fills schema stubs for tests.

Wire schemas are JSON Schema (language-neutral). Do not send Zod instances over HTTP — convert in-process if needed.

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

## Inbound email (per org)

Builtin **`inbound-email`** receives provider webhooks, maps the **To / recipient** address to an `orgId`, stores attachments in **`files`**, persists message metadata in org-scoped `inbound_messages`, and publishes durable topic **`email.received`** (via builtin `events`). VendorGate COI intake and similar flows subscribe / claim that event — they never talk to the ESP directly.

`meta.json` declares `public.openApiPrefixes: ["/webhooks/"]` so the gateway skips session/public-token gates; handlers verify the provider signature themselves (ticket 78).

| Method | Path                                | Role                                                          |
| ------ | ----------------------------------- | ------------------------------------------------------------- |
| `GET`  | `/api/ext/inbound-email/health`     | `{ ok, provider, backend }`                                   |
| `GET`  | `/api/ext/inbound-email/addresses`  | List address → org mappings (db + env)                        |
| `POST` | `/api/ext/inbound-email/addresses`  | Provision `{ address, orgId, purpose? }`                      |
| `POST` | `/api/ext/inbound-email/webhooks/*` | Provider webhook (`fixture`, `mailgun`, or generic `inbound`) |

**Address mapping:** prefer `POST /addresses`, or demo env `AGENT_OS_EXT_INBOUND_EMAIL_ADDRESS_MAP=coi@inbound.example.com=org_demo`. Directory rows live in platform collection `inbound_addresses`.

**`email.received` payload (stable):** `{ orgId, messageId, deliveryId, provider, from, to, subject, attachmentKeys, attachments, receivedAt }`.

| Variable                                         | Role                                         |
| ------------------------------------------------ | -------------------------------------------- |
| `AGENT_OS_EXT_INBOUND_EMAIL_PORT`                | Upstream port (default `6121`)               |
| `AGENT_OS_EXT_INBOUND_EMAIL_PROVIDER`            | `fixture` (default) or `mailgun`             |
| `AGENT_OS_EXT_INBOUND_EMAIL_WEBHOOK_SECRET`      | HMAC secret for fixture webhooks             |
| `AGENT_OS_EXT_INBOUND_EMAIL_MAILGUN_SIGNING_KEY` | Mailgun HTTP webhook signing key             |
| `AGENT_OS_EXT_INBOUND_EMAIL_ADDRESS_MAP`         | Demo `address=orgId` pairs (comma-separated) |

### Demo DNS / Mailgun setup

1. Create (or reuse) a subdomain for inbound, e.g. `inbound.example.com`.
2. In Mailgun: add the domain, set the MX records Mailgun shows in DNS.
3. Routes → **store and notify** / Inbound Parse → URL  
   `https://<app>/api/ext/inbound-email/webhooks/mailgun`.
4. Set `AGENT_OS_EXT_INBOUND_EMAIL_PROVIDER=mailgun` and the signing key env var.
5. Provision per-org locals: `coi@inbound.example.com` → that tenant’s `orgId`  
   (`POST /addresses` or `ADDRESS_MAP`).
6. Send a test message with a PDF; confirm a blob under `orgs/<orgId>/inbound/…` and an `email.received` outbox row.

**Local without Mailgun:** keep `PROVIDER=fixture`, set `WEBHOOK_SECRET`, and POST a signed JSON body to `/webhooks/fixture` (see builtin tests).
