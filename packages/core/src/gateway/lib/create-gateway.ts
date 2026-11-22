import { createAgentControlPlaneHandler } from './agent-control-plane';
import { createExtApiProxyHandler } from './ext-api-proxy';
import { createExtHtmlHandler } from './ext-html';
import { createExtensionEnableHandler } from './extension-enable';
import { createPublicAssetsHandler } from './public-assets';
import type { GatewayContext, GatewayHandler } from './types';

/**
 * Compose host-agnostic gateway handlers in mount order:
 * `/_public` → enable → `/api/agent` → `/api/ext` → iframe HTML.
 * First non-null Response wins; `null` means the host should continue.
 */
export function createGateway(ctx: GatewayContext): GatewayHandler {
  const fetchImpl = ctx.fetchImpl ?? globalThis.fetch;
  const proxy = createExtApiProxyHandler(
    ctx.getModel,
    ctx.enableState,
    fetchImpl,
  );

  const handlers: GatewayHandler[] = [
    createPublicAssetsHandler(ctx.getPublicRoot),
    createExtensionEnableHandler(ctx.getModel, ctx.enableState),
    createAgentControlPlaneHandler(ctx.getModel, ctx.enableState, proxy),
    proxy,
    createExtHtmlHandler(ctx.getModel, ctx.resolveHtmlScriptSrc),
  ];

  return async (request) => {
    for (const handler of handlers) {
      const response = await handler(request);
      if (response != null) {
        return response;
      }
    }
    return null;
  };
}
