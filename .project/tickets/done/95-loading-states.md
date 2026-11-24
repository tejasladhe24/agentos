# 95 — Proper loading states

**Status:** done

## Goal

Eliminate blank waits while extension views boot (iframe + handshake) and wire visible loading/progress UX for frontend fetch gaps and backend async status where the platform already tracks it.

## Depends on

- Ticket **6** (extension host iframes) — done
- Ticket **61** / **74** / **73** (HITL, events, notifications status models) — done
- `@agentos/ui` `LoadingState` / `Skeleton` / `Spinner` — already present

## Done when

- [x] Shell in-canvas loading overlay on extension frames while `runtimeStatus === 'loading'` (or unset)
- [x] `HostProvider` shows `LoadingState` instead of rendering `null` during Comlink boot
- [x] HITL inbox shows loading on initial fetch (no false “No pending approvals”)
- [x] Sample invoice-bot page shows loading/skeleton on initial fetch
- [x] Public portal host shows a load indicator until iframe `onLoad`
- [x] Gateway `/api/ext` proxy streams response bodies (SSE / chunked) instead of buffering `arrayBuffer()`
- [x] Notifications delivery status UI deferred (document in Notes) — follow-up
- [x] Tests cover frame overlay + HostProvider boot fallback + HITL initial loading + proxy stream pass-through

## Notes

### Frontend findings

| Gap                                                  | Where                          | Severity   |
| ---------------------------------------------------- | ------------------------------ | ---------- |
| No in-canvas overlay while iframe boots / handshakes | `extension-frame.tsx`          | P0         |
| `HostProvider` returns `null` until host boots       | `host-provider.tsx`            | P0         |
| Public portal bare iframe                            | `public-portal-host.tsx`       | P1         |
| HITL false empty before first poll                   | `hitl-inbox.tsx`               | P1         |
| Invoice initial fetch blank                          | `invoice-bot/ui/page.tsx`      | P2         |
| Extension manager `loading` only as `data-status`    | `extension-manager-drawer.tsx` | P2 (defer) |

Shell already sets `runtimeStatus` to `loading` in `use-extension-host` and shows a tiny status-bar spinner — the main canvas stays blank for several seconds on cold Vite/module load.

### Backend findings

| Area                            | Status model                                         | UI today             | Gap                                                |
| ------------------------------- | ---------------------------------------------------- | -------------------- | -------------------------------------------------- |
| events                          | outbox `pending\|leased\|acked\|dead`; SSE subscribe | publish-only HostAPI | Live progress unused (needs streaming proxy first) |
| HITL                            | `pending\|approved\|rejected`                        | 2s poll              | Works; initial fetch UX missing                    |
| notifications                   | `queued\|sent\|failed`                               | local toast only     | Delivery hydration deferred                        |
| AI                              | none (blocking)                                      | `chatBusy`           | Stream/run job — later                             |
| gateway                         | buffers body                                         | —                    | Blocks SSE through `/api/ext/*`                    |
| workers / files / db-store bulk | sync or process-local                                | none                 | New job registries — later                         |

Do **not** invent new job systems for files/db-store/workers in this ticket. Prefer consuming existing status + fixing the blank iframe wait and gateway streaming.

## Verify

- `bun test` for touched shell / client / gateway packages
- `bun run ci` before PR
