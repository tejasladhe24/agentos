import {
  EXT_HTML_PREFIX,
  isUiViewName,
  parseExtHtmlPath,
  renderExtHtmlEntry,
  type ParsedExtHtmlPath,
} from '@agentos/core/gateway/lib/index';
import type { UiViewName } from './types';

export { EXT_HTML_PREFIX, isUiViewName, parseExtHtmlPath, renderExtHtmlEntry };
export type { ParsedExtHtmlPath };

/** Public virtual module id prefix for per-view JS bootstraps. */
export const VIRTUAL_EXT_ENTRY_PREFIX = 'virtual:agentos-ext-entry';

/** Public virtual module id for one extension view. */
export function virtualExtEntryId(
  extensionId: string,
  view: UiViewName,
): string {
  return `${VIRTUAL_EXT_ENTRY_PREFIX}/${extensionId}/${view}`;
}

/** Resolved id with Vite's `\0` virtual prefix. */
export function resolvedVirtualExtEntryId(
  extensionId: string,
  view: UiViewName,
): string {
  return `\0${virtualExtEntryId(extensionId, view)}`;
}

/**
 * Parse `virtual:agentos-ext-entry/<id>/<view>` (with or without `\0` prefix).
 */
export function parseVirtualExtEntryId(id: string): ParsedExtHtmlPath | null {
  const bare = id.startsWith('\0') ? id.slice(1) : id;
  const match =
    /^virtual:agentos-ext-entry\/([^/]+)\/(page|sidebar|right-sidebar|widget|settings)$/.exec(
      bare,
    );
  if (!match) return null;
  const extensionId = match[1];
  const view = match[2] as UiViewName;
  if (!extensionId || !isUiViewName(view)) return null;
  return { extensionId, view };
}

/** Dev/preview script URL that Vite serves for a virtual module id. */
export function virtualExtEntryScriptSrc(
  extensionId: string,
  view: UiViewName,
): string {
  return `/@id/${virtualExtEntryId(extensionId, view)}`;
}
