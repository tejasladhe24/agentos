# 75 — Auth: SAML/OIDC SSO + role admin API

**Status:** todo

## Goal

Add **SSO** (SAML and/or OIDC via a hosted provider) and **role / permission management APIs** so TrustDesk V1 NFRs (admin, reviewer, sales, read-only, external viewer) are configurable without code changes.

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — TrustDesk NFRs; gap formerly **60**.

## Depends on

- Ticket **55** / **56** (auth production + Postgres) — done
- Ticket **71** (tenancy) — roles should be org-scoped

## Done when

- [ ] OIDC and/or SAML sign-in path documented and tested (WorkOS/Auth0/similar via Better Auth plugins or equivalent)
- [ ] Admin API (permission-gated) to list/assign roles and permissions per org member
- [ ] External / limited roles usable with ticket **72** signed links where appropriate
- [ ] Existing email/password path remains
- [ ] Tests for SSO callback happy path (mocked) + role assignment denial without permission
- [ ] Docs: env + IdP setup for demo

## Notes

- Prefer Better Auth’s existing plugin surface over a parallel SSO stack.
- Shell account settings may surface “linked SSO” later; not required for this ticket’s Done when.
