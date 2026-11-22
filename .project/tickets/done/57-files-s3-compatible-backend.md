# 57 — Files S3-compatible backend

**Status:** done

## Goal

Add an S3-compatible blob backend for builtin `files` (via `Bun.S3Client` or equivalent) so uploads persist across container restarts. Same code path works for **Cloudflare R2**, **AWS S3**, and **GCS** (S3-compatible endpoint) — selected only by env, not by Cloudflare-specific APIs in `@agentos/core`.

## Depends on

- Ticket **19** (supporting builtins / files) — done

## Done when

- [x] Local filesystem backend remains default (`AGENT_OS_EXT_FILES_PATH` / temp root)
- [x] When bucket env is set, use S3-compatible client (endpoint + region + credentials)
- [x] Env keys documented and wired through `files` `keys()` / app `createEnv` extends
- [x] Path-traversal protections preserved
- [x] Tests: filesystem backend + mocked or optional S3 integration
- [x] Docs example: R2 vs S3 vs GCS env values (no R2 SDK in core)

## Notes

- Do **not** import `@cloudflare/workers-types` or R2 bindings into builtins — keep portable S3 API.
- Cloudflare ticket **62** only supplies R2 credentials into the container env.
