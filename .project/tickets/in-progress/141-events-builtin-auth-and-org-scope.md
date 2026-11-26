# 141 — Events builtin: auth, org scope, and hardened routes

**Status:** in-progress

## Goal

Close the open surface of the `events` builtin before any UI or extension depends on it. Today every route in `packages/core/builtins/events/api/lib/handle-request.ts` (`publish`, `subscribe` SSE, `queue/*`, `jobs` including HTTP-action jobs that fetch arbitrary URLs) is reachable without a session, and topics are not scoped to an organization.

## Depends on

- Ticket **71** (Tenancy: org model + org-scoped db-store) — done
- Ticket **72** (Public unauthenticated extension routes) — done
- Ticket **74** (Durable event queue + job scheduler) — done

## Scope

Decision: browsers authenticate with the Better Auth session; server-side builtins (hitl, secrets, inbound-email, files, integrations, Python) authenticate with a per-stack **service token**. The gateway forwards headers verbatim, so `X-AgentOS-Org-Id` is trusted **only** with a valid service token.

1. **Auth on every route:** `GET /health` stays public. Everything else needs a session (cookie → auth `/session`, `401` / `403` without an org) or a service token (`AGENT_OS_EVENTS_SERVICE_TOKEN`, generated per stack by the CLI). No authenticator configured → `503` (fail closed).
2. **Service-only routes:** `queue/*` and `jobs/tick` return `403` for sessions.
3. **Org-scoped topics and subscriptions:** outbox records, jobs, and SSE subscribers carry `orgId` (`__platform__` for platform signals). A session only receives its own org; `GET /subscribe` never delivers platform-scoped events to sessions.
4. **Jobs:** sessions need an `admin` / `owner` role, are scoped to their org, and cannot create `http` jobs. `http` targets are validated at creation and again at run time (no non-http(s), credentials, metadata, or link-local addresses).
5. **Publish authorization:** topic names are validated, and server-only topics (`hitl.resolved`, `email.received`, `secrets.user_purged`, `integration.changed`) are service-only. (Per-extension namespacing is not enforced: the events builtin cannot yet tell which extension a session request came from; revisit with ticket 142's Shell-brokered bus.)
6. **Clients:** the shared TS (`@agentos/core/api/events`) and Python (`agentos.events`) clients attach the token; `publish` accepts an `orgId`.
7. **Tests:** `packages/core/builtins/events/tests/events-auth.test.ts`.

## Out of scope

- The Shell-side bus and frame delivery (ticket **142**).
- Replacing SSE with WebSockets.

## Done when

- [x] Every `events` route except `GET /health` rejects unauthenticated requests
- [x] `queue/*` and `jobs/tick` require the service credential, not a browser session
- [x] Events and jobs are org-scoped; cross-org reads and writes are covered by tests
- [x] `http` jobs are service-only and block metadata / link-local targets (loopback stays allowed for builtin peers)
- [x] Publish validates topics and restricts platform topics to the service principal
- [x] `.project/docs/builtins.md` documents the events auth model
- [x] `bun run ci` passes

## Verify

- `pnpm install` then `bun run ci`
- `curl -i http://localhost:<port>/api/ext/events/subscribe` returns `401` with no cookie
- Log in as org A, publish; log in as org B, subscribe and confirm no delivery
