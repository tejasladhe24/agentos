# Architecture

AgentOS is a **convention-over-configuration** extension platform: an empty **Shell** host, **sandboxed UI iframes** (Comlink), and **per-feature HTTP backends** (Bun TS APIs or Python services), plus **driving builtins** for auth, data, cache, and AI.

## High-level

```text
Browser:  Shell (mountShell) + extension UI iframes
    │
    ├─ Comlink (MessageChannel per iframe) ── HostAPI
    │
    └─ HTTP ── Gateway (@agentos/core/gateway fetch handlers)
                  │         ▲
                  │         └─ Vite Connect adapter (@agentos/core/vite) in dev
                  │         └─ Bun.serve / host adapters under deploy/ in prod
                  ├─ /api/agent/*  → control plane → builtin ai / hitl
                  └─ /api/ext/:id/* → proxy → Bun API or Python service
                                              │
                                              └─ clients → builtins
                                                   auth | db-store | cache-store | ai | …
```

## Comlink sandbox

- Each extension `ui/page.tsx` | `sidebar.tsx` | `right-sidebar.tsx` | `widget.tsx` | `settings.tsx` loads in `iframe sandbox="allow-scripts allow-same-origin allow-forms"`.
- App-level `ui/dashboard.tsx` (passed to `mountShell`) is the Home surface, rendered in-process (not an iframe). Optional extension `ui/widget.tsx` cards appear below on Home. Optional `ui/dashboard-sidebar.tsx` is the Home sidebar (also in-process).
- Each extension `ui/right-sheet.tsx` (optional) is a **global** overlay: the Shell renders one `@agentos/ui` right `Sheet` (`RightSheetSlot`) over the workspace, and TopBar `top-bar-end` shows one trigger per enabled extension that contributes it. The open sheet id lives in the Shell store (`activeRightSheet`), not the URL. Unlike `ui/right-sidebar.tsx`, the sheet does not depend on the active extension. See [extensions.md](./extensions.md#right-sidebar-vs-right-sheet).
- Left and right sidebars are **active-extension** hosts: the left column hosts the active extension’s `ui/sidebar.tsx` (or Home’s `dashboardSidebar`, or Settings navigation). Extension Manager and Approvals are full pages in the main canvas, not left-column overlays; the right column hosts the active extension’s `ui/right-sidebar.tsx` (resizable, collapsed by default, controlled via TopBar toggle or `useHostUi()`). When neither applies, the column collapses. Status bar and topbar remain **global** chrome (topbar v1: sidebar toggles, branding; contribution slots reserved).
- Transport: **dual MessageChannel** per iframe (not shared `windowEndpoint` — avoids cross-talk).
- UI uses `@agentos/core/client` hooks; never raw `postMessage`.

## Gateway

- **Core** lives in `@agentos/core/gateway` as portable `(Request) => Response | null` handlers — host-agnostic (no Vite Connect, no `@cloudflare/*`). Platform adapters (Vite Connect bridge, future `deploy/*`) mount the same handlers.
- Discovers builtins + customer extensions via Vite scanner → `virtual:agentos-registry` (dev); production hosts reuse the registry model (see `agentos start`).
- Loads consumer `agentos.config.ts` → `virtual:agentos-config` (auth + branding runtime subset).
- Serves consumer `public/` at `/_public/<path>` (dev + preview/build copy into `dist/_public/`). Missing `/_public/<file>` returns **HTTP 404** with a minimal HTML body (gateway answers before SPA fallback).
- Proxies `/api/ext/:id/*` to upstream from `meta.json` (port, language `bun` | `python`) at `http://127.0.0.1:<port>` (sidecar-friendly). Dual Bun+Python extensions route `/api/ext/:id/_service/*` (or custom `service.mount`) to the Python port with the mount prefix stripped; other paths go to the Bun port.
- Disabled **customer** extensions → 403 + UI unmounted. **Builtins** cannot be disabled.
- **Production:** `agentos start` (after `agentos build`) spawns builtins + customer Bun/Python like `dev` (no Vite), then `Bun.serve` on `PORT` (default **8080**): gateway → static `dist/` (incl. built iframe HTML) → SPA `index.html` fallback. Sets `AGENT_OS_GLOBAL_GATEWAY_URL` to `http://127.0.0.1:<port>`. `GET /healthz` means the gateway process is up (does not probe children; fatal builtin exit shuts down via ProcessManager). Vite preview is not the production server.

## Container image

Root [`Dockerfile`](../../Dockerfile) builds a portable production image (Bun + pnpm + uv/Python): `pnpm install --frozen-lockfile`, `agentos build` for `examples/client-app` (override with `--build-arg CONSUMER_PATH=…`), then `CMD` → `agentos start` on **8080**. No Cloudflare/Wrangler tooling is baked in — cloud adapters live under [`deploy/`](../../deploy/README.md). Headless-browser **worker** images (Playwright) use the optional fragment [`deploy/docker/Dockerfile.playwright.fragment`](../../deploy/docker/Dockerfile.playwright.fragment) — see [services.md](./services.md#headless-browser-image).

```bash
# Match --platform to the target cloud CPU (amd64 vs arm64).
docker build --platform linux/amd64 -t agentos:local .
docker run --rm -p 8080:8080 --env-file .env.docker agentos:local
curl -sS http://127.0.0.1:8080/healthz
```

Pass secrets via `--env-file` (never bake `.env` into the image). Minimum production auth vars: see [builtins.md](./builtins.md) (`AGENT_OS_EXT_AUTH_SECRET`, app origin / auth base URL). Full env checklist: [deploy runbook](../../deploy/README.md).

## SPA paths vs gateway prefixes

| Kind              | Examples                                                   | Who answers                                                                  |
| ----------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Workspace (Shell) | `/`, `/ext/<id>`, `/extensions`, `/settings?section=…`     | `AppRouter` `_shell` layout → Shell (session required; else `/login?next=…`) |
| Public auth       | `/login`, `/register`, …                                   | `AppRouter` → auth pages (outside Shell chrome)                              |
| Public extension  | `/p/demo`, `/p/trust/*` (`meta.public`)                    | `AppRouter` catch-all → public portal iframe (no session)                    |
| Unknown SPA path  | `/totally-missing`, `/ext/<unknown>`, `/__public/…` (typo) | `AppRouter` root `notFoundComponent` → **Not Found** UI (no session)         |
| Reserved gateway  | `/_public/…`, `/__agentos/…`, `/api/…`                     | Gateway handlers (HTTP status); **not** claimed as Shell routes              |

Correct public assets use a **single** underscore: `/_public/<path>`. A double-underscore typo (`/__public/…`) is an unknown SPA path and shows the client Not Found page.

## Shell routing (TanStack Router)

`@agentos/core/shell` owns one router (`createAppRouter` / `AppRouter`, ticket 135):

```text
__root            Not Found (notFoundComponent), no chrome
├─ _shell         pathless layout = ShellRoot; beforeLoad requires a session
│  ├─ /                      Home
│  ├─ /ext/$extensionId      extension page (id validated against the registry `ui/page`; `/ext/hitl` is Approvals)
│  ├─ /extensions            Extension Manager (admin only; non-admins redirect to `/`)
│  └─ /settings              ?section=<extensionId:sectionId>&entry=<id>
├─ /login /register /forgot-password /reset-password   flag-gated, signed-in → afterSignInPath
└─ $              public extension portals (matchPublicExtensionRoute) or Not Found
```

- **The router owns the URL and the layout, not extension content.** `_shell` children render `null`; extension iframes stay mounted in `MainCanvas` / `KeepAlive`, driven by the Zustand store (`activeView`, `settingsKey`), so navigating between views never reloads an iframe.
- **URL ↔ store sync** (`createRouteStoreSync`): history changes → `setActiveView` / `setSettingsKey`; store changes → `history.push` (view change) or `replace` (settings selection). A deep link wins on first load; a bare `/` on first load resumes the last Activity Bar selection (`restoreStoredActivity`, only applied when the URL is `/`). Non-workspace paths (auth, portals, Not Found) are never rewritten.
- **Transient chrome state is not in the URL** (sidebar open/closed, right sidebar, chat). Extension Manager and Approvals are full pages, so their location is in the URL (`/extensions`, `/ext/hitl`).
- **Routing inside an extension iframe is the extension's own.** The Shell only forwards the Settings hash into the settings iframe (`ExtensionFrame` `hash`).
- **`navigateApp(to)`** (auth pages, Not Found) goes through the router; `?next=` is carried for workspace deep links and rejects `//host`-style values.
- **Search codec is string-only** (no JSON coercion) so opaque values such as reset tokens are never rewritten.

## Builtins (platform)

See [builtins.md](./builtins.md). Hard rules:

- Only **db-store** holds SQL credentials (Drizzle).
- Only **cache-store** owns cache.
- Only **auth** (Better Auth) owns identity + RBAC.

## Customer features

- **Extension** folder: `ui/`, `agent/`, optional `api/routes/` (Bun).
- **Service** folder: Python FastAPI under `services/<id>/` when `meta.api.language === "python"` or when a Bun extension declares a sibling `meta.service` link.

## Runtime tooling

| Concern           | Tool                        |
| ----------------- | --------------------------- |
| Workspace install | **pnpm**                    |
| Run TS/JS         | **Bun** (`bun run`, `bunx`) |
| Python services   | **uv** / uvicorn            |
| Host UI build     | Vite (via Bun)              |

## Related ADRs

- [001 pnpm + Bun hybrid](./adr/001-pnpm-bun-hybrid.md)
- [002 Better Auth owns auth+RBAC](./adr/002-better-auth-auth-rbac.md)
- [003 Python services outside extensions](./adr/003-python-services-outside-extensions.md)
- [004 db-store sole SQL owner](./adr/004-db-store-sole-sql-owner.md)
- [005 Comlink MessageChannel](./adr/005-comlink-messagechannel.md)
- [006 Vercel AI SDK v7 owns platform AI](./adr/006-vercel-ai-sdk.md)
