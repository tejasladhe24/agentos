# 117 — (Later) Files: bulk move between mounts

**Status:** todo

## Goal

Let an operator — or an org admin when the deployment delegates `storage` (`orgAdminCan`, ticket **121**) — move **all files** (or a folder) from one org mount to another as a background job — e.g. before disconnecting a mount, or migrating from platform storage to the org's own bucket.

## Depends on

- Ticket **110** (mounts, reference counting)
- Ticket **74** (durable jobs) — done
- Ticket **121** (tenancy presets — who may manage org storage)

## Scope

1. Durable job via builtin `events`: copy each file, verify size/checksum, rewrite references (`files://` in metadata and referencing records), delete the source only after success.
2. Progress, pause/resume, retry failed items; audit entry on start/finish.
3. UI in Settings › Files: "Move files to…" on a mount, with progress.

## Done when

- [ ] Job moves files and rewrites references with no broken links
- [ ] Interrupted job resumes without duplicates
- [ ] Tests with two mocked mounts
- [ ] `bun run ci` green
