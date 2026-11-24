# 118 — (Later) Per-org OAuth app credentials

**Status:** todo

## Goal

Let an org use **its own OAuth app** (client id + secret) for an OAuth provider instead of the platform's app — common for enterprises that require their own Google Workspace / Entra app, or for extension integrations.

## Depends on

- Ticket **103** (integrations foundation)
- Ticket **78** (OAuth kit) — done

## Scope

1. Integration shape `oauth.app` per provider: secrets `clientSecret`; settings `clientId`, optional token/authorize URLs, tenant.
2. OAuth kit picks the org's app when configured, otherwise the platform app (env).
3. Settings section for admins; redirect URI shown read-only.
4. Existing connections keep working; switching apps prompts users to reconnect.

## Done when

- [ ] OAuth flows use org app when set, platform app otherwise
- [ ] Tests for both paths
- [ ] `bun run ci` green
