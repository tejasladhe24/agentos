import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  createExtensionClient,
  type ExtensionAPI,
  type HostAPIClient,
} from '@agentos/core/sdk';
import { HostContext } from '@agentos/core/client/lib/host-context';
import { LoadingState } from '@agentos/ui/components/loading-state';

export type HostProviderProps = {
  children: ReactNode;
  /** Lifecycle hooks forwarded to `createExtensionClient` (ignored when `host` is set). */
  api?: Partial<ExtensionAPI>;
  /**
   * Injected host — skips iframe handshake.
   * Use in unit tests and advanced bootstraps; production iframe UI omits this.
   */
  host?: HostAPIClient;
  handshakeTimeoutMs?: number;
};

/**
 * Provides HostAPI to extension UI via React context.
 *
 * Default: boots `createExtensionClient` (must run inside a sandboxed iframe).
 * With `host`: provides the injected client and does not open MessageChannels.
 */
export function HostProvider({
  children,
  api,
  host: injectedHost,
  handshakeTimeoutMs,
}: HostProviderProps) {
  const apiRef = useRef(api);
  apiRef.current = api;

  const [bootedHost, setBootedHost] = useState<HostAPIClient | null>(null);

  useLayoutEffect(() => {
    if (injectedHost) {
      setBootedHost(null);
      return;
    }

    const client = createExtensionClient({
      api: {
        onActivate: async () => {
          await apiRef.current?.onActivate?.();
        },
        onDeactivate: async () => {
          await apiRef.current?.onDeactivate?.();
        },
        onEvent: async (topic, payload) => {
          await apiRef.current?.onEvent?.(topic, payload);
        },
      },
      handshakeTimeoutMs,
    });
    setBootedHost(client.host);

    return () => {
      client.dispose();
      setBootedHost(null);
    };
  }, [injectedHost, handshakeTimeoutMs]);

  const value = injectedHost ?? bootedHost;
  if (!value) {
    return (
      <LoadingState data-slot="host-provider-loading">
        Connecting to host…
      </LoadingState>
    );
  }

  return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}
