# 105 — Email + SMS sending BYOK (notifications)

**Status:** todo

## Goal

Let an org send email and SMS through **its own provider account** (Resend or Cloudflare for email, Twilio for SMS) instead of the platform's, configured from Settings without a redeploy. Orgs that configure nothing keep using the platform env providers.

## Depends on

- Ticket **103** (integrations foundation)
- Ticket **73** (notifications email/SMS delivery) — done
- Ticket **99** (Email manager UI)

## Scope

1. **Per-request providers** — `notifications` stops building email/SMS providers once at boot (`api/server.ts`). Each delivery resolves the org's `email.send` / `sms` integration via `resolveProvider`, falling back to `AGENT_OS_EXT_NOTIFICATIONS_*` env.
2. **Integration shapes**

   | Integration  | Provider     | Secrets (vault) | Settings (db-store)  |
   | ------------ | ------------ | --------------- | -------------------- |
   | `email.send` | `resend`     | `apiKey`        | `from`               |
   | `email.send` | `cloudflare` | `apiToken`      | `from`, `accountId`  |
   | `sms`        | `twilio`     | `authToken`     | `accountSid`, `from` |

3. **Test connection** — send a test email/SMS to the current admin, or call a provider "verify" endpoint where available; report success/failure in the card.
4. **Delivery records** — store which source sent each message (`source: 'org' | 'platform'`, provider id) so the Deliveries view can show it.
5. **Settings UI**
   - Email sending card in `inbound-email` `ui/settings.tsx` (the Email manager builtin), section **Email**.
   - SMS card in a new `notifications` `ui/settings.tsx`, section **SMS**.
   - Both use the shared integration card (provider picker, masked secrets, source badge, test, remove).

## Out of scope

- Inbound email (ticket **106** / **107**).
- Domain verification flows inside AgentOS (admin verifies the sending domain in Resend/Cloudflare; we surface provider errors clearly).

## Done when

- [ ] Email + SMS resolved per org with env fallback
- [ ] Resend, Cloudflare, Twilio configurable from Settings; test connection works
- [ ] Delivery records show org vs platform source
- [ ] Tests: org key used when set, env when unset, invalid key → clear delivery error
- [ ] Docs: notifications env section notes the per-org override
- [ ] `bun run ci` green

## Verify

- Org A configures Resend key → Compose sends via org A key (mock provider in tests)
- Org B unconfigured → uses platform `log` / env provider
- Rotate key in Settings → next send uses the new key without restart
