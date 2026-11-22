# 58 — Root Dockerfile + `.dockerignore`

**Status:** in-progress

## Goal

Ship a single production container image that installs the monorepo, builds the sample consumer (`examples/client-app`), and runs `agentos start` on port **8080**. This image is the portable artifact for Cloudflare Containers, Cloud Run, ECS, and EKS.

## Depends on

- Ticket **54** (`agentos start`)
- Ticket **51** (clean / uv sync postinstall) — done

## Done when

- [x] Root `Dockerfile` based on Bun image; installs pnpm + uv/Python as needed
- [x] `pnpm install --frozen-lockfile` + consumer `agentos build` (or equivalent)
- [x] `CMD` runs `agentos start`; `EXPOSE 8080`
- [x] `.dockerignore` excludes `node_modules`, `dist`, `.venv`, `.git`, caches
- [x] Documented local verify: `docker build` + `docker run -p 8080:8080 --env-file …`
- [x] No Cloudflare/Wrangler tooling baked into the image

## Notes

- Prefer building `examples/client-app` as the reference consumer; note how FDEs retarget the build context later.
- ARM vs amd64: document `--platform` for the target cloud CPU.
