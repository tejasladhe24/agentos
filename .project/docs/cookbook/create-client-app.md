# Cookbook — Create a client app

Scaffold a new AgentOS **consumer app** from repo-root [`templates/`](../../../templates/).

## Command

```bash
# From the monorepo root (recommended destination: examples/)
bun packages/core/bin/agentos create examples/my-app --template minimal
# or, if agentos is on PATH via workspace:
agentos create examples/my-app --template minimal
```

| Flag         | Meaning                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `<dir>`      | New folder name/path (e.g. `examples/my-app`). Package `name` becomes the basename (`my-app`). |
| `--template` | `minimal` (default), `with-extension`, or `with-service`                                       |

Fails if the target directory already exists.

## Templates

| Id               | What you get                                                  |
| ---------------- | ------------------------------------------------------------- |
| `minimal`        | Shell host, empty `extensions/`, `agentos.config.ts`          |
| `with-extension` | + stub Bun extension `starter` (port 6110)                    |
| `with-service`   | + extension UI + in-app Python `services/starter` (port 6111) |

`agentos.config.ts` (`defineConfig` from `@agentos/core/config`) holds FDE app settings: auth gate flags, **branding** (`appName`, `logoUrl`, `faviconUrl`, optional fonts), and builtin knobs. Put logo/favicon files in consumer `public/` — the gateway serves them at `/_public/<path>` (e.g. `logoUrl: '/_public/logo.svg'`). Missing files under `/_public/` return HTTP 404 from the gateway (not the SPA). Secrets stay in `src/env.ts` (never in branding).

Public auth is framework-owned: `/login`, `/register`, `/forgot-password`, `/reset-password` gate the Shell. The Auth Activity Bar secondary item opens **account settings**: left sidebar navigates Profile / Roles / Security / Session in the main panel — not app/platform preferences (those belong to the Settings builtin / topbar). Unknown browser paths (anything other than `/` or those auth routes) render a framework **Not Found** page outside Shell chrome — e.g. `/totally-missing` or a `/__public/…` typo (double underscore).

`examples/client-app` remains the kitchen-sink **demo** — do not clone it for new apps.

## After create

v1 apps use `workspace:*` for `@agentos/core` / `@agentos/ui`. Create under `examples/` (already in `pnpm-workspace.yaml`) or add the path to the workspace.

```bash
pnpm install
cd examples/my-app
agentos dev
```

For `with-service`, also `uv sync` inside `services/starter` (see that template’s README). Outside-monorepo create / published npm packages are not supported yet.

## Next

- [Add a Bun/TS extension](./add-extension.md)
- [Concepts](../concepts.md) — app vs extension vs service
