# 58 — Root Dockerfile + `.dockerignore`

**Status:** todo

## Goal

Ship a single production container image that installs the monorepo, builds the sample consumer (`examples/client-app`), and runs `agentos start` on port **8080**. This image is the portable artifact for Cloudflare Containers, Cloud Run, ECS, and EKS.

## Depends on

- Ticket **54** (`agentos start`)
- Ticket **51** (clean / uv sync postinstall) — done

## Done when

- [ ] Root `Dockerfile` based on Bun image; installs pnpm + uv/Python as needed
- [ ] `pnpm install --frozen-lockfile` + consumer `agentos build` (or equivalent)
- [ ] `CMD` runs `agentos start`; `EXPOSE 8080`
- [ ] `.dockerignore` excludes `node_modules`, `dist`, `.venv`, `.git`, caches
- [ ] Documented local verify: `docker build` + `docker run -p 8080:8080 --env-file …`
- [ ] No Cloudflare/Wrangler tooling baked into the image

## Notes

- Prefer building `examples/client-app` as the reference consumer; note how FDEs retarget the build context later.
- ARM vs amd64: document `--platform` for the target cloud CPU.
