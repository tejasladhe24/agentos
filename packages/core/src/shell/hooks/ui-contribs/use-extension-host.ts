import { useEffect, useRef, type RefObject } from 'react';
import {
  activateFrame,
  createShellHostApi,
  deactivateFrame,
  ensureEventsBridge,
  pushThemeToFrame,
  shellEventBus,
  useShellStore,
  type ActivatedFrame,
  type UiContribution,
} from '@agentos/core/shell/lib';

let frameSeq = 0;

export type UseExtensionHostOptions = {
  handshakeTimeoutMs?: number;
  rpcTimeoutMs?: number;
  /**
   * Current resolved theme. Frames load with the theme from their first
   * mount and then follow changes through `shell.theme.changed`, so a theme
   * switch never reloads an iframe.
   */
  theme?: string;
};

/**
 * Owns the sandboxed iframe Comlink lifecycle (READY → activate → deactivate).
 * Returns a ref to attach to the `<iframe>` element.
 */
export function useExtensionHost(
  contribution: UiContribution,
  options: UseExtensionHostOptions = {},
): RefObject<HTMLIFrameElement | null> {
  const { extensionId, view, src } = contribution;
  const { handshakeTimeoutMs, rpcTimeoutMs, theme } = options;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const setRuntimeStatus = useShellStore((s) => s.setRuntimeStatus);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const activatedRef = useRef<ActivatedFrame | null>(null);

  useEffect(() => {
    const contentWindow = iframeRef.current?.contentWindow;
    if (!contentWindow) return;

    let cancelled = false;
    setRuntimeStatus(extensionId, view, 'loading');

    // One bus identity per mounted frame; dropping it removes its subscriptions.
    const frameId = `${extensionId}:${view}:${(frameSeq += 1)}`;
    ensureEventsBridge();

    void (async () => {
      try {
        const activated = await activateFrame({
          extensionId,
          contentWindow,
          hostApi: createShellHostApi(extensionId, { frameId }),
          handshakeTimeoutMs,
          rpcTimeoutMs,
          onRemote: (remote) => {
            shellEventBus.attachFrame(frameId, extensionId, (topic, payload) =>
              remote.onEvent(topic, payload),
            );
          },
        });
        if (cancelled) {
          await deactivateFrame(
            extensionId,
            activated.remote,
            activated.dispose,
            rpcTimeoutMs,
          );
          return;
        }
        activatedRef.current = activated;
        setRuntimeStatus(extensionId, view, 'active');
        // The theme may have changed while the handshake was in flight.
        pushThemeToFrame(activated.remote, themeRef.current);
      } catch {
        if (!cancelled) {
          setRuntimeStatus(extensionId, view, 'crashed');
        }
      }
    })();

    return () => {
      cancelled = true;
      shellEventBus.dropFrame(frameId);
      const current = activatedRef.current;
      activatedRef.current = null;
      // Intentional unmount (disable, remount, theme src change) often tears
      // down the iframe before onDeactivate finishes — that is not a crash.
      void deactivateFrame(
        extensionId,
        current?.remote ?? null,
        current?.dispose ?? null,
        rpcTimeoutMs,
      );
    };
  }, [
    extensionId,
    view,
    src,
    handshakeTimeoutMs,
    rpcTimeoutMs,
    setRuntimeStatus,
  ]);

  useEffect(() => {
    pushThemeToFrame(activatedRef.current?.remote ?? null, theme);
  }, [theme]);

  return iframeRef;
}
