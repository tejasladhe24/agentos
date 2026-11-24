# 112 — Files: UploadThing and Vercel Blob org mounts

**Status:** done

## Goal

Add **UploadThing** and **Vercel Blob** as org mount providers.

## Depends on

- Ticket **110** (mounts foundation)

## Scope

1. **UploadThing adapter**
   - Flat storage (file keys, no folders): folders are virtual, kept in the AgentOS metadata index (`indexed` mode).
   - No server-side copy: copy/move within the mount = re-upload or index-only rename (path lives in our index, object key unchanged).
   - Secrets: `token` (UploadThing API token). Settings: app id if required.
2. **Vercel Blob adapter**
   - Path-like pathnames; `list` with prefix; `copy` supported.
   - Secrets: `readWriteToken`. Settings: optional store id, access (`public` vs `private` if supported).
3. **Test connection** for both — upload/delete a probe file.
4. **Capabilities** declared accurately (size limits, copy support).
5. **Settings UI** — both appear in the "Add backend" provider picker.

## Done when

- [x] Both providers addable, testable, browsable, uploadable
- [x] Virtual folders work on UploadThing; rename/move behaves correctly
- [x] Tests with mocked provider APIs
- [x] `bun run ci` green

## Verify

- Add an UploadThing mount → create folder → upload → move file between folders → download
