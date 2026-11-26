import { useEffect, useState } from 'react';
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
  /**
   * Optional URL hash fragment synced into the iframe via `location.hash`
   * without reloading or re-handshaking the frame (e.g. multi-section settings).
   */
  hash?: string;
};

/**
 * Sandboxed extension iframe with Comlink host lifecycle (ADR 005).
 *
 * Lazy: nothing mounts (no `src` request, no handshake) until the frame is
 * first visible. After that it stays mounted when parked, so switching views
 * never remounts it (ticket 102).
 */
export function ExtensionFrame(props: ExtensionFrameProps) {
  const visible = props.visible ?? true;
  const [everVisible, setEverVisible] = useState(visible);
  if (visible && !everVisible) setEverVisible(true);
  if (!everVisible) return null;
  return <MountedExtensionFrame {...props} />;
}

/**
 * Shows an in-canvas LoadingState while runtime status is loading / unset.
 */
function MountedExtensionFrame({
  contribution,
  visible = true,
  handshakeTimeoutMs,
  rpcTimeoutMs,
  theme: themeProp,
  hash,
}: ExtensionFrameProps) {
  const { extensionId, view, src } = contribution;
  const { resolvedTheme } = useTheme();
  const theme = themeProp ?? resolvedTheme ?? 'dark';
  // `?theme=` only seeds the first load; later changes are pushed to the live
  // frame as `shell.theme.changed`, so the src (and the iframe) stays put.
  const [initialTheme] = useState(theme);
  const themedSrc = withThemeQuery(src, initialTheme);
  const iframeRef = useExtensionHost(
    { ...contribution, src: themedSrc },
    {
      handshakeTimeoutMs,
      rpcTimeoutMs,
      theme,
    },
  );
  const runtimeStatus = useShellStore(
    (s) => s.runtimeStatus[contributionKey(extensionId, view)],
  );
  const showLoading = shouldShowExtensionFrameLoading(runtimeStatus, visible);

  useEffect(() => {
    if (hash === undefined) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    const target = hash ? `#${hash}` : '';
    try {
      if (win.location.hash !== target) {
        win.location.hash = target;
      }
    } catch {
      // Ignore cross-origin access in restricted environments/tests.
    }
  }, [hash, runtimeStatus, iframeRef]);

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
