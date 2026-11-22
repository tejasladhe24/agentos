# 67 — Extension iframe production CSS links

**Status:** in-progress

## Goal

Production extension iframe HTML (`/__agentos/ext/<id>/<view>.html`) must include `<link rel="stylesheet">` tags for CSS collected from the entry chunk graph. Without them, widgets/pages render unstyled after Vite build/deploy (FOUC / browser default serif), while Vite dev still looks fine because it injects CSS via the module graph.

## Depends on

- Ticket **12** (virtual iframe entries / `generateBundle` HTML emit)
- Ticket **6** (extension host iframes)

## Done when

- [x] `renderExtHtmlEntry` accepts optional `stylesheets` and emits stylesheet links
- [x] `generateBundle` collects entry + transitive `viteMetadata.importedCss` and passes them into the HTML shell
- [x] Unit tests for `collectEntryCss` and stylesheet HTML emit
- [x] Built `dist/__agentos/ext/demo/widget.html` includes `/assets/globals-….css`

## Notes

- Root cause: custom HTML emit only linked the JS entry; Vite’s own HTML plugin never runs for these virtual documents.
- Verify: `bun test packages/core/src/vite/tests/html-entry.test.ts packages/core/src/vite/tests/collect-entry-css.test.ts`; `bun run build` in `examples/client-app` and inspect widget HTML.
