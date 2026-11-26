# 141 — Events builtin: auth, org scope, and hardened routes

**Status:** todo

## Goal

Close the open surface of the `events` builtin before any UI or extension depends on it. Today every route in `packages/core/builtins/events/api/lib/handle-request.ts` (`publish`, `subscribe` SSE, `queue/*`, `jobs` including HTTP-action jobs that fetch arbitrary URLs) is reachable without a session, and topics are not scoped to an organization.

## Depends on

- Ticket **71** (Tenancy: org model + org-scoped db-store) — done
- Ticket **72** (Public unauthenticated extension routes) — done
- Ticket **74** (Durable event queue + job scheduler) — done

## Scope

1. **Session required on every route:**
   - Add a guard in `handleEventsRequest` (or the gateway proxy for `events`) that requires a valid Better Auth session via `@agentos/core/api/auth` and returns `401` otherwise.
   - Exception: `GET /health` stays unauthenticated.
   - `queue/*` routes are for worker processes only; require a service credential (`AGENT_OS_EXT_EVENTS_WORKER_TOKEN` or equivalent in `api/env.ts`) instead of a browser session.
2. **Org-scoped topics and subscriptions:**
   - `outbox.publish` and `bus.subscribe` carry `orgId` (use the `__platform__` sentinel for platform-wide events such as `hitl.resolved` only when explicitly marked).
   - `GET /subscribe` only delivers messages for the caller's active org.
   - Enforce via `dbStore.collection(name, { orgId })` in `outbox-store.ts` and `jobs-store.ts`.
3. **Restrict scheduled HTTP jobs:**
   - `kind: 'http'` jobs in `scheduler.ts` may only target an allowlist (declared per extension in `meta.json`) or be removed from the public API. Reject `file:`, loopback, and private-network targets.
   - Jobs are created and listed only within the caller's org.
4. **Publish authorization:**
   - Publishing a topic requires that the topic's namespace matches the caller's extension id (`<extId>.<event>`) or is a documented platform topic (`hitl.*`, `email.received`, …).
5. **Tests:**
   - `packages/core/builtins/events/tests/`: unauthenticated `publish` / `subscribe` / `jobs` return `401`; cross-org subscribe receives nothing; `http` job to a private address is rejected; wrong-namespace publish returns `403`.

## Out of scope

- The Shell-side bus and frame delivery (ticket **142**).
- Replacing SSE with WebSockets.

## Done when

- [ ] Every `events` route except `GET /health` rejects unauthenticated requests
- [ ] `queue/*` requires the worker credential, not a browser session
- [ ] Events and jobs are org-scoped; cross-org reads and writes are covered by tests
- [ ] `http` jobs enforce an allowlist and block private/loopback targets
- [ ] Publish enforces topic namespacing
- [ ] `.project/docs/builtins.md` documents the events auth model
- [ ] `bun run ci` passes

## Verify

- `pnpm install` then `bun run ci`
- `curl -i http://localhost:<port>/api/ext/events/subscribe` returns `401` with no cookie
- Log in as org A, publish; log in as org B, subscribe and confirm no delivery
