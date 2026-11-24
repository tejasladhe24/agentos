# 102 — Keep Shell views mounted after first open

**Status:** done

## Goal

Switching Activity Bar entries (extensions, Approvals, Home, Settings, extension pages) must never unmount a view that was already opened. Ongoing UI work in an extension iframe or Shell panel survives navigation.

## Depends on

- Ticket **39** (sidebar context + Shell panels) — done
- Ticket **46** (hide empty active UI contribs) — done
- Ticket **48** (builtin settings) — done

## Done when

- [x] `ShellRoot` always renders the `ResizablePanelGroup`; no content collapses the sidebar panel and disables/hides the handle instead of swapping to a plain `div`
- [x] Main workspace views are never unmounted once opened (Home + main canvas eager as before; Settings via `KeepAlive`)
- [x] Sidebar hosts (Extensions manager, Approvals, Home sidebar, Settings nav, extension sidebars) mount on first open and are hidden when inactive
- [x] Files builtin page keeps the browser mounted when the detail pane opens/closes (same always-render resizable pattern)
- [x] Tests cover the stable layout tree + lazy `KeepAlive`; DOM identity verified live (no DOM test lib in repo)

## Notes

Root cause: `ShellRoot` toggled between `ResizablePanelGroup` and a plain `div` on `sidebarColumnHasContent`. Opening Extensions / Approvals while the active view had no sidebar flipped the branch and remounted `MainWorkspace` (all page iframes).

## Verify

- `bun test packages/core/src/shell`
- `bun run ci` before PR
- Live UI: type in an extension page with no sidebar, switch through Extensions / Approvals / Home / Settings, return — state intact
