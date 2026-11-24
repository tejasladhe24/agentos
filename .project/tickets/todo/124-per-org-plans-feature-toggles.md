# 124 — Per-org plans and feature toggles

**Status:** todo

## Goal

Let operators decide **which extensions and features each org gets**, through named plans. Needed for `saas` (your pricing tiers) and likely `customer-facing` (the client sells tiers to its customers). Today extension enable-state is **deployment-wide** (`agentos_gateway` platform collection, ticket **60**).

## Depends on

- Ticket **60** (durable enable-state) — done
- Ticket **121** (tenancy presets, operators)

## Scope

1. **Plans** — operator-defined plans in config or db-store: `{ id, name, extensions: [...], limits: { seats?, storageBytes?, aiTokensPerMonth?, … } }`. Each org is assigned a plan; a default plan for new orgs (`saas` sign-up).
2. **Effective enablement** — an extension is available to an org when it is enabled deployment-wide **and** included in the org's plan **and** not disabled by an org-level override. Registry, Activity Bar, Settings sections, agent tools, and `/api/ext/<id>/*` all respect it (API returns 403 `feature_not_in_plan`).
3. **Limits** — seats and storage enforced here; AI/email usage limits integrate with ticket **125**.
4. **Operator UI** — Deployment settings: plans editor, org list with plan assignment and per-org overrides.
5. **Org view** — org admins see their plan and what is included (read-only).
6. **`internal` preset** — plans hidden; everything enabled deployment-wide behaves as today.

## Done when

- [ ] Plans + per-org assignment + overrides
- [ ] Shell, registry, tools, and APIs respect per-org enablement
- [ ] Seat and storage limits enforced
- [ ] Operator and org-admin UIs
- [ ] Tests: org on a plan without extension X cannot see or call X; limits enforced
- [ ] `bun run ci` green

## Verify

- Two orgs on different plans see different Activity Bar items; calling a non-included extension API returns 403
