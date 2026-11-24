# 126 — (Later) Per-org white-label

**Status:** todo

## Goal

Let a `customer-facing` deployment show **each client customer its own branding** — logo, name, colors, and optionally a custom domain — on top of the deployment branding in `agentos.config.ts`.

## Depends on

- Ticket **44** (branding in `agentos.config.ts`) — done
- Ticket **121** (tenancy presets)

## Scope

1. **Org branding** — per-org overrides for `appName`, `logoUrl`, `faviconUrl`, theme colors; stored in db-store, assets in files.
2. **Resolution** — signed-in users see their org's branding; sign-in pages use the custom domain's org branding, else deployment branding.
3. **Custom domains** — map a hostname to an org (e.g. `portal.acme.com`); domain verification; deployment docs for Cloudflare custom hostnames.
4. **Emails** — notification templates use the org's branding and from-address (with ticket **105** integrations).
5. **Settings** — Organization › Branding, for operators (and org admins if delegated).

## Done when

- [ ] Per-org branding overrides applied in Shell, sign-in, and emails
- [ ] Custom domain → org mapping with verification
- [ ] Tests: two orgs render different branding; unknown domain falls back to deployment branding
- [ ] `bun run ci` green
