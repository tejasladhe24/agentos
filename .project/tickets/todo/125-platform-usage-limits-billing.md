# 125 — Usage metering, limits, and billing hooks for platform keys

**Status:** todo

## Goal

When an org uses the **platform's** keys (no BYOK), the deployment owner pays — you in `saas`, the client in `customer-facing`. Meter that usage, enforce limits per plan, and expose hooks for billing.

## Depends on

- Ticket **103**–**109** (integrations with `source: 'org' | 'platform'`; `ai.usage` audit entries) — done
- Ticket **124** (plans and limits)

## Scope

1. **Metering** — durable per-org counters by period for platform-sourced usage: AI tokens (input/output by model), emails sent, SMS sent, storage bytes on the platform mount. BYOK usage recorded separately (visible, not limited).
2. **Limits** — plan limits (ticket **124**) checked before platform-sourced calls; over-limit returns a clear error (`usage_limit_reached`) and suggests BYOK or upgrading. Soft-limit warnings at a threshold (notification to org admins).
3. **Usage views** — org admins see their usage this period; operators see usage across orgs (export CSV).
4. **Billing hooks** — events (`usage.period_closed`, `usage.limit_reached`) and an export API so a billing system (e.g. Stripe metered billing) can be wired by the deployment owner; no payment provider built into core.
5. **Presets** — `internal`: metering on (visibility), limits off by default.

## Done when

- [ ] Per-org metering of platform-sourced AI, email, SMS, storage
- [ ] Plan limits enforced with clear errors and soft warnings
- [ ] Org and operator usage views + export
- [ ] Billing events/API documented
- [ ] Tests: platform usage counted, BYOK usage not limited, limit blocks further platform calls
- [ ] `bun run ci` green

## Verify

- Org on a plan with 1,000 AI tokens: calls stop with `usage_limit_reached` after the limit; adding an org AI key lets calls continue
