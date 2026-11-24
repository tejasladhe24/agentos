# 107 — Inbound email via Cloudflare Email Worker (platform default)

**Status:** todo

## Goal

Offer **Cloudflare Email Routing** as a cheap platform-default inbound provider. Orgs configure nothing; each gets an address like `<org-slug>@in.<platform-domain>`. Not a BYOK option in v1 (see ticket **115**).

## Depends on

- Ticket **106** (inbound provider set, route conventions)
- Ticket **62** (`deploy/cloudflare` adapter) — done

## Background

Cloudflare delivers inbound mail to an **Email Worker** (`email()` handler with a raw MIME stream), not to a webhook. Docs: [Email Workers handler](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/).

## Scope

1. **Email Worker (deploy layer)** — in `deploy/cloudflare/`, a thin `email()` handler:
   - Catch-all rule on the inbound domain → Worker.
   - Read `message.raw`, sign it (HMAC with a platform secret), POST to `/api/ext/inbound-email/webhooks/cloudflare` with envelope `from` / `to`.
   - Reject (`setReject`) when the endpoint returns a non-2xx, so senders get a bounce.
   - No Cloudflare bindings in `@agentos/core`.
2. **`cloudflare` inbound provider** in `inbound-email`:
   - Verify the HMAC signature.
   - Parse MIME with `postal-mime` (runs in Bun).
   - Resolve the org from the recipient address; store attachments in `files`; publish `email.received`.
   - Respect the `Authentication-Results` header from `mx.cloudflare.net` (record SPF/DKIM/DMARC result on the message).
3. **Org addresses** — default address per org from its slug on the platform inbound domain; existing Addresses UI shows it.
4. **Env** — `AGENT_OS_EXT_INBOUND_EMAIL_PROVIDER=cloudflare`, `AGENT_OS_EXT_INBOUND_EMAIL_CLOUDFLARE_SECRET` (shared with the Worker), inbound domain.

## Out of scope

- Per-org Cloudflare accounts (ticket **115**).

## Done when

- [ ] Email Worker in `deploy/cloudflare` forwards signed raw MIME
- [ ] `cloudflare` provider parses and ingests messages + attachments
- [ ] Bad signature rejected; unknown recipient → reject
- [ ] Tests with fixture MIME messages (text, HTML, attachments)
- [ ] Docs: Cloudflare inbound runbook (Email Routing setup, Worker deploy, env)
- [ ] `bun run ci` green

## Verify

- Unit: signed MIME fixture → message + attachments in the right org
- Staging: send to `<org-slug>@in.<domain>` → appears in Inbox
