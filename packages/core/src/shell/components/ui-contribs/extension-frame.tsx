import { useExtensionHost } from '@agentos/core/shell/hooks';
import {
  contributionKey,
  shouldShowExtensionFrameLoading,
  useShellStore,
  withThemeQuery,
  type UiContribution,
} from '@agentos/core/shell/lib';
import { LoadingState } from '@agentos/ui/components/loading-state';
import { useTheme } from '@agentos/ui/components/theme-provider';
import { cn } from '@agentos/ui/lib/utils';

export type ExtensionFrameProps = {
  contribution: UiContribution;
  /** When false, frame stays mounted but visually parked. */
  visible?: boolean;
  handshakeTimeoutMs?: number;
  rpcTimeoutMs?: number;
  /**
   * Override theme query param. Defaults to Shell `resolvedTheme`, then `dark`.
   * Useful in unit tests without a ThemeProvider.
   */
  theme?: string;
};

/**
 * Sandboxed extension iframe with Comlink host lifecycle (ADR 005).
 * Shows an in-canvas LoadingState while runtime status is loading / unset.
 */
export function ExtensionFrame({
  contribution,
  visible = true,
  handshakeTimeoutMs,
  rpcTimeoutMs,
  theme: themeProp,
}: ExtensionFrameProps) {
  const { extensionId, view, src } = contribution;
  const { resolvedTheme } = useTheme();
  const theme = themeProp ?? resolvedTheme ?? 'dark';
  const themedSrc = withThemeQuery(src, theme);
  const iframeRef = useExtensionHost(
    { ...contribution, src: themedSrc },
    {
      handshakeTimeoutMs,
      rpcTimeoutMs,
    },
  );
  const runtimeStatus = useShellStore(
    (s) => s.runtimeStatus[contributionKey(extensionId, view)],
  );
  const showLoading = shouldShowExtensionFrameLoading(runtimeStatus, visible);

  return (
    <div
      className={cn('relative h-full w-full min-h-0', !visible && 'hidden')}
      data-slot="extension-frame"
      data-extension-id={extensionId}
      data-view={view}
      data-visible={visible ? 'true' : 'false'}
      data-loading={showLoading ? 'true' : 'false'}
      hidden={!visible}
    >
      {showLoading ? (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-background"
          data-slot="extension-frame-loading"
        >
          <LoadingState>Loading extension…</LoadingState>
        </div>
      ) : null}
      <iframe
        ref={iframeRef}
        src={themedSrc}
        title={`${extensionId} ${view}`}
        sandbox="allow-scripts allow-same-origin allow-forms"
        data-extension-id={extensionId}
        data-view={view}
        data-visible={visible ? 'true' : 'false'}
        className="h-full w-full border-0 bg-background"
      />
    </div>
  );
}
