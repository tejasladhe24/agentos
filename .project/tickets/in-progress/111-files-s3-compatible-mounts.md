# 111 — Files: S3-compatible org mounts (BYOK presets)

**Status:** in-progress

## Goal

Let org admins add **their own buckets** as org mounts — several per org — using presets for popular S3-compatible services.

## Depends on

- Ticket **110** (mounts foundation)
- Ticket **57** (S3 backend) — done

## Scope

1. **Presets** on the existing S3 adapter (endpoint template, region rules, path-style flag, help text):

   | Preset               | Notes                                                         |
   | -------------------- | ------------------------------------------------------------- |
   | AWS S3               | Endpoint optional; region required                            |
   | Cloudflare R2        | `https://<accountId>.r2.cloudflarestorage.com`, region `auto` |
   | Google Cloud Storage | `https://storage.googleapis.com`, HMAC keys                   |
   | Backblaze B2         | S3 endpoint per region                                        |
   | Wasabi               | Region endpoints                                              |
   | DigitalOcean Spaces  | `<region>.digitaloceanspaces.com`                             |
   | MinIO / custom       | Custom endpoint, path-style                                   |
   | Supabase Storage     | S3 endpoint + keys from project settings                      |

2. **Integration shape** — `files.mount` / `s3`: secrets `accessKeyId`, `secretAccessKey`, optional `sessionToken`; settings `preset`, `bucket`, `endpoint`, `region`, optional `prefix` (mount a sub-path of a bucket).
3. **Test connection** — list + put/delete a probe object under the mount prefix; report missing permissions precisely.
4. **Settings UI** — "Add backend" → preset picker → form → test → save; set as default.
5. **Capabilities** — `indexed` mode, server-side copy within the same bucket.

## Done when

- [x] Admin can add multiple bucket mounts from presets
- [x] Test connection catches bad keys / missing permissions
- [x] Mounts appear in the sidebar; uploads go to the default mount
- [x] Tests: preset endpoint resolution, per-mount isolation (mocked S3)
- [x] `bun run ci` green

## Verify

- Add an R2 mount and a MinIO mount → both listed → upload to each → files land in the right bucket
