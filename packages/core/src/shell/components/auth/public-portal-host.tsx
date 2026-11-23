import {
  AGENTOS_THEMES,
  ThemeProvider,
  useTheme,
} from '@agentos/ui/components/theme-provider';
import { cn } from '@agentos/ui/lib/utils';
import '@agentos/ui/globals.css';
import {
  withThemeQuery,
  type PublicExtensionRoute,
} from '@agentos/core/shell/lib';

export type PublicPortalHostBranding = {
  appName: string;
  logoUrl?: string;
};

export type PublicPortalHostProps = {
  route: PublicExtensionRoute;
  branding: PublicPortalHostBranding;
  /** Override search string (tests). Defaults to `window.location.search`. */
  search?: string;
  /** Override theme query param (tests). */
  theme?: string;
};

function PortalFrame({
  route,
  branding,
  search,
  theme: themeProp,
}: PublicPortalHostProps) {
  const { resolvedTheme } = useTheme();
  const theme = themeProp ?? resolvedTheme ?? 'dark';
  const query =
    search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const base = withThemeQuery(route.iframeSrc, theme);
  const src = query
    ? `${base}${base.includes('?') ? '&' : '?'}${query.replace(/^\?/, '')}`
    : base;

  return (
    <div
      className="flex min-h-dvh w-full flex-col bg-background text-foreground"
      data-agentos-public-portal
      data-extension-id={route.extensionId}
      data-view={route.view}
    >
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        {branding.logoUrl ? (
          <img
            src={branding.logoUrl}
            alt=""
            className="h-6 w-6 object-contain"
          />
        ) : null}
        <span className="text-sm font-medium tracking-tight">
          {branding.appName}
        </span>
      </header>
      <iframe
        title={`${branding.appName} portal`}
        src={src}
        className={cn('min-h-0 w-full flex-1 border-0 bg-background')}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  );
}

/**
 * Minimal chrome for public extension SPA paths (no Shell Activity Bar / Cmd+K).
 * Forwards `?token=` (and other search) into the extension iframe URL.
 */
export function PublicPortalHost(props: PublicPortalHostProps) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      storageKey="agentos-theme"
      themes={[...AGENTOS_THEMES]}
    >
      <PortalFrame {...props} />
    </ThemeProvider>
  );
}
