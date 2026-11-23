# 73 — Notifications: email and SMS delivery channels

**Status:** done

## Goal

Extend builtin `notifications` beyond in-app toasts with **email** and **SMS** delivery, templates, and delivery status — required by CloseDesk, VendorGate, PlacementOS, and ChannelGuard pilots.

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — cross-platform gap formerly **65**.

## Depends on

- Ticket **61** (durable notifications via db-store) — done
- Ticket **71** (tenancy) — preferred for per-org sender / templates

## Done when

- [x] API to enqueue a notification with channel `in_app` | `email` | `sms` (and optional template id)
- [x] Provider adapters behind env (e.g. Resend/SES + Twilio); local/dev no-op or log sink
- [x] Delivery status stored (`queued` | `sent` | `failed`) and queryable
- [x] In-app channel behavior unchanged for Shell toasts / inbox
- [x] Tests with mocked providers
- [x] Docs: env keys + template conventions

## Notes

- MVP can ship email first; SMS as second channel if timeboxed.
- Do not put provider secrets in `agentos.config.ts` — use `secrets` / env.
- Implemented: Resend + **Cloudflare Email Sending** + Twilio adapters; default `log` sinks; templates `client-reminder` / `digest`; `GET /deliveries/:id`.
