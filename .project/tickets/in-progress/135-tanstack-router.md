# 135 — Shell routing with TanStack Router (URL-addressable views, nested shell layout)

**Status:** in-progress

## Goal

Replace the Shell's ad-hoc navigation (single-path `AuthGate` + `activeView` in Zustand + hash/`localStorage` side channels) with **TanStack Router** so every workspace view has a real URL: deep links, browser back/forward, refresh restoring the exact page, and a single routing system for auth, public portals, Not Found, and the Shell.

The Shell chrome is a **nested layout** (`_shell`) that never remounts on navigation. Extension UIs stay in sandboxed iframes that are kept mounted (`MainCanvas` / `KeepAlive`); the router owns the **URL and layout**, not extension content. Route children render nothing — the Zustand store stays the source of truth for rendering, and a small controller keeps URL and store in sync both ways.

## Depends on

- Ticket **43** (AuthGate + `agentos.config.ts`) — done; this ticket supersedes its "no router dependency" decision
- Ticket **49** (Shell Not Found page) — done; this ticket supersedes its "do not invent a full client router" note
- Ticket **72** (public extension routes) — done
- Ticket **101** (extension-registered settings) — done
- Ticket **134** (right sidebar contribution) — in progress; unaffected (right sidebar stays store-driven)

## Route table

| Path                                                         | Layout                   | Behavior                                                                                         |
| ------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------ |
| `/`                                                          | `_shell`                 | Home (`activeView = 'home'`)                                                                     |
| `/ext/$extensionId`                                          | `_shell`                 | Extension page; id validated against the registry (`ui/page`), else Not Found                    |
| `/settings?section=<key>&entry=<id>`                         | `_shell`                 | Settings view; `section` ↔ `settingsKey`, `entry` ↔ `settingsEntryId`                            |
| `/login`, `/register`, `/forgot-password`, `/reset-password` | root (outside Shell)     | Flag-gated (`allowSignUp` / `allowPasswordReset`); signed-in users redirect to `afterSignInPath` |
| declared `meta.public.ui` paths (`/p/demo`, `/p/trust/*`)    | root (outside Shell)     | Public portal iframe, no session; matched with the existing `matchPublicExtensionRoute`          |
| anything else                                                | root `notFoundComponent` | Not Found page (outside Shell chrome)                                                            |

`_shell` `beforeLoad` requires a session (redirect to `/login?next=<path>` when missing) and populates `sessionRoles`. Reserved gateway prefixes (`/api`, `/_public`, `/__agentos`) stay owned by the gateway and are never SPA routes.

## Scope

1. **Dependency:** add `@tanstack/react-router` to `@agentos/core`.
2. **Pure routing helpers** (`packages/core/src/shell/lib/routing/`): `viewToPath` / `pathToView`, string-only search parse/stringify (so numeric-looking reset tokens are never rewritten by the default JSON search codec), URL↔store target helpers.
3. **Router** (`packages/core/src/shell/components/routing/`): `createAppRouter` (code-based route tree; public portal routes derived from the registry) + `AppRouter` component replacing `AuthGate`. Pending screen keeps `data-agentos-auth-loading`.
4. **URL ↔ store sync controller** (`startRouteStoreSync` / `bootstrapRouteStore`): history change → `setActiveView` / `setSettingsKey`; store change → `history.push` (view change) or `replace` (settings section/entry change). Deep link wins on first load; `/` on first load still restores the last Activity Bar selection (replace). Never navigates away from non-workspace paths (auth, portal, Not Found).
5. **`navigateApp`** delegates to the active router (falls back to `pushState` + `popstate` when none is registered). `isKnownAppPath` accepts `/`, `/settings`, `/ext/<id>`; `loginPathWithNext` now carries `?next=` for deep links; `readNextParam` rejects protocol-relative (`//host`) values.
6. **`mountShell`** renders `AppRouter`; `restoreStoredActivity` only applies when the URL is `/` (never overrides a deep link).
7. **Remove** `AuthGate` (logic moved into the router); migrate its tests.
8. **Docs:** `.project/docs/architecture.md` (SPA paths table + Shell routing section), ticket index README.

## Out of scope

- Routing **inside** extension iframes (each extension owns its own navigation; Shell only forwards the settings hash as today).
- Putting transient chrome state in the URL (sidebar open/closed, right sidebar, Extension Manager / HITL panels, chat).
- Per-extension generated routes / file-based route codegen (extensions are runtime-discovered; one `/ext/$extensionId` route validates against the registry).
- A `host.navigation.openView()` HostAPI method (follow-up).
- Registering the router type globally (`declare module '@tanstack/react-router'`).

## Done when

- [x] `@tanstack/react-router` is a dependency of `@agentos/core`; Shell routing runs on it with no remaining `AuthGate` pathname/`popstate` logic
- [x] Activity Bar clicks update the URL (`/`, `/ext/<id>`, `/settings`); browser back/forward and refresh restore the same view; deep links load directly
- [x] Extension iframes and Shell chrome are **not** remounted when navigating between workspace views (route children render `null`; layout stays mounted)
- [x] Unauthenticated access to a workspace path redirects to `/login?next=…` and returns to it after sign-in; `//host` style `next` values are rejected
- [x] Unknown paths (`/totally-missing`, `/__public/…`, `/ext/<unknown>`) render the Not Found page outside Shell chrome; `/_public/<missing>` still 404s at the gateway
- [x] Public auth routes respect `allowSignUp` / `allowPasswordReset`; declared public extension portals render without a session
- [x] Settings section/entry are reflected in `/settings?section=&entry=` and restored from it
- [x] Unit tests: view↔path mapping, search codec, `isKnownAppPath` / `loginPathWithNext` / `readNextParam`, URL↔store sync controller, route table (not-found, public portal, auth redirect, authed shell, unknown extension)
- [x] `bun run ci` passes

## Verify

- `pnpm install` (lockfile updated)
- `bun run ci`
- Local `agentos dev` → click Activity Bar items and confirm the URL changes; use browser back/forward; refresh on `/ext/<id>` and `/settings?section=…`; open a deep link while signed out and confirm the `/login?next=` round trip; visit `/totally-missing` and `/ext/nope` for Not Found

## Implementation notes

- Router: `packages/core/src/shell/components/routing/app-router.tsx` (`createAppRouter` / `AppRouter`). Pure helpers and the URL↔store controller live in `packages/core/src/shell/lib/routing/`.
- Route tests run TanStack in client mode (`router.update({ isServer: false, origin })`) against in-memory history, because bun has no `document` and server mode makes `navigate()` a no-op and does not follow redirects.
- Live QA (local `agentos dev`): deep links, Activity Bar clicks, `popstate` handling, signed-out `/login?next=` round trip, Not Found, and bare `/` resuming the last selection all verified; all 17 extension iframes kept the same DOM nodes and `contentWindow` across navigation. Real Back-button traversal could not be driven from the automation browser (Chrome skips script-created history entries without user activation); it is covered by unit tests with real in-memory history plus a dispatched `popstate` in the browser.
- Known limitation: `/settings` without `?section=` shows the stored section; the param appears once a section is selected.
