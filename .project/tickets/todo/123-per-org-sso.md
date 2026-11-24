# 123 — Per-org SSO connections

**Status:** todo

## Goal

Let each org sign in through **its own identity provider** (Okta, Entra ID, Google Workspace, any OIDC/SAML IdP). Needed for `saas` and `customer-facing` deployments (ticket **121**), where each customer has its own IdP. Today SSO is one deployment-wide provider from env (`AGENT_OS_EXT_AUTH_SSO_*`), which fits `internal` only.

## Depends on

- Ticket **75** (Better Auth SSO plugin) — done
- Ticket **121** (tenancy presets, `orgAdminCan: 'sso'`)

## Scope

1. **SSO connections per org** — register OIDC and SAML providers bound to an org (Better Auth SSO plugin supports org-scoped providers). Stored by auth; client secrets in the vault under the org.
2. **Domain routing** — verified email domains per org (DNS TXT verification); sign-in with an email on that domain routes to the org's IdP.
3. **Just-in-time membership** — first SSO sign-in creates the user and joins the mapped org with a default role; optional group/claim → role mapping.
4. **Enforcement** — per org "SSO required" toggle: password sign-in blocked for that org's domain users (operators exempt).
5. **Settings** — Organization › SSO section: add connection (OIDC discovery URL or SAML metadata), test sign-in, domains, role mapping. Visible to operators, and to org admins when `orgAdminCan` includes `sso`.
6. **Deployment-wide env SSO** stays as the default connection (used by `internal`).

## Done when

- [ ] Org-scoped OIDC + SAML connections with secrets in the vault
- [ ] Domain verification + routing at sign-in
- [ ] JIT membership + role mapping; "SSO required" enforcement
- [ ] Settings section gated by tenancy delegation
- [ ] Tests with mocked IdPs for two orgs on different domains
- [ ] Docs: per-org SSO setup (Okta, Entra, Google Workspace)
- [ ] `bun run ci` green

## Verify

- Org A (`acme.com`, mocked OIDC) and org B (`globex.com`, mocked SAML): each user lands in the right org through the right IdP
