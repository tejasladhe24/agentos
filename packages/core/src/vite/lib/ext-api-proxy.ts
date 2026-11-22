import {
  EXT_API_PREFIX,
  createExtApiProxyHandler,
  parseExtApiPath,
  type ParsedExtApiPath,
  type ProxyFetch,
  type ExtensionEnableState,
} from '@agentos/core/gateway/lib/index';
import type { RegistryModel } from './types';
import { toConnectMiddleware, type ConnectMiddleware } from './connect-adapter';

export { EXT_API_PREFIX, parseExtApiPath };
export type { ParsedExtApiPath, ProxyFetch };

/**
 * Connect middleware: `ALL /api/ext/:id/*` → upstream (Vite Connect adapter).
 */
export function createExtApiProxyMiddleware(
  getModel: () => RegistryModel,
  state: ExtensionEnableState,
  fetchImpl: ProxyFetch = globalThis.fetch,
): ConnectMiddleware {
  return toConnectMiddleware(
    createExtApiProxyHandler(getModel, state, fetchImpl),
  );
}
