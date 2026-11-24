# 119 — Files: streaming uploads and a higher upload cap

**Status:** todo

## Goal

Raise the Files upload limit well above today's **10 MiB** by streaming uploads end to end, so mounts that support large files (OneDrive up to 250 GB, S3 multipart, Google Drive resumable) can actually receive them.

## Depends on

- Ticket **110**–**114** (mounts and adapters) — merged

## Today

- `MAX_OBJECT_BYTES = 10 * 1024 * 1024` in `packages/core/builtins/files/api/lib/constants.ts`; `maxUploadBytes()` in `scope-ops.ts` caps every mount at `min(MAX_OBJECT_BYTES, adapter.capabilities.maxFileSize)`.
- `handle-request.ts` reads uploads fully into memory: base64 in a JSON body, or `request.arrayBuffer()`.
- The UI (`files-upload-zone.tsx` / `fileToBase64`) base64-encodes the whole file in the browser.
- Adapters (`StorageAdapter.put`) take a `Uint8Array`.

## Scope

1. **Streaming upload route** — accept a raw request body stream (`Content-Type` + `Content-Length`, no base64) and pass it through without buffering the whole file. Keep the JSON/base64 route for small files and existing clients.
2. **Adapter streaming** — add `putStream(path, stream, { size, contentType })` to the adapter interface (falling back to buffering for adapters that can't stream):
   - S3-compatible: multipart upload via Bun `S3Client` writer.
   - Filesystem: `Bun.write` / file sink.
   - Google Drive: resumable upload session.
   - OneDrive / SharePoint: existing chunked upload sessions fed from the stream.
   - UploadThing / Vercel Blob: their large-file or multipart APIs where available; otherwise keep their documented limits.
3. **Limits** — replace the single constant with a platform max (env, e.g. `AGENT_OS_EXT_FILES_MAX_UPLOAD_BYTES`, sensible default such as 5 GiB) combined with each adapter's `maxFileSize`. Reject early from `Content-Length`; abort mid-stream if exceeded.
4. **Gateway / hosting limits** — check the gateway proxy and `deploy/cloudflare` path don't buffer or cap bodies (Cloudflare request body limits by plan); document the effective limit per deployment.
5. **Browser upload** — send `File` directly (no base64), chunked or with progress via `XMLHttpRequest`/`fetch` upload progress; resume or retry a failed chunk where the adapter supports sessions.
6. **Kits** — `@agentos/core/api/files` and Python `agentos.files` accept streams/file paths for large uploads.
7. **Cross-mount copy/move** — stream between adapters instead of buffering.

## Done when

- [ ] Streaming route + `putStream` on all adapters (or documented buffering fallback)
- [ ] Configurable platform max; per-adapter caps respected; early and mid-stream rejection
- [ ] Browser uploads without base64, with progress
- [ ] Cross-mount copy streams
- [ ] TS + Python kits support large uploads
- [ ] Tests: large mocked uploads don't buffer fully (memory bound), limit enforcement, OneDrive/Drive session paths
- [ ] Docs: effective limits per deployment (local, Docker, Cloudflare)
- [ ] `bun run ci` green

## Verify

- Upload a 200 MB file to a OneDrive mount and to an S3 mount; memory stays flat
- Upload over the platform max → rejected before the body is read
