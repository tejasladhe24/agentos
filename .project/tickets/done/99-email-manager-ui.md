# 99 — Email manager UI (send + receive, fully functional)

**Status:** done

## Goal

Ship a **fully functional Email manager** that covers **receive** (builtin `inbound-email`) and **send** (builtin `notifications` email channel) in one Activity Bar surface: inbox, message detail, attachments, compose/send, delivery status, and inbound address admin.

Today inbound-email exposes addresses + webhooks only (messages persist in `inbound_messages` but **no list/read API** / **no `ui/`**). Notifications can `POST /notify` for email but has no operator compose UI.

## Depends on

- Ticket **86** (inbound-email) — done
- Ticket **73** / **82** (notifications email/SMS + SDK) — done
- Ticket **57** / **96** (files for attachments; **96** preferred for attachment preview UX — if **96** not done, use raw blob download links)
- Ticket **74** (`email.received` events) — done; UI may show event id but must not require events UI
- Ticket **38** / **39** (Activity Bar secondary) — done

## Functional requirements

1. **Activity Bar entry** — Single **Email** secondary entry (prefer hosting UI under `builtins/inbound-email/ui/` **or** a thin builtin `email` UI shell that calls both APIs — pick one in implementation notes and document). Opens `ui/page.tsx` with tabs or sections: **Inbox**, **Sent / deliveries**, **Compose**, **Addresses**.
2. **Inbox (receive)** — List inbound messages for active org: from, to, subject, receivedAt, attachment count. Click → detail.
3. **Message detail** — Full headers summary, body text/html (sanitized), attachment list with download/open via `files` keys; mark read if status field exists (add if needed).
4. **Addresses** — List provisioned inbound addresses for org; provision new `{ address, purpose? }` bound to active `orgId`; show webhook/provider health summary.
5. **Compose (send)** — Form: `to`, `subject`, `message` (and optional template id + vars). Sends via `POST /api/ext/notifications/notify` with `channel: "email"`. Success shows delivery id.
6. **Sent / deliveries** — List recent email deliveries for org (extend notifications API if `recent` is in-app-only today); show status `queued` | `sent` | `failed`; open delivery detail.
7. **Templates** — Optional picker for builtin template ids (`client-reminder`, `digest`, …) with var fields; not a full template editor.
8. **Refresh** — Manual refresh inbox + deliveries; empty and error states.
9. **API gaps (required for UI)**:
   - **inbound-email:** `GET /messages` (org-scoped, pagination, filters from/to/q); `GET /messages/:id`; optional `PATCH` read-state
   - **notifications:** org-scoped list of email deliveries (if missing); ensure compose fields match notify API; `GET /deliveries/:id` already exists
   - Clients: extend `@agentos/core/api/inbound-email` (add if missing) + `@agentos/core/api/notifications`; Python parity where modules exist
10. **Org scope** — Inbox/addresses/send always active org; no cross-tenant messages.
11. **Permissions** — Document/require sensible RBAC (e.g. `email.read` / `email.send` or reuse notifications permissions); hide Compose without send permission.
12. **Attachments** — Inbound attachments use files keys from ingest; never re-upload provider payloads through the browser.

## Non-functional requirements

1. **UI kit** — `@agentos/ui` only; kebab-case UI files; one composition per tab (avoid dashboard clutter).
2. **HTML body safety** — Sanitize or iframe-sandbox any HTML email body; plain text default if sanitization deferred (document choice).
3. **Provider realism** — Works with `PROVIDER=fixture` locally; Mailgun path documented for staging; send path works with `EMAIL_PROVIDER=log` locally (shows as sent in log mode).
4. **Performance** — Inbox page load paginated (≤50); don’t fetch full attachment bytes until user opens/downloads.
5. **A11y** — Tab list semantics; compose form labels; destructive confirms for address changes if delete added.
6. **Security** — Webhooks stay public-prefix + signature verified (unchanged); UI routes require session; no webhook secrets in UI.
7. **Tests** — Message list/detail API; compose → notify mock; UI inbox/compose/addresses states; Activity Bar scan.
8. **Docs** — `builtins.md` Email manager; clarify send=`notifications`, receive=`inbound-email`; DNS/Mailgun section link.

## Done when

- [ ] Activity Bar **Email** opens manager with Inbox / Compose / Deliveries / Addresses
- [ ] Inbound message list+detail APIs exist and power Inbox
- [ ] Compose sends email via notifications and surfaces delivery status
- [ ] Address provision/list works for active org
- [ ] Docs + tests + SDK updates landed

## Notes

- Do **not** build a full ESP (bounces, campaigns, marketing). Operator mailbox + compose is enough.
- SMS can appear as a later tab; out of scope unless trivial.
- If hosting under `inbound-email`, still call notifications only through `@agentos/core/client` / gateway paths — no direct provider SDKs in UI.

## Verify

- Fixture webhook ingest → message appears in Inbox → open attachment
- Compose → delivery `sent` (log provider) or real provider in staging
- `bun test` inbound-email + notifications + UI; `bun run ci` before PR
