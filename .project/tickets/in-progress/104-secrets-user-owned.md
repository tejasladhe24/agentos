# 104 — User-owned secrets in the vault

**Status:** in-progress

## Goal

Allow vault secrets **owned by a single user** inside an org, readable only by that user (or a service acting for that user). Needed for personal OAuth tokens (Google Drive / OneDrive mounts, ticket **113** / **114**) so org admins with `secrets.read` cannot read employees' personal tokens.

## Depends on

- Ticket **77** / **98** (vault + Secrets manager UI)
- Ticket **78** (OAuth kit — today it stores tokens org-wide via `putSecret`)

## Scope

1. **Owner field** — vault records gain optional `ownerUserId`. Org-owned secrets (no owner) behave exactly as today.
2. **Access rules**
   - Session callers: user-owned secrets are readable/writable only when `session.userId === ownerUserId`. `secrets.read` / `secrets.write` do **not** grant access to other users' secrets.
   - Peer callers (services/builtins): must pass `X-AgentOS-User-Id` alongside `X-AgentOS-Org-Id` to read a user-owned secret; builtins only forward the user from the current request, never from background jobs.
3. **List** — `GET /secrets` excludes user-owned secrets for everyone (including the owner). Personal tokens are managed from the feature that created them (e.g. Settings › Files › My connected drives), not the Secrets manager.
4. **Kit** — `putSecret` / `getSecret` / `deleteSecret` accept `{ ownerUserId }` (TS + Python parity). OAuth kit gains a `scope: 'org' | 'user'` option.
5. **Offboarding** — when a user is removed from an org (auth `org_members` delete), delete their user-owned secrets for that org and publish `secrets.user_purged` (consumers such as files disconnect personal mounts). Audit entry without values.
6. **Audit** — `secrets.put` / `secrets.delete` record `ownerUserId` when present.

## Out of scope

- Personal mount UI (ticket **113**).
- KMS / per-user encryption keys (same master key; access control is enforced at the API).

## Done when

- [x] Vault supports `ownerUserId`; org-owned behavior unchanged
- [x] Other users and admins cannot read or list another user's secret (tests)
- [x] Peer access requires the user header
- [x] OAuth kit supports user-scoped token storage
- [x] Member removal purges user-owned secrets + emits event
- [x] Docs: threat model row for user-owned secrets
- [x] `bun run ci` green

## Verify

- `bun test` secrets builtin: owner read OK, admin read 404/403, list excludes
- Remove a member → their secrets gone, audit entry present
