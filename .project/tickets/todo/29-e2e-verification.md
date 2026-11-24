# 29 — End-to-end verification

**Status:** todo

## Goal

Prove the experiment flows work together.

## Done when

- [ ] Sign-in via builtin auth; protected routes enforce RBAC
- [ ] crm-helper + invoice-bot load in Shell
- [ ] Disable invoice-bot → UI/tools gone; builtins remain
- [ ] Chat/skill `/qualify-lead` and payout HITL approval work
- [ ] Customer BFFs have no DATABASE_URL
- [ ] Tenancy presets (ticket **121**): run the sign-in / org / settings flows once each under `saas`, `internal`, and `customer-facing`

## Notes

Capture any gaps as follow-up tickets in `todo/`.

Deploy-path smoke (healthz, auth session, crm-helper, invoice-bot, files/R2) is ticket **64** — see [`deploy/cloudflare/README.md`](../../../deploy/cloudflare/README.md) Smoke checks.
