# 120 — Files: UploadThing listing from the index + SDK cleanup

**Status:** todo

## Goal

Make UploadThing mounts stay fast as they grow, and remove the SDK deprecation warnings.

## Depends on

- Ticket **112** (UploadThing mount) — merged

## Today

- `uploadthing-store.ts` `load()` pages through **every file in the UploadThing app** with `utapi.listFiles` to build a name → file-key map (cached for a short TTL). `find()` reloads the full listing on a miss. Lookups and listings get slower as the mount grows, and an app shared with other software is scanned in full.
- The mount is an `indexed` mount, so the AgentOS metadata index already records each file it uploaded.
- The UploadThing SDK prints deprecation warnings during use.

## Scope

1. **Index as the source of truth** — store the UploadThing file key (and `customId`) on the metadata record at upload time; `get` / `delete` / `copy` / `list` resolve paths through the index, with no `listFiles` call on the hot path.
2. **Reconcile job** — optional background or on-demand job (Settings › Files › mount › "Re-scan") that pages `listFiles` filtered by the AgentOS `customId` prefix to repair index drift (files deleted in the UploadThing dashboard, missing keys). Paged and resumable via builtin `events` jobs.
3. **Backfill** — existing UploadThing mounts get their keys filled in on first access or via the reconcile job.
4. **SDK warnings** — identify which calls trigger the deprecation warnings, move to the current UploadThing SDK APIs (upgrade the package if needed), and make tests fail on new deprecation output if practical.

## Done when

- [ ] Path lookups and listings use the index only (no full-account scans)
- [ ] Reconcile job repairs drift; backfill for existing mounts
- [ ] No SDK deprecation warnings in tests or runtime
- [ ] Tests: lookup without `listFiles`, reconcile adds/removes drifted entries (mocked API)
- [ ] `bun run ci` green

## Verify

- Mocked mount with 10,000 files: opening a folder and downloading a file make no `listFiles` calls
- Delete a file in the (mocked) UploadThing dashboard → Re-scan removes it from the index
