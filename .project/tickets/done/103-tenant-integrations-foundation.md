# 103 — Tenant integrations foundation (BYOK)

**Status:** done

## Goal

Let each org bring its own keys (BYOK) for tenant-scoped integrations — email, SMS, file storage, AI — while infrastructure secrets stay platform-wide. This ticket builds the shared plumbing every BYOK integration uses; per-integration tickets (**105**–**114**) build on it.

Decisions (from planning chat):

- **Non-secret settings** (provider, from-address, bucket, region, model, …) live in a **plain per-org record in db-store**. Only secret values go in the **secrets vault**, referenced by key.
- **Platform fallback:** when an org has not configured an integration, the builtin **always** falls back to the platform env config (today's behavior).
- **Providers are resolved per request**, not once at boot.

## Depends on

- Ticket **77** / **82** / **98** (secrets vault, SDK, Secrets manager UI)
- Ticket **71** (org tenancy) — done
- Ticket **101** (extension-registered Settings) — integration settings render as builtin `ui/settings.tsx` sections

## Secret classification

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

**Tenant-scoped (BYOK with platform default):** email sending, SMS, email receiving (Resend), file storage mounts, AI provider. Covered by tickets **105**–**114**.

## Scope

### 1. Integration records (db-store)

- Org-scoped collection (e.g. `integrations`), one document per integration instance:
  `{ id, integration, provider, settings: {…non-secret}, secretRefs: { field → vaultKey }, createdAt, updatedAt, updatedBy }`.
- `integration` is a namespaced id (`email.send`, `email.receive`, `sms`, `ai`, `files.mount`). Some integrations allow multiple instances (file mounts); others one per org.
- Vault keys follow a reserved prefix (e.g. `integrations/<integration>/<instanceId>/<field>`). Reserve the prefix: the generic Secrets manager hides or marks these as managed and blocks editing them directly.

### 2. Server kit (`@agentos/core/api/integrations` + Python parity)

- `getIntegration(orgId, integration, instanceId?)` → settings + decrypted secrets, or `null` → caller uses platform env.
- `putIntegration` / `deleteIntegration` — write non-secret record + vault secrets together; deleting removes both.
- Secrets are write-only from the UI: reads for display return `{ field: { set: true, updatedAt } }`, never values.
- Builtins call the kit directly with their peer org header (same trust model as db-store / secrets).

### 3. Per-request resolution + cache

- Helper for builtins: `resolveProvider(orgId, integration, buildFromConfig, buildFromEnv)` with a short-TTL in-process cache keyed by `orgId + integration + instance + updatedAt`.
- Invalidate on put/delete (publish an `integration.changed` event via builtin `events` so other replicas drop their cache).

### 4. Shared Settings UI pieces (`@agentos/ui` or core client components)

- Integration card building blocks used by each builtin's `ui/settings.tsx`: provider picker, secret field (masked, "set / not set", replace), source badge (**Using your key** / **Platform default**), **Test connection** button + result, remove-integration confirm.
- RBAC: new permission `integrations.manage` (admin roles); read-only view for others.

### 5. Audit + hygiene

- `integration.put` / `integration.delete` / `integration.test` audit entries with provider + field names, never values.
- Secret values never logged, never in toasts/errors/audit meta.

## Out of scope

- Per-integration providers and UI sections (tickets **105**–**114**).
- User-owned secrets for personal mounts (ticket **104**).
- Plan/tier gating of the platform fallback (decided: always fall back).

## Done when

- [x] `integrations` collection + kit (TS + Python) with secret refs into the vault
- [x] `resolveProvider` helper with cache + `integration.changed` invalidation
- [x] Reserved vault prefix hidden/locked in the Secrets manager
- [x] Shared integration card components + `integrations.manage` permission
- [x] Audit entries without secret values
- [x] Tests: fallback to env when unset, per-org isolation, cache invalidation, no value leakage in reads
- [x] Docs: `builtins.md` BYOK section with the platform vs tenant table above
- [x] `bun run ci` green

## Verify

- `pnpm install` then `bun run ci`
- Unit: org A with integration record resolves its config; org B (no record) resolves env
- Put → resolve → put new secret → resolve returns new value without restart
