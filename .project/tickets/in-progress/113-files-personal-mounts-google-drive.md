# 113 — Files: personal mounts + Google Drive

**Status:** in-progress

## Goal

Let each user connect **their own Google Drive** as a **personal mount**, visible only to them. Introduces the personal-mount flow that OneDrive (ticket **114**) reuses.

## Depends on

- Ticket **110** (mounts foundation)
- Ticket **104** (user-owned secrets)
- Ticket **78** (OAuth kit) — done

## Scope

### 1. Personal mounts

- **Settings › Files › My connected drives** (every user): connect / reconnect / disconnect their accounts.
- Personal mount visible only to its owner in the sidebar; never visible to admins.
- Tokens stored as user-owned secrets (ticket **104**).
- Background jobs and inbound email never read or write personal mounts. AI agents may read a personal mount only while running as that user.
- On member removal (`secrets.user_purged`), the mount is removed.

### 2. Google Drive adapter (`live` mode)

- OAuth with the platform's Google OAuth app (env: client id/secret — platform-wide). Scopes: least privilege that still allows browse/upload (decide between `drive.file` and full `drive`; document the trade-off and Google verification requirements).
- Path ↔ file-id translation with a cache; handle duplicate names in one folder (disambiguate in the UI, address by id internally).
- **My Drive** and **Shared drives** as top-level folders of the mount.
- Google Docs / Sheets / Slides have no bytes: list them, open in Google, and export (PDF / DOCX / XLSX / PPTX) on download or when copied to an org mount.
- Native trash for delete; versions where available; quota shown in Storage.
- Rate-limit handling (backoff on 403/429).

### 3. UI

- Provider icon, "personal" marker, reconnect prompt when the token expires or is revoked.
- "Copy to org storage" action on personal files.

## Done when

- [x] User connects Google Drive; mount appears only for that user
- [x] Browse, upload, download, delete (trash), export Docs formats
- [x] Copy to org mount works; no org record points at personal files
- [x] Token refresh + revoked-token reconnect flow
- [x] Tests with mocked Drive API: path/id mapping, duplicates, export, isolation from other users
- [x] Docs: Google OAuth app setup (platform), scopes, verification notes
- [x] `bun run ci` green

## Verify

- User A connects Drive → sees it; user B and an admin do not
- Copy a Google Doc to the org mount → stored as an exported file
