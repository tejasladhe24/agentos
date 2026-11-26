# 142 — Extension UI event bus (Shell-brokered pub/sub)

**Status:** in-progress

## Goal

Give extension UIs one way to communicate: a **Shell-brokered event bus**. Frames publish and subscribe through `@agentos/core/client`. The Shell fans events out in memory to subscribed frames, and forwards server-originated events from the `events` builtin SSE stream. No extension calls another extension's routes or channels directly.

Today `HostAPI.events` has only `publish`, the SDK's `ExtensionAPI.onEvent` is never invoked by the Shell, and no UI consumes events.

## Depends on

- Ticket **141** (Events builtin auth and org scope) — merged (required before the SSE bridge ships)
- Ticket **74** (Durable event queue + `hitl.resolved`) — done
- Ticket **82** (SDK parity) — done
- Ticket **134** (Right sidebar + Files migration) — done

## Decisions

- **Shell is the broker.** Frames never see each other's `MessagePort`s. UI-to-UI events stay in-process; no server round trip.
- **Topics are namespaced** `<extId>.<event>` (for example `files.selection.changed`, `email.received`). Each `meta.json` declares `events.publishes` and `events.subscribes`. The Shell rejects undeclared publishes and subscribes.
- **Payloads** stay JSON (`EventPayload` in `packages/core/src/sdk/lib/contracts.ts`).
- Server events arrive over `GET /api/ext/events/subscribe` (org-scoped per ticket 141) and are re-emitted on the in-memory bus.

- **Implementation notes (as built):**
  - `HostAPI.events` is `publish` (durable, via the `events` builtin; UI subscribers get it back over the SSE bridge), `publishLocal` (in-process only), `subscribe(topics) → subscriptionId`, and `unsubscribe(id)`. Ids instead of a `{ unsubscribe() }` handle keep every value structured-clone safe over Comlink.
  - Frames register their remote `onEvent` via `activateFrame({ onRemote })` (before `onActivate`, so early subscriptions cannot race); `useExtensionHost` drops the frame on dispose.
  - The SSE connection is opened lazily (first subscription) and closed with the last one, rather than being held for the whole session.
  - `meta.json` `events.publishes` must be in the extension's own `<extId>.` namespace (enforced in the scanner); this is the per-extension namespacing deferred from ticket 141.

## Scope

1. **SDK (`packages/core/src/sdk/`):**
   - Add `events.subscribe(topics: string[]): Promise<{ unsubscribe(): void }>` to `HostAPI`. Delivery uses the existing `ExtensionAPI.onEvent(topic, payload)`.
   - Keep `events.publish` and add a `publishLocal` path if needed for UI-only events, documented in `contracts.ts`.
2. **Shell (`packages/core/src/shell/lib/chrome/`):**
   - Create `event-bus.ts`: in-memory topic registry keyed by `extensionId`, with subscribe / unsubscribe / publish and delivery to each active frame's remote `onEvent`.
   - `useExtensionHost` registers the frame remote with the bus on activate and removes it on dispose.
   - Open one SSE connection to `/api/ext/events/subscribe` per signed-in session; re-emit server events on the bus.
   - Enforce `meta.json` declarations on publish and subscribe.
3. **Client (`packages/core/src/client/`):**
   - Add `useHostEvent(topic, handler)` and `useHostPublish()`.
   - Update `packages/core/src/client/tests/stub-host.ts`.
4. **Declarations:**
   - Extend `meta.json` typing and `packages/core/src/vite/lib/types.ts` with `events.publishes` / `events.subscribes`.
   - Document in `.project/docs/extensions.md`.
5. **Tests:**
   - Shell: bus delivers to subscribed frames only; undeclared publish rejected; unsubscribe on frame dispose; SSE re-emit.
   - Client: `useHostEvent` subscribes on mount and cleans up on unmount.

## Out of scope

- Migrating existing `BroadcastChannel` hooks (ticket **143**).
- Removing direct `api.fetch` cross-extension calls (ticket **144**).
- Cross-tab or cross-device sync beyond what SSE already gives.

## Done when

- [x] `HostAPI.events.subscribe` and `useHostEvent` are exported from `@agentos/core/sdk` and `@agentos/core/client`
- [x] Shell delivers events to subscribed frames through `onEvent` with no direct frame-to-frame channel
- [x] Server events from the `events` builtin are re-emitted on the Shell bus, org-scoped
- [x] Undeclared publish and subscribe are rejected and tested
- [x] `meta.json` declarations are documented and validated by the scanner
- [x] `bun run ci` passes

## Verify

- `bun run ci`
- Local `agentos dev` with two extensions: extension A publishes `a.ping`, extension B (declared subscriber) logs the payload; an undeclared subscriber receives nothing
