import type { UiViewName } from '@agentos/core/vite/lib/types';

/** URL prefix for virtual iframe HTML entries. */
export const EXT_HTML_PREFIX = '/__agentos/ext';

const VIEW_NAMES = new Set<UiViewName>(['page', 'sidebar', 'widget']);

export type ParsedExtHtmlPath = {
  extensionId: string;
  view: UiViewName;
};

/**
 * Parse `/__agentos/ext/<id>/<view>.html` (pathname only; query ignored).
 * Returns null when the path is not an AgentOS iframe entry.
 */
export function parseExtHtmlPath(pathname: string): ParsedExtHtmlPath | null {
  const path = pathname.split('?')[0] ?? pathname;
  const match = /^\/__agentos\/ext\/([^/]+)\/(page|sidebar|widget)\.html$/.exec(
    path,
  );
  if (!match) return null;
  const extensionId = match[1];
  const view = match[2] as UiViewName;
  if (!extensionId || !VIEW_NAMES.has(view)) return null;
  return { extensionId, view };
}

/**
 * Minimal HTML shell that loads the entry module (and optional stylesheets).
 * `scriptSrc` is `/@id/virtual:...` in Vite dev or the built chunk path in production.
 * `stylesheets` are production CSS asset paths (e.g. `/assets/globals-….css`);
 * Vite injects CSS in dev, so this is empty there.
 */
export function renderExtHtmlEntry(options: {
  extensionId: string;
  view: UiViewName;
  scriptSrc: string;
  stylesheets?: readonly string[];
}): string {
  const { extensionId, view, scriptSrc, stylesheets = [] } = options;
  const title = `${extensionId} ${view}`;
  const links = stylesheets
    .map(
      (href) =>
        `  <link rel="stylesheet" crossorigin href="${escapeHtml(href)}" />`,
    )
    .join('\n');
  const linkBlock = links ? `\n${links}` : '';
  return `<!DOCTYPE html>
<html lang="en" data-agentos-ext>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>${linkBlock}
  <script>
    (function () {
      try {
        document.documentElement.dataset.agentosExt = '';
        var p = new URLSearchParams(location.search);
        var t = p.get('theme') || localStorage.getItem('agentos-theme') || 'dark';
        if (t === 'light' || t === 'dark') {
          document.documentElement.classList.add(t);
        }
      } catch (_) {}
    })();
  </script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${escapeHtml(scriptSrc)}"></script>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function isUiViewName(value: string): value is UiViewName {
  return VIEW_NAMES.has(value as UiViewName);
}
