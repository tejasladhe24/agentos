import {
  createAgentControlPlaneHandler,
  createExtApiProxyHandler,
  parseAgentExtensionEnablePath,
  type ExtensionEnableState,
  type ProxyFetch,
} from '@agentos/core/gateway/lib/index';
import type { RegistryModel } from './types';
import { toConnectMiddleware, type ConnectMiddleware } from './connect-adapter';

export { parseAgentExtensionEnablePath };

/**
 * Connect middleware for thin agent control-plane routes (Vite adapter).
 * Chat/HITL rewrite by calling the portable proxy handler internally.
 */
export function createAgentControlPlaneMiddleware(
  getModel: () => RegistryModel,
  state: ExtensionEnableState,
  fetchImpl: ProxyFetch = globalThis.fetch,
): ConnectMiddleware {
  const proxy = createExtApiProxyHandler(getModel, state, fetchImpl);
  return toConnectMiddleware(
    createAgentControlPlaneHandler(getModel, state, proxy),
  );
}
