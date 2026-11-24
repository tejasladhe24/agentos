# 114 — Files: OneDrive and SharePoint personal mounts

**Status:** todo

## Goal

Let users connect **OneDrive** (and SharePoint document libraries they can access) as personal mounts, through Microsoft Graph.

## Depends on

- Ticket **113** (personal mounts flow)

## Scope

1. **OAuth** with the platform's Microsoft Entra app (env: client id/secret, tenant `common` — platform-wide). Delegated scopes for Files read/write and offline access.
2. **Graph adapter (`live` mode)**
   - Personal OneDrive drive, plus SharePoint sites/libraries the user follows or can access, as top-level folders.
   - Graph supports path addressing (`/root:/path:`) — use it, with id caching for performance.
   - Upload sessions for large files; native recycle bin; versions; quota.
   - Throttling (429 + `Retry-After`) handling.
3. **Office files** are regular bytes (no export needed).
4. **UI** — appears in My connected drives; same personal-mount behavior as ticket **113**.

## Done when

- [ ] User connects Microsoft account; OneDrive + SharePoint libraries browsable
- [ ] Upload (incl. large files), download, delete, copy to org mount
- [ ] Token refresh + reconnect flow
- [ ] Tests with mocked Graph API
- [ ] Docs: Entra app registration (platform)
- [ ] `bun run ci` green

## Verify

- Connect a Microsoft account → browse OneDrive → upload a 200 MB file → copy it to an org mount
