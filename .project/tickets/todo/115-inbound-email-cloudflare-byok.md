# 115 — (Later) Inbound email via an org's own Cloudflare account

**Status:** todo

## Goal

Let an org receive mail on **its own domain through its own Cloudflare account**, provisioned automatically from an org API token.

## Depends on

- Ticket **107** (Cloudflare Email Worker, platform default)
- Ticket **103** (integrations foundation)

## Scope

1. Org enters a Cloudflare API token (Workers Scripts edit, Email Routing edit, Zone DNS read/edit) + zone.
2. AgentOS uploads the forwarding Email Worker script to the org's account, sets its signing secret, and creates the catch-all routing rule.
3. Org-specific webhook route (opaque connection id) with the org's secret.
4. Re-provision on rotation; tear down on removal.

## Notes

- Much wider access than Resend's single webhook call; consider after Resend BYOK (ticket **106**) is in use.
- Alternative that needs no work: orgs forward mail from their own mailbox to their platform inbound address.

## Done when

- [ ] Provision / rotate / remove flows with a mocked Cloudflare API
- [ ] Mail on the org domain lands in that org
- [ ] `bun run ci` green
