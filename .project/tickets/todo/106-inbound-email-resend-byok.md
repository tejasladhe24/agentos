# 106 — Inbound email via Resend (platform + BYOK) and remove Mailgun

**Status:** todo

## Goal

Receive email through **Resend** — both as a platform-default provider and as an org's own (BYOK) account — and remove the Mailgun adapter. With BYOK, one Resend account covers an org's sending (ticket **105**) and receiving.

## Depends on

- Ticket **103** (integrations foundation)
- Ticket **86** (inbound email) — done
- Ticket **105** (email sending BYOK) — shares the Email settings section

## Background

Resend's `email.received` webhook carries metadata only (from, to, subject, attachment list). The body comes from `GET /emails/receiving/{id}` and attachments from the Attachments API; attachment `download_url`s expire after **1 hour**. Docs: [Receiving](https://resend.com/docs/dashboard/receiving/), [`email.received`](https://resend.com/docs/webhooks/emails/received), [attachments](https://resend.com/docs/dashboard/receiving/attachments).

## Scope

1. **`resend` inbound provider** in `inbound-email` (`api/lib/providers/`):
   - Verify the webhook signature.
   - Fetch the body and attachments promptly (inline, or a durable job via builtin `events` with retry inside the 1-hour window).
   - Store attachments in `files` and publish `email.received`, same as today.
2. **Routes**
   - `POST /webhooks/resend` — platform default: platform signing secret (env), org resolved from the recipient address (existing address mapping).
   - `POST /webhooks/resend/:connectionId` — BYOK: opaque connection id → org's integration record → org's signing secret; fetch content with the org's API key.
3. **Webhook auto-registration (BYOK)**
   - When an admin saves a Resend key for `email.receive`, call Resend's Webhooks API with that key to create an `email.received` webhook pointing at `/webhooks/resend/<connectionId>`; store the returned signing secret in the vault and the webhook id in settings.
   - On key rotation/removal, update or delete the webhook.
   - If the key lacks permission, fall back to showing the URL + a signing-secret field for manual setup.
4. **Integration shape** — `email.receive` / `resend`: secrets `apiKey`, `signingSecret`; settings `receivingDomain`, `connectionId`, `webhookId`. When the same Resend key is used for sending, the UI offers "use the same key".
5. **Settings UI** — Receiving card in the Email section: receiving domain, MX instructions, webhook status (registered / manual / failing), read-only webhook URL, test (send a message to the domain and watch it arrive).
6. **Remove Mailgun** — delete `providers/mailgun.ts`, its route, env (`AGENT_OS_EXT_INBOUND_EMAIL_MAILGUN_SIGNING_KEY`), tests, and the Mailgun DNS docs section. `AGENT_OS_EXT_INBOUND_EMAIL_PROVIDER` becomes `fixture` | `resend` | `cloudflare` (cloudflare in ticket **107**).
7. **Keep `fixture`** for local runs and tests.

## Out of scope

- Cloudflare inbound (ticket **107**, **115**).

## Done when

- [ ] Resend inbound works for platform default and BYOK routes
- [ ] Webhook auto-registered on key save; manual fallback works
- [ ] Attachments land in `files`; `email.received` published
- [ ] Mailgun code, env, and docs removed
- [ ] Tests with mocked Resend webhook + API payloads, bad signature rejected, unknown connection id → 404
- [ ] Docs: `builtins.md` inbound section rewritten (Resend + fixture)
- [ ] `bun run ci` green

## Verify

- Mock Resend: POST signed `email.received` → content fetched → Inbox shows message + attachment
- BYOK: save key → webhook created (mock) → POST to connection route → lands in that org only
