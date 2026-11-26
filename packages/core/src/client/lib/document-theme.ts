import {
  AGENTOS_THEMES,
  type AgentosTheme,
} from '@agentos/ui/components/theme-provider';

const THEME_SET = new Set<string>(AGENTOS_THEMES);

export function isAgentosTheme(value: unknown): value is AgentosTheme {
  return typeof value === 'string' && THEME_SET.has(value);
}

/** Resolve `?theme=` from a search string; defaults to `dark`. */
export function resolveThemeFromSearch(
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): AgentosTheme {
  const raw = new URLSearchParams(
    search.startsWith('?') ? search : `?${search}`,
  ).get('theme');
  return isAgentosTheme(raw) ? raw : 'dark';
}

/** Mark the document as an extension iframe so globals allow body scroll. */
export function markExtensionDocument(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.agentosExt = '';
}

/** Apply theme class on `<html>` (FOUC already handled in HTML shell). */
export function applyDocumentTheme(theme: AgentosTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  markExtensionDocument();
  for (const name of AGENTOS_THEMES) {
    root.classList.remove(name);
  }
  root.classList.add(theme);
  root.style.colorScheme = theme;
}

/**
 * Follow a Shell `shell.theme.changed` payload (`{ theme }`). Ignores
 * malformed payloads; returns the applied theme or `null`.
 */
export function applyThemeEvent(payload: unknown): AgentosTheme | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const theme = (payload as { theme?: unknown }).theme;
  if (!isAgentosTheme(theme)) return null;
  applyDocumentTheme(theme);
  return theme;
}
