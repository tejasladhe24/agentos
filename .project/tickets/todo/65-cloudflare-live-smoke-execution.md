# 65 — Execute Cloudflare live smoke against deployed BASE_URL

**Status:** todo

## Goal

Run the ticket **64** smoke checklist against a real Worker URL once Cloudflare credentials and a successful deploy exist. Docs already live in [`deploy/cloudflare/README.md`](../../../deploy/cloudflare/README.md) (Smoke checks).

## Depends on

- Ticket **64** (smoke runbook documented)
- Ticket **63** (CI deploy) or a manual `pnpm deploy:cloudflare`
- Wrangler / dashboard access: `CLOUDFLARE_API_TOKEN` (or `wrangler login`) + Worker secrets/vars (Neon, auth secret; R2 for files step)

## Done when

- [x] `$BASE_URL` resolved (workers.dev or custom domain)
- [x] `GET /healthz` → 200
- [x] Auth sign-up / sign-in; session cookie survives reload (or cookie-jar `/api/ext/auth/session`)
- [x] `GET /api/ext/crm-helper/health` → `{ ok: true }`
- [x] `GET /api/ext/invoice-bot/health` → ok
- [ ] Files PUT/GET round-trip if R2 configured (else documented skip)
- [x] Ticket **64** Done-when live boxes checked (or superseded by this ticket’s results)

## Notes

- Production (`main`) `BASE_URL=https://agentos-demo.thatlad.dev`. Staging (`dev`): `https://agentos.thatlad.workers.dev`.
- R2 not enabled on the Cloudflare account (`Please enable R2 through the Cloudflare Dashboard`) — files health returns filesystem backend; enable R2 + S3 credentials, then complete the blob round-trip and check the last box + ticket **64** files item.
