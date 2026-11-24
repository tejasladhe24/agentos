# 110 — Files: storage mounts foundation

**Status:** todo

## Goal

Turn the `files` builtin from **one storage backend per deployment** into **multiple mounted storages per org**. The sidebar lists each mount instead of a single "My Files". This ticket builds the model, adapter interface, references, and UI frame using only the existing backends (platform filesystem / S3). New backends come in tickets **111**–**114**.

## Depends on

- Ticket **96** (Files Drive UI)
- Ticket **101** (Settings › Files section)
- Ticket **103** (integrations foundation — mount credentials are `files.mount` integration instances)

## Today

- `BlobStoreBackend = 'filesystem' | 's3'`, chosen at boot from env.
- `BlobStore` is path-based: `put`, `get`, `delete`, `list` (prefix), `copy`.
- Metadata index (`ObjectMetaRecord`) per org in db-store.
- Sidebar: fixed **My Files / Bin / Storage**.

## Scope

### 1. Mount model

- **Mount** = `{ id, kind: 'org' | 'personal', ownerUserId?, provider, name, isDefault, status }`, stored as `files.mount` integration instances (ticket **103**).
- **Platform mount** (`id: "platform"`) is built in, always present, backed by the existing env storage.
- **Org mounts** are added by admins and visible to everyone with file access. **Personal mounts** (ticket **113**) are visible only to their owner.
- One **org** mount is the default upload target. Personal mounts can never be the org default.

### 2. Adapter interface

- Generalize `BlobStore` into a `StorageAdapter` with declared **capabilities**: `serverSideCopy`, `nativeFolders`, `nativeTrash`, `versions`, `maxFileSize`, `exportFormats`, `quota`.
- **Index mode** per adapter: `indexed` (AgentOS is the only writer; db-store index is the record — buckets, upload services) or `live` (provider is the record; list live with a short cache — drives).
- UI hides or adapts actions based on capabilities (e.g. Bin uses native trash when available).
- Adapter registry so tickets **111**–**114** plug in providers without touching the core flow.

### 3. File references

- Canonical reference: `files://<mountId>/<path>`. Metadata records gain `mountId`.
- Legacy keys (no mount) resolve to the platform mount; backfill `mountId: "platform"` lazily on read.
- Update `@agentos/core/api/files`, Python `agentos.files`, `inbound-email` attachments, and `ai` attachment resolution to accept and return the new references.
- Background/no-user callers (inbound email, jobs) may only write to **org** mounts.

### 4. Cross-mount operations

- Move/copy within a mount → server-side copy when supported.
- Across mounts → stream download + upload (with size limits and progress).
- Sharing a file from a personal mount to the org = copy into an org mount (no org record points at a personal mount).

### 5. Safety rules

- A mount cannot be removed while files or other records reference it (show the count).
- Rotating a mount's credentials is fine; changing its bucket/endpoint while it holds files is blocked — add a new mount instead.

### 6. UI

- **Sidebar:** "Mounted storage" section listing visible mounts (provider icon, name, disconnected warning badge), then **Bin** and **Storage** as views spanning all mounts. Replaces "My Files".
- **Breadcrumbs / browser:** root is the selected mount; URL state includes `mountId`.
- **Settings › Files:** **Storage backends** list (org mounts: name, provider, status, default badge, usage; add / test / set default / rename / disconnect) — only the platform mount exists until ticket **111**. Space reserved for **My connected drives** (ticket **113**). Bin retention stays.

## Out of scope

- New providers (tickets **111**–**114**, **116**).
- Moving all files between mounts in bulk (ticket **117**).

## Done when

- [ ] Mount model with built-in platform mount; existing files keep working
- [ ] `StorageAdapter` interface with capabilities + index mode; filesystem and S3 ported
- [ ] `files://<mountId>/<path>` references across files, inbound-email, ai, TS + Python kits
- [ ] Cross-mount copy/move; removal guarded by reference count
- [ ] Sidebar lists mounts; Settings › Files shows Storage backends
- [ ] Tests: legacy key compatibility, capability-driven UI, removal guard, background writes only to org mounts
- [ ] Docs: `builtins.md` files section (mounts, references, capabilities)
- [ ] `bun run ci` green

## Verify

- Existing org with files → everything still browsable under the platform mount
- Inbound email attachment lands with a `files://platform/...` reference
