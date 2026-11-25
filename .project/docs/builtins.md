# Built-in extensions

Shipped in `packages/core/builtins/`. Registry flags: `kind: "builtin"`, `driven: true`, `toggleable: false`.

## Driving (required)

| Id              | Role                                                                                                                                                                                                                                                                                                                                                | Tech                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **auth**        | Identity, sessions, **RBAC**, **organizations (tenancy)**; public gate at `/login` `/register` `/reset-password`; **account settings** registered into the Shell **Settings** area via `ui/settings.tsx` + `meta.settings` (**Profile** = profile / security / session, **Organization** = organization / roles) — no Activity Bar entry of its own | Better Auth (+ org tables on auth DB)                                  |
| **db-store**    | Sole SQL owner; **org-scoped** `documents` (`org_id` column + PK `(collection, org_id, id)`)                                                                                                                                                                                                                                                        | Drizzle (SQLite default; Postgres + RLS)                               |
| **cache-store** | Sole cache owner                                                                                                                                                                                                                                                                                                                                    | In-memory default; Redis when `AGENT_OS_EXT_CACHE_STORE_REDIS_URL` set |
| **ai**          | generateText/Image/embed (+ optional JSON Schema / file inputs), tools/skills/agents runtime                                                                                                                                                                                                                                                        | Vercel AI SDK v7 (mock default; [ADR 006](./adr/006-vercel-ai-sdk.md)) |

## Supporting (default-on)

| Id                | Role                                                                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **hitl**          | Approvals API (durable via db-store); Activity Bar **secondary** opens HITL panel in left sidebar (no `ui/`)                                                                                                         |
| **settings**      | Activity Bar **secondary** (`GearSix`) opens the full-screen Shell **Settings** host; it has no UI of its own — sections are **registered by extensions** (`ui/settings.tsx` + `meta.json` `settings[]`, ticket 101) |
| **events**        | Cross-extension pub/sub                                                                                                                                                                                              |
| **files**         | Blob/object API + Drive-style Activity Bar UI (local FS default; optional S3-compatible; org-scoped)                                                                                                                 |
| **notifications** | Toast/fan-out + email/SMS delivery; recent inbox + delivery status via db-store                                                                                                                                      |
| **secrets**       | Per-tenant credential vault (encrypted) + env fallback; Activity Bar **secondary** Secrets manager UI                                                                                                                |
| **audit**         | Append-only Activity log via db-store; Activity Bar **secondary** (`ListBullets`, chrome label **Activity**) opens `ui/page.tsx` — **not** the `events` outbox                                                       |
| **vector-store**  | Org-scoped embedding upsert / similarity query (pgvector; in-memory for local/tests)                                                                                                                                 |
| **inbound-email** | Email manager UI + per-org inbound address → attachments in `files` + `email.received` event                                                                                                                         |

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

**Per-org override (BYOK, ticket 105):** the env vars above are the **platform default**. An org admin can configure its own provider in **Settings → Email** (`email.send`: Resend `apiKey` + `from`, or Cloudflare `apiToken` + `from` + `accountId`) and **Settings → SMS** (`sms`: Twilio `authToken` + `accountSid` + `from`). Each email/SMS delivery resolves the org's integration per request (tenants kit, cache + `integration.changed`), falling back to the env providers when the org has none. Delivery records carry `source: "org" | "platform"` plus the provider id; the Email manager **Deliveries** detail shows **Sent via**. Settings routes live at `/api/ext/notifications/integrations/*`; **Test connection** sends a test email to the signed-in admin (email) or verifies Twilio credentials via the Account resource (SMS). Provider 401/403s surface as "credentials rejected" delivery errors.

**Cloudflare Email Sending** uses the public REST API (`POST /accounts/{account_id}/email/sending/send`) — no Workers binding inside the Bun builtin. Domain must be onboarded under Email Service; token needs **Email Sending Write**.

**API**

| Method | Path                                    | Role                                                                                                                                           |
| ------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/ext/notifications/notify`         | Enqueue: `channel` `in_app` \| `email` \| `sms` (default `in_app`); optional `templateId`, `vars`, `to`, `subject`, `message`, `type`, `orgId` |
| `GET`  | `/api/ext/notifications/recent`         | In-app inbox only (Shell toasts)                                                                                                               |
| `GET`  | `/api/ext/notifications/deliveries`     | Org-scoped deliveries (`?channel=email`, `limit`, `offset`) — Email manager Sent tab                                                           |
| `GET`  | `/api/ext/notifications/deliveries/:id` | Delivery status (`queued` \| `sent` \| `failed`); org-scoped when `orgId` is set                                                               |

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

| Method | Path                                    | Role                                                          |
| ------ | --------------------------------------- | ------------------------------------------------------------- |
| `GET`  | `/api/ext/auth/roles`                   | Role catalog + `role_permissions` rows                        |
| `GET`  | `/api/ext/auth/orgs/members`            | Members of the active org with roles                          |
| `POST` | `/api/ext/auth/orgs/members/roles`      | `{ userId, role }` — set org membership role                  |
| `POST` | `/api/ext/auth/orgs/members/remove`     | `{ userId }` — remove member; purges their user-owned secrets |
| `PUT`  | `/api/ext/auth/roles/:role/permissions` | `{ permissions: string[] }` — replace grants for a role       |

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

**Resolve order (GET by key):** vault decrypt for the active org → env fallback (`AGENT_OS_EXT_SECRETS_MAP` or `AGENT_OS_EXT_SECRETS_<KEY>`).

| Method   | Path                                   | Role                                                                                                              |
| -------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/ext/secrets`                     | List vault **metadata only** (`key`, `updatedAt`, `expiresAt`, `hasValue`) + `orgId` / `canWrite`; `secrets.read` |
| `GET`    | `/api/ext/secrets/:key`                | Vault (needs org) then env fallback; permission `secrets.read` when session cookie                                |
| `PUT`    | `/api/ext/secrets/:key`                | `{ value, expiresAt? }` — encrypt + upsert; `secrets.write` / peer org header                                     |
| `DELETE` | `/api/ext/secrets/:key`                | Remove vault row; `secrets.write` / peer org header                                                               |
| `POST`   | `/api/ext/secrets/users/:userId/purge` | Peer only: delete the user's user-owned secrets in the org; audit + `secrets.user_purged`                         |
| `GET`    | `/api/ext/secrets/health`              | `{ ok, vault, masterKey }`                                                                                        |

**List notes:** Env-fallback-only keys are **not** listed (v1). List never returns plaintext, ciphertext, or IVs. Key names must match `^[a-zA-Z][a-zA-Z0-9._/-]{0,127}$`.

**UI:** Secondary Activity Bar **Secrets** (`ui/page.tsx`, icon `Key`) — create / reveal (timeout remask) / rotate / delete for the active org. Writes require `secrets.write` and `AGENT_OS_EXT_SECRETS_MASTER_KEY`.

**Org context:** auth session cookie `orgId`, or peer header `X-AgentOS-Org-Id` (services / FDE). Session callers need RBAC; peer header is trusted (same pattern as db-store). Kit: `listSecrets` / `getSecret` / `putSecret` / `deleteSecret` from `@agentos/core/api/secrets` with `{ orgId }` or forwarded `cookie`.

**User-owned secrets (ticket 104):** add `?ownerUserId=<userId>` to `GET` / `PUT` / `DELETE /secrets/:key` to address a secret owned by one user inside the org (personal OAuth tokens such as Google Drive / OneDrive mounts).

- Session callers: allowed only when the session user **is** the owner. `secrets.read` / `secrets.write` (including admin/owner `*`) never grant access to another user's secret → **403**.
- Peer callers: must send `X-AgentOS-User-Id: <ownerUserId>` with `X-AgentOS-Org-Id`. Builtins/services forward the user of the **current request** only — never from background jobs.
- No env fallback for user-owned keys. `GET /secrets` **excludes** user-owned rows for everyone (including the owner); personal tokens are managed by the feature that created them.
- Storage: same collection + master key; db-store row id / `key` is namespaced `~u/<userId>/<key>` with `ownerUserId` on the row, so org-scoped lookups can never match a user row.
- Kit: `SecretsCallInit.ownerUserId` (TS) / `owner_user_id=` (Python). OAuth kit: `persistOAuthTokens({ scope: 'user', userId })` / `persist_oauth_tokens(scope="user", user_id=…)`.
- **Offboarding:** `POST /api/ext/auth/orgs/members/remove` deletes the membership, then calls `purgeUserSecrets` → secrets deletes that user's rows for the org, appends audit `secrets.user_purged` (`{ ownerUserId, count }`, no values), and publishes topic **`secrets.user_purged`** `{ orgId, userId, count, purgedAt }` (consumers such as files disconnect personal mounts). Purge is best-effort from auth (logged on failure); re-run with `purgeUserSecrets(userId, orgId)`.
- Audit: `secrets.put` / `secrets.delete` meta include `ownerUserId` when present; entries are stamped with the org.

**Threat model (v1)**

| Asset                        | Control                                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Vault ciphertext in db-store | AES-256-GCM; unique IV per write; master key never in documents                                                        |
| Master key                   | Process env only (`AGENT_OS_EXT_SECRETS_MASTER_KEY`); rotate by re-encrypt                                             |
| Cross-org read               | db-store `org_id` filter + secrets checks `orgId` on the row                                                           |
| User-owned secrets           | Owner-only (session user or peer `X-AgentOS-User-Id`); RBAC never grants; excluded from list; purged on member removal |
| Bootstrap / local demos      | Env map / per-key env still work without a master key (read-only)                                                      |
| Config misuse                | Never put customer tokens in `agentos.config.ts`                                                                       |

KMS (Cloudflare / AWS) can wrap the master key later; the vault API stays the same.

| Variable                                       | Role                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `AGENT_OS_EXT_SECRETS_MASTER_KEY`              | 32-byte AES key as **base64** (preferred) or **64-char hex**; required for PUT |
| `AGENT_OS_EXT_SECRETS_MAP`                     | Optional JSON object key→value (env fallback)                                  |
| `AGENT_OS_EXT_SECRETS_<KEY>`                   | Per-key env fallback (`api-token` → `AGENT_OS_EXT_SECRETS_API_TOKEN`)          |
| `AGENT_OS_EXT_SECRETS_DB_STORE_HOST` / `_PORT` | Peer db-store (defaults `127.0.0.1:6111`)                                      |
| `AGENT_OS_EXT_SECRETS_AUTH_API_BASE`           | Optional auth base for session / permission checks                             |

Generate a local master key: `openssl rand -base64 32`.

**Managed keys:** the `integrations/` prefix is reserved for the integrations kit (below). The list marks those rows `managed: true`; session callers get **403** on reveal / PUT / DELETE (the Secrets manager shows **Managed by Settings**). Only trusted peers (`X-AgentOS-Org-Id`) can read or write them.

## Tenant integrations (BYOK, ticket 103)

Each org can bring its own keys for tenant-scoped integrations. When an org has **no** integration record, the builtin **always** falls back to the platform env config (today's behavior). Providers are resolved **per request**.

**Platform-wide — deployment env only, never in the tenant vault:**

| Secret                                   | Builtin       | Why                                        |
| ---------------------------------------- | ------------- | ------------------------------------------ |
| `AGENT_OS_EXT_AUTH_SECRET`               | auth          | Signs sessions for every tenant            |
| `AGENT_OS_EXT_SECRETS_MASTER_KEY`        | secrets       | Encrypts the vault itself                  |
| `AGENT_OS_GLOBAL_PUBLIC_LINK_SECRET`     | core          | Signs public share tokens                  |
| `AGENT_OS_GLOBAL_OAUTH_STATE_SECRET`     | core          | Signs OAuth `state`                        |
| `AGENT_OS_EXT_DB_STORE_DATABASE_URL`     | db-store      | Shared DB, tenants split by `org_id`       |
| `AGENT_OS_EXT_VECTOR_STORE_DATABASE_URL` | vector-store  | Shared pgvector DB                         |
| `AGENT_OS_EXT_CACHE_STORE_REDIS_URL`     | cache-store   | Shared Redis                               |
| Shared inbound webhook secrets           | inbound-email | Verify the platform-default webhook routes |

**Tenant-scoped (BYOK with platform default):** email sending, SMS, email receiving (Resend), file storage mounts, AI provider (tickets 105–114).

**Storage model**

- Non-secret settings → org-scoped db-store collection **`integrations`**, doc id `<integration>:<instanceId>`:
  `{ id, integration, instanceId, provider, settings, secretRefs: { field → vaultKey }, secretUpdatedAt, createdAt, updatedAt, updatedBy }`.
- Secret values → **secrets vault** at `integrations/<integration>/<instanceId>/<field>`. Never in db-store docs, audit meta, events, logs, or responses.
- `integration` is a namespaced id (`email.send`, `email.receive`, `sms`, `ai`, `files.mount`). Single-instance integrations use instance `default`; multi-instance ones (file mounts) pass their own id.

**Kit** — `@agentos/core/api/integrations` (Python: `agentos.integrations`):

| TS                                                                         | Python                                               | Role                                                       |
| -------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| `createIntegrationsKit(createHttpIntegrationsBackend({ dbStoreApiBase }))` | `create_integrations_kit(HttpIntegrationsBackend())` | One kit per process (shares the cache)                     |
| `getIntegration(orgId, integration, instanceId?)`                          | `get_integration`                                    | Settings + decrypted secrets, or `null` → use platform env |
| `describeIntegration` / `listIntegrations`                                 | `describe_integration` / `list_integrations`         | Display-safe: secrets as `{ set: true, updatedAt }`        |
| `putIntegration(orgId, { integration, provider, settings, secrets })`      | `put_integration`                                    | Record + vault together; `null` secret removes a field     |
| `deleteIntegration(orgId, integration, instanceId?)`                       | `delete_integration`                                 | Removes record and every referenced vault key              |
| `resolveProvider(orgId, integration, buildFromConfig, buildFromEnv)`       | `resolve_provider`                                   | Per-request provider; `{ source: 'tenant' \| 'platform' }` |
| `handleChangedEvent(payload)` / `watchIntegrationChanges(kit)`             | `handle_changed_event`                               | Drop cache on `integration.changed` from other replicas    |

Omitted secret fields keep their stored value; switching **provider** drops secret fields that were not re-supplied.

**Cache:** in-process, default TTL **30s**. Record lookups are keyed by `orgId + integration + instance`; built providers by `… + updatedAt`. `put` / `delete` invalidate locally and publish **`integration.changed`** `{ orgId, integration, instanceId, action, updatedAt }` via builtin `events` (best-effort; TTL bounds staleness).

**Builtin routes:** builtins mount `handleIntegrationRoutes({ kit, definitions, resolveOrg, checkPermission }, request)` under their own API (`/api/ext/<builtin>/integrations/*`). `IntegrationDefinition` lists providers with their settings / secret fields, an optional `platformDefault()`, and an optional `test()` probe.

| Method   | Path                                     | Role                                                                             |
| -------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| `GET`    | `/integrations`                          | Definitions + platform default + instances (display-safe) + `canManage`          |
| `GET`    | `/integrations/:integration[/:instance]` | One integration                                                                  |
| `PUT`    | `/integrations/:integration[/:instance]` | `{ provider, settings, secrets }` — validated against the definition             |
| `DELETE` | `/integrations/:integration[/:instance]` | Remove record + secrets                                                          |
| `POST`   | `/integrations/:integration[/…]/test`    | Test saved config, platform default, or a draft body; secret values are redacted |

**RBAC:** writes and tests need **`integrations.manage`** (seeded on `admin` / `owner`). Other org members get a read-only view. Trusted peer header skips RBAC (same trust model as db-store / secrets).

**Audit:** `integration.put` / `integration.delete` / `integration.test` with provider and **field names** only.

**UI building blocks** (`@agentos/core/client/components/integration-card`): `IntegrationCard` (FieldSet-based section), `IntegrationSourceBadge` (**Using your key** / **Platform default**), `IntegrationProviderPicker`, `IntegrationSecretField` (write-only, set / not set, Replace), `IntegrationTestButton`, `IntegrationRemoveButton`. `@agentos/core/client/components/integration-section` exports `IntegrationSection` — a self-loading FieldSet section for one single-instance integration that a builtin drops into its `ui/settings.tsx`. Optional `renderSetting` swaps one setting's control (e.g. a model select) and `renderExtra` adds content under the fields; switching provider keeps only the settings the new provider declares.

## Files (blob API + Drive UI)

Builtin **`files`** is the platform object store. Activity Bar **secondary** (`Folder`) opens `ui/page.tsx` (+ `ui/sidebar.tsx`) — a Drive-style manager (browse, upload, download, preview, rename/move, copy across storage, delete, search). The operator configures one shared **platform** backend via env; isolation there is **key prefix** `orgs/<orgId>/…`.

### Mounts (ticket 110)

Files is a set of **mounted storages** per org. Each mount is `{ id, kind: 'org' | 'personal', ownerUserId?, provider, name, isDefault, status }`.

- **Platform mount** (`id: "platform"`) — always present, backed by the env store below, cannot be removed (rename is allowed). It is the default unless an admin flags another org mount.
- **Org mounts** — added by admins (RBAC `files.mounts.manage`; admin/owner via `*`), visible to everyone with `files.read`. Exactly one org mount is the **default** upload target (`mount=default`).
- **Personal mounts** (ticket 113) — visible only to `ownerUserId` (below); never the org default, never visible to admins.
- Records are **`files.mount` integration instances** (ticket 103 kit; doc id `files.mount:<mountId>`) behind the `FilesMountStore` interface (`api/lib/mount-store.ts`). Non-secret config (bucket, region, …) lives in the record's settings; fields a provider lists in `secretFields` go to the vault under `integrations/files.mount/<mountId>/<field>` and reach the adapter as `ctx.secrets`. The platform mount stores only a rename override.

**Adapters.** Every backend implements `StorageAdapter` (`api/lib/types.ts`; `BlobStore` is a deprecated alias) with `provider`, `label`, `indexMode`, and `capabilities`:

| Capability       | Effect                                                                |
| ---------------- | --------------------------------------------------------------------- |
| `serverSideCopy` | Same-mount copy/move uses `adapter.copy`; otherwise stream get → put  |
| `nativeFolders`  | Provider has real folders (UI still shows virtual folders otherwise)  |
| `nativeTrash`    | Delete goes to the provider trash (`trash` / `listTrash` / `restore`) |
| `versions`       | Provider keeps versions (reserved for later tickets)                  |
| `maxFileSize`    | Per-object upload limit (PUT/copy return **413** above it)            |
| `exportFormats`  | Native docs export targets (drives)                                   |
| `quota`          | Provider reports its own quota                                        |

**Index mode:** `indexed` (AgentOS is the only writer; `files_objects` is the record — platform, buckets, upload services) or `live` (provider is the record; listings are fetched live with a 15 s cache invalidated on writes — drives). New providers register into `storageProviders` (`api/lib/storage-providers.ts`) and may declare `fields` / `presets` that the Settings **Add storage** dialog renders generically. `filesystem` is platform-only; `s3` is org-addable (below).

**References.** Canonical form is **`files://<mountId>/<path>`** (path is mount-relative; for platform it is relative to `orgs/<orgId>/`). Helpers: `@agentos/core/api/files-ref` (`formatFileRef`, `parseFileRef`, `toFileRef`) and `agentos.files` (`format_file_ref`, `parse_file_ref`, `to_file_ref`). Legacy keys (`orgs/<orgId>/…` or relative paths with no `mount`) always resolve to the platform mount; index records missing `mountId` are backfilled to `"platform"` on read. Inbound-email attachments store `ref` (event payload adds `attachmentRefs` beside `attachmentKeys`); the `ai` builtin accepts `{ ref }` attachments.

**Safety.** `DELETE /mounts/:id` returns **409** `{ references, files, records }` while the mount still holds objects (Bin items included) or other records reference it. Changing a mount's location config (bucket / endpoint / prefix) while it holds files is **409** — add a new mount instead; credential changes are allowed.

### S3-compatible org mounts (ticket 111)

Admins add their own buckets — any number per org — as `files.mount` / provider `s3`. Settings (non-secret): `preset`, `bucket`, `region`, `endpoint`, `accountId` (R2), `projectRef` (Supabase), optional `prefix` (mount a sub-path). Secrets (vault): `accessKeyId`, `secretAccessKey`, optional `sessionToken`.

| Preset (`preset`) | Endpoint                                         | Region / notes                         |
| ----------------- | ------------------------------------------------ | -------------------------------------- |
| `aws`             | Optional (Bun default)                           | Required; virtual-hosted style         |
| `r2`              | `https://<accountId>.r2.cloudflarestorage.com`   | `auto`                                 |
| `gcs`             | `https://storage.googleapis.com`                 | `auto`; HMAC keys                      |
| `b2`              | `https://s3.<region>.backblazeb2.com`            | Required (e.g. `us-west-004`)          |
| `wasabi`          | `https://s3.<region>.wasabisys.com`              | Default `us-east-1`                    |
| `do-spaces`       | `https://<region>.digitaloceanspaces.com`        | Required (e.g. `nyc3`); virtual-hosted |
| `minio`           | Custom (required; `http` allowed only here)      | Default `us-east-1`; path-style        |
| `supabase`        | `https://<projectRef>.supabase.co/storage/v1/s3` | Required (project region)              |

**Test connection** (`POST /mounts/test` with a draft body, or `POST /mounts/:id/test`) lists the mount prefix, then writes and deletes a `.agentos-probe-<uuid>` object. Failures name the cause: unknown access key, wrong secret, missing bucket, wrong region, or the missing permission (`s3:ListBucket` / `s3:PutObject` / `s3:DeleteObject`). `POST /mounts` runs the same test and refuses to save a failing mount.

Bucket mounts are `indexed`. Copy/move **within a mount** uses a SigV4-signed `CopyObject` (path-style; `api/lib/s3-sign.ts`, since `Bun.S3Client` has no copy) and falls back to download + upload when the provider answers `NotImplemented`. Location settings (`preset`, `bucket`, `endpoint`, `region`, `accountId`, `projectRef`, `prefix`) are frozen while the mount holds files; keys can be rotated via `PATCH /mounts/:id { secrets }`.

### Upload-service org mounts (ticket 112)

| Provider      | Settings                                                         | Secret (vault)                | Notes                                                                                                                                                                                                                                                                                                                                                             |
| ------------- | ---------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uploadthing` | `appId` (required; must match the token), `prefix`               | `token` (`UPLOADTHING_TOKEN`) | Flat storage via the official `uploadthing/server` SDK. The AgentOS path is the file name, folders are virtual (derived from names), and files carry `customId: agentos_<uuid>`. No server-side copy; **move within the mount renames in place** (`renameFiles`, same file key). Overwrite = upload new + delete old. Paths resolve through a 10 s listing cache. |
| `vercel-blob` | `access` (`public` \| `private`), `storeId` (optional), `prefix` | `readWriteToken`              | REST API `https://vercel.com/api/blob` (API version 13). Path-like pathnames, folded `list`, server-side `copy`, reads from `<storeId>.<access>.blob.vercel-storage.com`. Writes set `x-cache-control-max-age: 60`, so a public overwrite may be served stale for up to 60 s.                                                                                     |

Both run as `indexed` mounts, cap uploads at the platform 10 MiB limit, and test the connection by uploading, listing, and deleting a probe file. Errors are mapped (`token was rejected`, `store does not exist`, `token belongs to app/store …`). Adapters may implement optional `move(from, to)` for same-mount renames, and `put` receives `{ contentType }`.

### Personal mounts + Google Drive (ticket 113)

Every member can connect **their own** drive in **Settings › Files › My connected drives**. The mount record (`kind: 'personal'`, `ownerUserId`, `config: { accountId, email }`) is a `files.mount` instance; its OAuth tokens are a **user-owned secret** (ticket 104, key `files/mounts/<mountId>/oauth`) that only the owner — or a peer acting for them — can read.

- **Visibility.** Listed, browsed, and managed only by the owner's session (`/mounts/:id` test / rename / disconnect need no `files.mounts.manage`). Admins, other members, and background callers (peer header without a user) get **404**. A trusted peer that sends `X-AgentOS-User-Id: <owner>` (an AI run acting for that user) may **read** but every write is **403**. Inbound email and jobs never send a user.
- **Member removal.** The files service follows `secrets.user_purged` over the events stream and deletes the removed user's personal mount records (their tokens were already purged).
- **Copy to org storage.** The browser offers **Copy to org storage** on personal files (targets: org mounts). Bytes are copied — Google Docs are exported — so no org record ever points at a personal file (live mounts are not indexed).

**Connect flow** — `POST /personal-mounts/google-drive/connect { mountId?, returnTo? }` (session only) returns `{ url }`; the UI opens it in the Shell tab via `navigation.openExternal(url, { sameTab: true })`. Google redirects to `GET /personal-mounts/google-drive/callback`, which verifies the signed state (bound to the org **and** the starting user; PKCE), exchanges the code, identifies the account, saves tokens, and creates or reconnects the mount, then redirects to `returnTo` (default `/`) with `?files_drive=connected|error&files_drive_message=…`. Reconnecting (`mountId`) must use the same Google account. Disconnect revokes the token at Google and deletes tokens + record.

**Token lifecycle.** Access tokens refresh 60 s before expiry and on any 401; a refresh failure (`invalid_grant`: revoked, password reset, testing-mode 7-day expiry) marks the mount `disconnected` with a reconnect message, and Drive calls answer **409** `{ code: 'reconnect_required' }`. The sidebar shows **Reconnect** and the browser a reconnect banner.

**Google Drive adapter** (`google-drive`, `live`):

- Top-level folders **My Drive** and **Shared drives** (`Shared drives/<drive>/…`). Paths map to file ids with a 30 s cache.
- **Duplicate names** in one folder (and names containing `/`) list as `name [<fileId>].ext` and are addressed by id; the bare name answers **409** when ambiguous.
- **Google Docs / Sheets / Slides / Drawings** list with `contentType`, `webUrl` (**Open in Google**), and `exportFormats`. Download / copy exports DOCX / XLSX / PPTX / PDF by default (`GET /blobs/:key?export=pdf` picks another format); the exported name gains the extension. Google caps exports at 10 MB.
- Uploads use resumable sessions (create, or a new **revision** of an existing file); folders are created on demand. Copy and move are server-side (`files.copy`, parent/name patch). Delete goes to **Drive trash**; Bin lists and restores it. Quota (`about.storageQuota`) shows in Settings; the cross-mount **Storage** view skips live drives instead of crawling them.
- Rate limits (`429`, `403 rateLimitExceeded` / `userRateLimitExceeded`) and `5xx` back off exponentially (honoring `Retry-After`, up to 4 retries).

**Platform Google OAuth app** (one per deployment; env, not vault):

1. Google Cloud console → enable the **Google Drive API**.
2. OAuth consent screen: app name, support email, authorized domain of `AGENT_OS_GLOBAL_APP_ORIGIN`; add scope `https://www.googleapis.com/auth/drive`.
3. Credentials → **OAuth client ID** (Web application) with redirect URI `<AGENT_OS_GLOBAL_APP_ORIGIN>/api/ext/files/personal-mounts/google-drive/callback`.
4. Set `AGENT_OS_EXT_FILES_GOOGLE_CLIENT_ID` and `AGENT_OS_EXT_FILES_GOOGLE_CLIENT_SECRET` (Worker secret). Without them the Connect button is disabled ("not configured on this deployment").

**Scope trade-off.** AgentOS requests full `drive` because users browse files they created elsewhere; `drive.file` only exposes files the app created or a Google Picker opened, which cannot back a browse-anything mount. `drive` is a **restricted** scope: until Google verifies the app (OAuth verification plus an annual third-party security assessment), the consent screen warns users, only listed test users (≤100) can connect, and testing-mode refresh tokens expire after 7 days (users see Reconnect). Apps marked **Internal** in a Google Workspace org skip verification for that org's users. Per-org OAuth apps are ticket 118.

### OneDrive + SharePoint personal mounts (ticket 114)

Provider `onedrive` connects a **Microsoft account** (work/school or personal) through Microsoft Graph with the same personal-mount flow, visibility, token lifecycle, and **Copy to org storage** as Google Drive. The account id is the Graph user `id`; reconnects must use the same account.

- **Layout.** `OneDrive/…` is the user's own drive; `SharePoint/<site>/<library>/…` lists the document libraries of every site the user **follows** (`/me/followedSites`). Site and library names that collide get a suffix (`Marketing (marketing-emea)`). Shortcuts to items shared with the user and OneNote notebooks are not listed.
- **Addressing.** Paths resolve with Graph path addressing (`/drives/<id>/root:/a/b`) and are cached as item ids for 30 s. OneDrive names are unique per folder (case-insensitive), so no duplicate-name scheme is needed. Listing pages use Graph `@odata.nextLink` cursors, and only `https://graph.microsoft.com/v1.0/…` cursors are accepted (the bearer token is sent to them).
- **Uploads.** Up to 4 MiB uses a simple `PUT …/content`; larger files use an **upload session** in 3.125 MiB chunks (multiples of 320 KiB) sent to the pre-authenticated session URL **without** the bearer token. Writes use `conflictBehavior=replace`, so an overwrite becomes a new **version** of the same item. Downloads follow Graph's redirect to a pre-authenticated URL, also without the token. The adapter accepts Graph's 250 GB limit, but the platform request cap (`MAX_OBJECT_BYTES`, 10 MiB) still applies until uploads are streamed end to end.
- **Copy / move.** Copies are server-side (`POST …/copy`, with the async monitor URL polled until `completed`), including between OneDrive and SharePoint libraries. Moves within one drive are a `PATCH` of parent and name; across drives they copy and then delete the source.
- **Delete.** Deletes go to the **Microsoft recycle bin** and the toast says so. Graph v1.0 cannot list the OneDrive for Business / SharePoint recycle bin, so the AgentOS Bin shows nothing for this mount. Restore (`POST …/restore`) works where Graph supports it (OneDrive personal accounts); otherwise users restore in Microsoft 365.
- **Quota.** From `/me/drive` `quota` (the user's OneDrive; SharePoint libraries count against site quota).
- **Throttling.** `429` / `503` / `509` / `5xx` back off, honoring `Retry-After`. `423` (file locked or checked out) and `507` (storage full) map to readable errors.
- **Disconnect.** Deletes tokens and the record. Microsoft has no per-app refresh-token revocation; users remove the app at [myapps.microsoft.com](https://myapps.microsoft.com) or [account.live.com/consent/Manage](https://account.live.com/consent/Manage).

**Platform Microsoft Entra app** (one per deployment):

1. Entra admin center → **App registrations** → New registration. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts** (for tenant `common`).
2. Redirect URI (platform **Web**): `<AGENT_OS_GLOBAL_APP_ORIGIN>/api/ext/files/personal-mounts/onedrive/callback`.
3. **API permissions** → Microsoft Graph → _Delegated_: `offline_access`, `User.Read`, `Files.ReadWrite.All`, `Sites.Read.All`. None needs admin consent by default, but tenants that restrict user consent must grant it (or approve an admin-consent request). `Files.ReadWrite.All` (rather than `Files.ReadWrite`) is required to write to SharePoint libraries, and `Sites.Read.All` to list followed sites.
4. **Certificates & secrets** → new client secret. Secrets expire (at most 24 months), so rotate before expiry.
5. Set `AGENT_OS_EXT_FILES_MICROSOFT_CLIENT_ID`, `AGENT_OS_EXT_FILES_MICROSOFT_CLIENT_SECRET` (Worker secret), and optionally `AGENT_OS_EXT_FILES_MICROSOFT_TENANT` (default `common`; set a tenant id to allow only one directory). Multi-tenant apps should complete **publisher verification** so consent screens show a verified publisher.

### Routes (`/api/ext/files`)

Blob routes take `?mount=<id>` (or `mount=default`); a `files://` ref in the path overrides it. Without either, the platform mount is used.

| Method   | Path                                      | Notes                                                                                         |
| -------- | ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET`    | `/health`                                 | Backend label, provider, mounts count; no auth                                                |
| `GET`    | `/blobs?prefix=&limit=&cursor=&q=&mount=` | List files + virtual folders; `view=bin\|storage` spans all visible mounts                    |
| `PUT`    | `/blobs/:key`                             | Create/replace; JSON `{ base64, contentType? }` or octet-stream; returns `ref`                |
| `GET`    | `/blobs/:key`                             | Binary (stored content-type) or `?format=json` (includes `ref`, `mountId`, `name`); `export=` |
| `DELETE` | `/blobs/:key`                             | Soft-delete to Bin (native trash when the mount supports it)                                  |
| `DELETE` | `/blobs?prefix=`                          | Recursive folder-prefix delete                                                                |
| `POST`   | `/blobs/move`                             | `{ from, to, mount?, fromMount?, toMount? }` — cross-mount streams                            |
| `POST`   | `/blobs/copy`                             | Same body as move; keeps the source                                                           |
| `POST`   | `/blobs/restore`                          | `{ key, mountId? }` restore from Bin                                                          |
| `GET`    | `/mounts?usage=1`                         | Visible mounts + capabilities, default id, providers, `canManage`                             |
| `POST`   | `/mounts`                                 | `{ provider, name, config, secrets?, isDefault? }` — connection-tested; `files.mounts.manage` |
| `POST`   | `/mounts/:id/test`                        | Re-test; updates `status`                                                                     |
| `POST`   | `/mounts/test`                            | Draft test (same body as `POST /mounts`); `{ ok, error? }`, nothing saved                     |
| `PATCH`  | `/mounts/:id`                             | `{ name?, isDefault?, config?, secrets? }` (rotation ok)                                      |
| `DELETE` | `/mounts/:id`                             | Guarded by reference count (409); personal mounts: owner disconnect                           |
| `POST`   | `/personal-mounts/:provider/connect`      | `{ mountId?, returnTo? }` → `{ url }` (session user only)                                     |
| `GET`    | `/personal-mounts/:provider/callback`     | OAuth redirect target; 302 back with `files_drive=connected\|error`                           |

Org context: session cookie `orgId` **or** peer header `X-AgentOS-Org-Id`. Session callers need RBAC `files.read` / `files.write` (seeded for admin/owner write; viewer/reviewer/sales read). Peer header path skips RBAC (trusted services) but may only write to org mounts. Max object size: **10 MiB** or the mount's `maxFileSize`, whichever is lower. Metadata (content-type, size, updatedAt, `mountId`) is indexed in db-store collection `files_objects`.

Clients: `@agentos/core/api/files` (`putBlob` / `getBlob` / `listBlobs` / `moveBlob` / `copyBlob` / `listMounts` / …, all accepting `mountId`) and `agentos.files` (`mount_id=` kwargs, `copy_blob`, `list_mounts`) — pass `orgId` for peer calls.

**UI.** Sidebar lists **Mounted storage** (provider icon, name, Error/Disconnected badge), then **Bin** and **Storage** views across mounts. The breadcrumb root is the selected mount (persisted in host storage as `files:mount`). **Settings › Files** shows **Storage backends** (status, default badge, usage; test / set default / rename / disconnect), **My connected drives** (connect / reconnect / test / disconnect, quota; personal drives carry a lock marker in the sidebar), and Bin retention.

**Drive UI vs raw blob API:** the Activity Bar UI is for operators browsing org files. Extensions/services should keep using the raw blob client for attachments and ingest, storing the returned `ref`.

### Files storage env

Secrets stay in `createEnv` / runtime env — never `agentos.config.ts`. Default backend is **local filesystem** (`AGENT_OS_EXT_FILES_PATH` or OS temp `agentos-files`). When `AGENT_OS_EXT_FILES_S3_BUCKET` is set, the builtin uses Bun’s portable `S3Client` (works with **Cloudflare R2**, **AWS S3**, and **GCS** S3-compatible endpoints). Do **not** import Cloudflare R2 bindings into `@agentos/core` — ticket 62 only injects credentials into the container env.

| Variable                                     | Role                                                           |
| -------------------------------------------- | -------------------------------------------------------------- |
| `AGENT_OS_EXT_FILES_PATH`                    | Optional local root (ignored when S3 bucket is set)            |
| `AGENT_OS_EXT_FILES_S3_BUCKET`               | Enables S3-compatible backend                                  |
| `AGENT_OS_EXT_FILES_S3_ENDPOINT`             | Endpoint URL (required for R2 / GCS / MinIO; optional for AWS) |
| `AGENT_OS_EXT_FILES_S3_REGION`               | Region (`auto` for R2; e.g. `us-east-1` for AWS)               |
| `AGENT_OS_EXT_FILES_S3_ACCESS_KEY_ID`        | Access key (required when bucket is set)                       |
| `AGENT_OS_EXT_FILES_S3_SECRET_ACCESS_KEY`    | Secret key (required when bucket is set)                       |
| `AGENT_OS_EXT_FILES_S3_SESSION_TOKEN`        | Optional session token                                         |
| `AGENT_OS_EXT_FILES_DB_STORE_HOST`/`_PORT`   | Peer db-store for metadata index (defaults `127.0.0.1:6111`)   |
| `AGENT_OS_EXT_FILES_GOOGLE_CLIENT_ID`        | Platform Google OAuth app for personal Drive mounts (optional) |
| `AGENT_OS_EXT_FILES_GOOGLE_CLIENT_SECRET`    | Its client secret                                              |
| `AGENT_OS_EXT_FILES_MICROSOFT_CLIENT_ID`     | Platform Entra app for personal OneDrive / SharePoint mounts   |
| `AGENT_OS_EXT_FILES_MICROSOFT_CLIENT_SECRET` | Its client secret                                              |
| `AGENT_OS_EXT_FILES_MICROSOFT_TENANT`        | Entra tenant (default `common`)                                |

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

Builtin **`ai`** owns platform LLM calls via Vercel AI SDK v7 ([ADR 006](./adr/006-vercel-ai-sdk.md)). Clients: `@agentos/core/api/ai` / `agentos.ai`. Default models are **mocks** (`AGENT_OS_EXT_AI_PROVIDER` unset). Real providers are env-gated (table below) and built with the AI SDK provider packages (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, and the AI SDK gateway from `ai`).

| Method | Path                         | Role                                                                         |
| ------ | ---------------------------- | ---------------------------------------------------------------------------- |
| `GET`  | `/api/ext/ai/health`         | `{ ok, mode }` (`mock`); configured adds `provider`, `model`, `capabilities` |
| `POST` | `/api/ext/ai/generate-text`  | Text generate; optional **JSON Schema** + **file/image** inputs              |
| `POST` | `/api/ext/ai/generate-image` | Image stub / provider generate                                               |
| `POST` | `/api/ext/ai/embed`          | Embedding vector                                                             |
| `POST` | `/api/ext/ai/chat`           | Shell chat: composed instructions + tools                                    |

Generate / embed / image / chat responses carry **`X-AgentOS-AI-Source: org | platform`** (whose key paid for the call). `/health` always describes the **platform** config.

### AI env

| Variable                              | Role                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `AGENT_OS_EXT_AI_PROVIDER`            | `openai`, `anthropic`, `google`, `ai-gateway` (Vercel AI Gateway — one key, many models), or `mock`. **Unset → mocks** |
| `AGENT_OS_EXT_AI_API_KEY`             | Provider API key (required when a provider is set). Secret — `wrangler secret put` / runtime env only                  |
| `AGENT_OS_EXT_AI_MODEL`               | Language model id (required when a provider is set), e.g. `gpt-4.1-mini`, `claude-sonnet-4-5`, `openai/gpt-4.1-mini`   |
| `AGENT_OS_EXT_AI_EMBEDDING_MODEL`     | Optional embedding model (`openai` / `google` / `ai-gateway`). Unset → `POST /embed` returns **501**                   |
| `AGENT_OS_EXT_AI_IMAGE_MODEL`         | Optional image model (`openai` / `google` / `ai-gateway`). Unset → `POST /generate-image` returns **501**              |
| `AGENT_OS_EXT_AI_BASE_URL`            | Optional provider base URL — regional / proxy endpoints (e.g. `https://eu.api.openai.com/v1` for OpenAI EU residency)  |
| `AGENT_OS_EXT_AI_ZERO_DATA_RETENTION` | `ai-gateway` only: `true` routes only to providers with zero-data-retention agreements                                 |
| `AGENT_OS_EXT_AI_GATEWAY_URL`         | AgentOS gateway origin for registry + tool HTTP (not the Vercel AI Gateway)                                            |
| `AGENT_OS_EXT_AI_PORT`                | Upstream port (default `6113`)                                                                                         |

`AGENT_OS_EXT_AI_MODEL` without `AGENT_OS_EXT_AI_PROVIDER` keeps mocks (a warning is logged). A provider that lacks a capability (Anthropic has no embedding or image models) is rejected at boot if you configure one, and the endpoint answers **501** `ai_capability_unsupported` — configured mode never falls back to mocks.

**Errors:** provider 401/403 → **502** `{ code: "ai_provider_auth" }`; 429 → **503** `ai_provider_rate_limited`; other upstream failures → **502** `ai_provider_error`. Bodies never include the API key.

**Per-request structure:** `createAiModels(config)` is a pure function of `{ provider, apiKey, model, embeddingModel?, imageModel?, baseUrl? }`; `getCachedAiModels(config)` memoizes by a SHA-256 config hash (bounded LRU) so per-org configs (ticket 109) reuse built models.

### AI BYOK (per-org provider, ticket 109)

Each request resolves the org (session cookie → active org, else peer `X-AgentOS-Org-Id`) and calls `kit.resolveProvider(orgId, 'ai', …)` ([tenant integrations](#tenant-integrations-byok-ticket-103)). An org with an **`ai`** integration uses **its** provider, key, and models; every other org (and anonymous calls) uses the platform env config above. A saved-but-broken org config (e.g. revoked key) returns the provider error — it never silently falls back to the platform key.

| Integration field | Kind    | Notes                                                  |
| ----------------- | ------- | ------------------------------------------------------ |
| provider          | record  | `openai`, `anthropic`, `google`, `ai-gateway`          |
| `apiKey`          | secret  | Vault `integrations/ai/default/apiKey`; never returned |
| `model`           | setting | Required chat model id                                 |
| `embeddingModel`  | setting | Optional; not offered for `anthropic`                  |
| `imageModel`      | setting | Optional; not offered for `anthropic`                  |
| `baseUrl`         | setting | Optional regional / proxy endpoint (absolute URL)      |

Routes (on top of the shared [`/integrations/*` routes](#tenant-integrations-byok-ticket-103)):

| Method | Path                                           | Role                                                                                                                                                                                                           |
| ------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/ext/ai/integrations/ai/models`           | `{ provider, apiKey?, baseUrl? }` → `{ models: { language, embedding, image } }`; needs `integrations.manage`. Without `apiKey` uses the saved org key for the same provider; the AI Gateway catalog is public |
| `GET`  | `/api/ext/ai/integrations/ai/embedding-status` | `{ current, platform, vectors, locked }` — the org's embedding model identity and stored vector count                                                                                                          |

`PUT` validates the draft with the provider factory (unknown provider, capability mismatch, bad base URL → **400**). `POST …/test` runs a short completion (`Reply with the single word OK.`) on the draft, saved, or platform config.

**Embedding consistency:** vectors from different embedding models are not comparable, so the embedding identity (`<provider>:<embeddingModel>`) is locked while the org has stored vectors (vector-store `GET /stats`). A `PUT` or `DELETE` that would change it answers **409** `{ code: "ai_embedding_model_locked", vectors, current, next }`; delete or re-embed the vectors first. Changes that keep the identity (chat model, key rotation) or drop embeddings entirely are allowed. If the vector count cannot be read the change is refused with **503** `ai_embedding_check_failed`.

**Rotation:** saves/removals invalidate the kit cache in-process and publish `integration.changed` (other replicas drop their cache; TTL 30s bounds staleness). Built models are keyed by config hash, so a new key or model takes effect on the next request without a restart.

**Usage attribution:** every real-provider call appends an **`ai.usage`** audit entry to the org's Activity log: `resource` = operation (`generate-text` / `generate-image` / `embed` / `chat`), `meta` = `{ source: 'org' | 'platform', provider, model, inputTokens?, outputTokens? }`. Mock calls and calls without an org are not recorded. Recording is best-effort and never fails the AI call.

**Settings › AI** (`builtins/ai/ui/settings.tsx`) uses the shared `IntegrationSection`: provider picker, model selects filled from the provider's model list (**Load models**, automatic with a saved key or for the AI Gateway; **Other model id…** for unlisted ids), write-only key, source badge, Test, Remove, and an embedding-lock warning.

**Data policy:** customer documents are never used for training. Where the provider exposes a per-request switch the builtin sets it: OpenAI Responses `store: false` (no 30-day response storage); AI Gateway `disallowPromptTraining: true` (+ `zeroDataRetention` when enabled). OpenAI and Anthropic do not train on API traffic by default; use a **paid** Gemini API tier for Google (free-tier prompts may be used to improve Google products). Configure org-level zero-retention agreements with the provider where required.

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
| `GET`  | `/api/ext/vector-store/stats`                | `{ vectors }` — the org's stored vectors across every index (kit `stats` / `stats()`)     |

**Org context:** auth session cookie `orgId`, or peer header `X-AgentOS-Org-Id` (services / FDE). Rows are keyed by `(index_name, org_id, id)`.

| Variable                                 | Role                                                                |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `AGENT_OS_EXT_VECTOR_STORE_PORT`         | Upstream port (default `6120`)                                      |
| `AGENT_OS_EXT_VECTOR_STORE_MODE`         | `auto` (default), `memory`, or `pgvector`                           |
| `AGENT_OS_EXT_VECTOR_STORE_DATABASE_URL` | `postgres://…` for production RAG (requires **pgvector** extension) |
| `AGENT_OS_EXT_VECTOR_STORE_DIMENSIONS`   | Embedding length (default `1536`); must match `ai.embed` output     |

**Postgres required for RAG:** set `DATABASE_URL` + install pgvector. Without a Postgres URL, `auto` falls back to an **in-memory** cosine index (fine for local/tests; not durable / not multi-replica). Non-Postgres URLs and missing pgvector return **501** with a clear error. Kit: `@agentos/core/api/vector-store` / `agentos.vector_store`.

## Email manager (send + receive)

Activity Bar secondary **Email** (builtin `inbound-email` UI) is the operator surface for:

| Direction                       | Builtin         | Providers                                                                                                        |
| ------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Receive** (Inbox / Addresses) | `inbound-email` | `fixture` (local), `resend` (platform default + per-org BYOK), or `cloudflare` (Email Routing, platform default) |
| **Send** (Compose / Deliveries) | `notifications` | `log` (local), `resend`, or `cloudflare` (Email Sending REST)                                                    |

RBAC: `email.read` (inbox, addresses list, deliveries), `email.send` (compose + address provision). Admin/owner covered by `*`.

HTML bodies render in a sandboxed iframe (`srcdoc`); plain text is the default view. Attachments download via files blob keys (no re-upload).

**Local verify:** fixture webhook → Inbox; Compose with `AGENT_OS_EXT_NOTIFICATIONS_EMAIL_PROVIDER=log` → delivery `sent`. Staging send: Cloudflare Email Sending env on notifications; staging receive: Resend receiving (below).

## Inbound email (per org)

Builtin **`inbound-email`** receives provider webhooks, maps the **To / recipient** address to an `orgId`, stores attachments in **`files`**, persists message metadata in org-scoped `inbound_messages`, and publishes durable topic **`email.received`** (via builtin `events`). VendorGate COI intake and similar flows subscribe / claim that event — they never talk to the ESP directly.

`meta.json` declares `public.openApiPrefixes: ["/webhooks/"]` so the gateway skips session/public-token gates; handlers verify the provider signature themselves (ticket 78). Secondary Activity Bar **Email** opens `ui/page.tsx` (ticket 99).

| Method  | Path                                                     | Role                                                        |
| ------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| `GET`   | `/api/ext/inbound-email/health`                          | `{ ok, provider, backend }`                                 |
| `GET`   | `/api/ext/inbound-email/addresses`                       | List addresses for active org                               |
| `POST`  | `/api/ext/inbound-email/addresses`                       | Provision `{ address, purpose? }` bound to active org       |
| `GET`   | `/api/ext/inbound-email/messages`                        | Org inbox (`limit`/`offset`/`from`/`to`/`q`)                |
| `GET`   | `/api/ext/inbound-email/messages/:id`                    | Message detail                                              |
| `PATCH` | `/api/ext/inbound-email/messages/:id`                    | `{ read: true }` → sets `readAt`                            |
| `POST`  | `/api/ext/inbound-email/webhooks/inbound`                | Platform default provider (whatever `PROVIDER` is)          |
| `POST`  | `/api/ext/inbound-email/webhooks/fixture`                | Fixture provider (HMAC JSON; local/tests)                   |
| `POST`  | `/api/ext/inbound-email/webhooks/resend`                 | Platform Resend account; org from recipient address mapping |
| `POST`  | `/api/ext/inbound-email/webhooks/cloudflare`             | Raw MIME from the Cloudflare Email Worker (signed envelope) |
| `POST`  | `/api/ext/inbound-email/webhooks/resend/:connectionId`   | Org's own Resend account (BYOK); org from the connection id |
| `*`     | `/api/ext/inbound-email/integrations/email.receive[...]` | Receiving integration (`integrations.manage`; ticket 103)   |

**Address mapping:** prefer `POST /addresses`, or demo env `AGENT_OS_EXT_INBOUND_EMAIL_ADDRESS_MAP=coi@inbound.example.com=org_demo`. Directory rows live in platform collection `inbound_addresses`. BYOK deliveries skip the directory: everything a connected Resend account receives belongs to that org.

**`email.received` payload (stable):** `{ orgId, messageId, deliveryId, provider, from, to, subject, attachmentKeys, attachmentRefs, attachments, receivedAt, authentication? }`. `authentication` (`{ spf, dkim, dmarc }` verdicts) is set when the receiving MX recorded them (Cloudflare); it is also stored on the message and shown in the Inbox.

| Variable                                           | Role                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| `AGENT_OS_EXT_INBOUND_EMAIL_PORT`                  | Upstream port (default `6121`)                                   |
| `AGENT_OS_EXT_INBOUND_EMAIL_PROVIDER`              | Platform default: `fixture` (default), `resend`, or `cloudflare` |
| `AGENT_OS_EXT_INBOUND_EMAIL_WEBHOOK_SECRET`        | HMAC secret for fixture webhooks                                 |
| `AGENT_OS_EXT_INBOUND_EMAIL_RESEND_API_KEY`        | Platform Resend key (fetches received email content)             |
| `AGENT_OS_EXT_INBOUND_EMAIL_RESEND_SIGNING_SECRET` | Platform Resend webhook signing secret (`whsec_…`)               |
| `AGENT_OS_EXT_INBOUND_EMAIL_CLOUDFLARE_SECRET`     | HMAC secret shared with the Cloudflare Email Worker              |
| `AGENT_OS_EXT_INBOUND_EMAIL_DOMAIN`                | Platform inbound domain; each org gets `<slug>@` it              |
| `AGENT_OS_EXT_INBOUND_EMAIL_ADDRESS_MAP`           | Demo `address=orgId` pairs (comma-separated)                     |
| `AGENT_OS_GLOBAL_APP_ORIGIN`                       | Public origin used for auto-registered webhook URLs              |

### Default org addresses

When `AGENT_OS_EXT_INBOUND_EMAIL_DOMAIN` is set (e.g. `in.example.com`), the first session visit to Email (Inbox or Addresses) provisions `<org-slug>@<domain>` with purpose `default` in the address directory; Addresses lists it like any other row. The slug comes from the org name (lowercased, ASCII, `-` separated; `org-<id>` if the name has no usable characters). If another org already owns the slug, the address gets a `-<first 6 chars of org id>` suffix. Peer (header) requests never provision. Renaming an org keeps its existing default address.

### Cloudflare Email Routing (platform default)

Cloudflare delivers mail to an **Email Worker**, not a webhook. The deploy adapter's Worker (`deploy/cloudflare/worker.ts` → `lib/email-forward.ts`) reads `message.raw` and POSTs it as `message/rfc822` to `/api/ext/inbound-email/webhooks/cloudflare` through the container binding, with headers `x-agentos-email-timestamp`, `x-agentos-email-from`, `x-agentos-email-to`, and `x-agentos-email-signature: v1=<hex>` — HMAC-SHA256 of `<timestamp>\n<from>\n<to>\n` + raw MIME with `AGENT_OS_EXT_INBOUND_EMAIL_CLOUDFLARE_SECRET`. Any non-2xx (or an unreachable container) makes the Worker call `setReject`, so the sender gets a bounce (`Unknown recipient` for 404).

The `cloudflare` provider verifies the signature (5-minute skew), parses MIME with `postal-mime`, routes **only on the envelope recipient** (header `To` is kept for display), and dedupes on `Message-ID` (or a SHA-256 of the raw message). SPF / DKIM / DMARC verdicts are read from the `Authentication-Results` header whose authserv-id is `mx.cloudflare.net` (headers from other hosts are ignored) and recorded on the message; failing verdicts are shown, not rejected.

Runbook: [`deploy/cloudflare/README.md` → Inbound email](../../deploy/cloudflare/README.md#inbound-email-cloudflare-email-routing).

### Resend receiving

Resend's `email.received` webhook carries metadata only. On each delivery the builtin verifies the Svix-style signature (`svix-id`, `svix-timestamp`, `svix-signature`; 5-minute skew), then fetches the body from `GET /emails/receiving/{id}` and attachments from `GET /emails/receiving/{id}/attachments` inline — attachment download URLs expire after an hour, and a Resend API failure returns **502** so Resend retries the delivery. Other event types are acknowledged and ignored. Deliveries are idempotent on the Resend email id.

**Platform default**

1. In Resend → Domains, add the inbound domain (e.g. `inbound.example.com`), enable receiving, and add the MX record Resend shows to DNS.
2. Resend → Webhooks → add `https://<app>/api/ext/inbound-email/webhooks/resend` for `email.received`; copy the signing secret.
3. Set `AGENT_OS_EXT_INBOUND_EMAIL_PROVIDER=resend`, `…_RESEND_API_KEY`, and `…_RESEND_SIGNING_SECRET`.
4. Provision per-org locals (`POST /addresses` or `ADDRESS_MAP`), send a message with a PDF, and confirm a blob under `orgs/<orgId>/inbound/…` plus an `email.received` outbox row.

**Per-org (BYOK)** — Settings → Integrations → **Email** → _Email receiving_ (integration `email.receive`, provider `resend`; secrets `apiKey`, `signingSecret`; settings `receivingDomain` plus server-managed `connectionId`, `webhookId`, `webhookStatus`, `webhookError`):

- Saving a key assigns an opaque `connectionId` (platform collection `inbound_connections` → orgId) and calls Resend's Webhooks API with that key to create an `email.received` webhook at `<AGENT_OS_GLOBAL_APP_ORIGIN>/api/ext/inbound-email/webhooks/resend/<connectionId>`. The returned signing secret goes to the vault; status becomes **registered**.
- Rotating the key updates the existing webhook (same account) or creates a new one and deletes the old one with the old key. Removing the integration deletes the webhook and the connection.
- If the key cannot manage webhooks (401/403) or no public origin is configured, status is **manual**: the card shows the webhook URL and a signing-secret field to paste. Other errors show **failing** with the message; saving again retries.
- When Email sending already uses a Resend key, the card offers **Use the same Resend key** (`useSendingKey: true` in the PUT body copies the `email.send` key server-side).
- **Test connection** checks the registered webhook is enabled (or that a manual signing secret is set) and reminds you to send a message to the receiving domain.

**Local:** keep `PROVIDER=fixture`, set `WEBHOOK_SECRET`, and POST a signed JSON body to `/webhooks/fixture` (see builtin tests).
