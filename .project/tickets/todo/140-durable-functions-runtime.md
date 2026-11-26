# 140 — Durable functions runtime (approval-gated, event-driven) on db-store

**Status:** todo

## Goal

Let an FDE bind **extension code** to an **event** at build time, and have a platform **scheduler** run it durably: retries, memoized steps, and the ability to **suspend until a human approves**. Nothing runs on a linear queue. A run that needs approval parks as a waiting run until the matching `hitl.resolved` event arrives, then resumes.

This is an Inngest-style model built on our own stack (db-store, no new infra, no Temporal/Inngest dependency).

```ts
// extensions/invoice-bot/functions/pay-invoice.ts
export default defineFunction(
  { id: 'pay-invoice', on: 'invoice.approved-for-payment' },
  async ({ event, step }) => {
    const approval = await step.run('request-approval', (ctx) =>
      createApproval({
        title: `Pay ${event.data.vendor}`,
        source: 'invoice-bot',
        idempotencyKey: ctx.idempotencyKey,
      }),
    );
    const decision = await step.waitForEvent('await-decision', {
      event: 'hitl.resolved',
      match: 'data.approvalId',
      value: approval.id,
      timeout: '7d',
    });
    if (decision?.data.decision !== 'approved') return { paid: false };
    return step.run('pay', (ctx) =>
      payments.create({ ...event.data, idempotencyKey: ctx.idempotencyKey }),
    );
  },
);
```

The business logic lives in the extension package (Bun API or Python service). The platform only schedules, persists run and step state, and calls back into the extension.

Source: design discussion on ticket **136** (approvals); builds on the `events` outbox from ticket **74**.

## Depends on

- Ticket **74** (durable events outbox, `hitl.resolved`) — done
- Ticket **61** (durable HITL) — done
- Ticket **16** (db-store) — done
- Ticket **136** (Approvals page) — in progress; the page shows these approvals

## Decisions (defaults; confirm or override before build)

1. **Engine:** a new builtin (`functions`) over db-store. Not Temporal or Inngest; an adapter can come later.
2. **Execution identity:** a run captures the requesting user (`userId`, `orgId`) at event time and re-checks that the user still holds the needed role when the run resumes. A run never gets broader access than its requester had.
3. **`waitForEvent` default timeout:** 7 days, configurable per step. On timeout the step resolves to `null` and the function decides (default pattern: treat as rejected).
4. **Approvals become per-user:** approvals created inside a run carry the run's `userId`; the Approvals list and resolve endpoints only expose the current user's approvals. Today they are one shared `__platform__` collection.

## Scope

1. **Build-time declaration.** Each extension declares functions (`functions/*.ts`, or `meta.json` → `functions[]` for Python services) with `id`, `on` (event or list), optional `match`, `concurrency`, and `idempotencyKey` expression. The Vite scanner and `virtual:agentos-registry` expose them; invalid or duplicate ids fail the build.
2. **Extension SDK.**
   - TS: `@agentos/core/api/functions` exports `defineFunction`, `step.run`, `step.waitForEvent`, `step.sleep`, `step.sendEvent`, plus `serveFunctions(...)`, which mounts `POST /_functions/:id`.
   - Python: matching `agentos.functions`.
   - Invoke protocol: the scheduler sends `{ runId, event, memo }`. The function re-runs from the top with completed steps replayed from `memo` and returns `step | waiting | sleep | complete | error`. Function code must be deterministic between steps (documented).
3. **Scheduler builtin `functions`.** Collections `function_runs`, `function_steps`, `function_waits` in db-store. Run states: `queued → running → waiting → completed | failed | cancelled`. It handles retries with backoff and a dead-letter state, per-function concurrency limits, and run cancel/inspect APIs (`GET /runs`, `GET /runs/:id`, `POST /runs/:id/cancel`).
4. **Event routing.** The scheduler consumes the `events` outbox. Add topic-filtered claim (or a consumer-group cursor) to `events` so it does not claim unrelated topics. Matching events create runs or wake `waiting` runs whose `waitForEvent` predicate matches.
5. **Signed RPC.** Scheduler to extension calls are HMAC-signed with a timestamp and replay window; extensions verify with the existing HMAC helper. No unsigned `_functions` route is reachable from the browser or gateway.
6. **Enable-state.** If an extension is disabled, its runs pause (not fail) and resume on re-enable; events keep being recorded.
7. **HITL integration.** `createApproval` accepts `source` and `idempotencyKey` (same key returns the existing approval) and stamps `userId`. Per-user list/resolve. Approval resolution stays a one-way compare-and-set (409 on second resolve) and publishes `hitl.resolved` as today.
8. **Example.** `examples/client-app/extensions/invoice-bot`: a payout function gated by approval (TS), plus one Python-service equivalent.
9. **Docs.** `architecture.md`, `extensions.md`, `builtins.md`, and a new "Durable functions" section covering function authoring, determinism rules, idempotency, and single- vs multi-replica guidance.

## Idempotency (required, not optional)

- **Events:** unique `(functionId, idempotencyKey)`. A duplicate event never starts a second run. The default key is the event id.
- **Steps:** memoized by `(runId, stepKey)`. A completed step is never re-executed on replay.
- **Side effects:** each `step.run` gets a deterministic `ctx.idempotencyKey = sha256(runId:stepKey)` that extension code must forward to downstream calls. Platform APIs (`hitl`, `events`, `notifications`, `db-store` inserts) honor an `Idempotency-Key` header.
- **Workers:** a run lease has a monotonically increasing **fencing epoch**. Step results written with a stale epoch are rejected, so a slow worker cannot overwrite a newer one.
- **Approvals:** resolve is atomic and one-way; double-clicks and concurrent resolves cannot produce two `hitl.resolved` events.
- **At-least-once reality:** a crash after a side effect but before the step result is saved is covered by the step idempotency key. This is documented as the contract for extension authors.

## Out of scope

- Temporal or Inngest adapters; non-db-store engines (SQS, Cloud Tasks).
- Parallel step groups, fan-out/fan-in, and sub-workflows (v2).
- Cron triggers beyond what `events` jobs already emit as events.
- A Run Inspector UI (API only here). The Approvals card does not yet show run status.
- Arbitrary per-org function toggles.

## Done when

- [ ] `defineFunction` / `serveFunctions` (TS) and Python equivalent with `step.run`, `step.waitForEvent`, `step.sleep`, `step.sendEvent`
- [ ] Functions declared at build time appear in the registry; invalid or duplicate declarations fail the build
- [ ] `functions` builtin persists runs, steps, and waits in db-store; retries, backoff, dead-letter, concurrency, cancel
- [ ] `events` supports topic-filtered consumption used by the scheduler
- [ ] Scheduler-to-extension calls are HMAC-signed; unsigned or replayed calls are rejected
- [ ] Approval-gated function suspends in `waiting`, resumes on `hitl.resolved`, and handles reject and timeout paths
- [ ] Approvals are per-user (list and resolve scoped to the current user); `source` and `idempotencyKey` supported
- [ ] Idempotency: duplicate events, replayed steps, stale-epoch writers, and double-resolve each have a passing test
- [ ] Disabled extension pauses runs and re-enabling resumes them
- [ ] invoice-bot example (TS + Python) and docs updated
- [ ] `bun run ci`

## Verify

- Unit and integration tests: crash between side effect and step save yields exactly one downstream effect; two workers contending for a run yield one winner; duplicate publish yields one run; server restart during `waiting` still resumes on approval.
- Live (`agentos dev`): trigger the payout event; the approval appears in `/ext/hitl` for the requesting user only; Approve runs the payment once; Cancel and timeout complete the run without paying; restart the dev server while waiting and approve afterwards.

## Notes

- Prerequisite gaps found while planning: approvals are not user-scoped, `events` claim has no topic filter, and approval creators do not standardize `source`. All three are in scope above.
- `.project/tickets/README.md` index is intentionally not edited here (pending edits for 136–139 live elsewhere). Add this ticket when that index is next updated.
