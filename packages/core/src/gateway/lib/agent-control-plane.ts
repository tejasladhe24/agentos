import { buildEnabledAgentRegistry } from '@agentos/core/agent/lib/build-enabled-agent-registry';

import type { ExtensionEnableState } from './enable-state';
import { handleExtensionEnableRequest } from './extension-enable';
import {
  jsonResponse,
  methodNotAllowedResponse,
  requestPathname,
} from './http';
import type { GatewayHandler, RegistryModel } from './types';

const REGISTRY_PATH = '/api/agent/registry';
const CHAT_PATH = '/api/agent/chat';
const HITL_PATH = '/api/agent/hitl';
const AGENT_ENABLE_PATH_RE = /^\/api\/agent\/extensions\/([^/]+)\/enable\/?$/;

/** Parse `POST /api/agent/extensions/:id/enable` → extension id. */
export function parseAgentExtensionEnablePath(
  pathname: string,
): { extensionId: string } | null {
  const match = AGENT_ENABLE_PATH_RE.exec(pathname);
  if (!match?.[1]) return null;
  try {
    return { extensionId: decodeURIComponent(match[1]) };
  } catch {
    return null;
  }
}

function rewriteToProxy(
  request: Request,
  pathname: string,
  proxy: GatewayHandler,
): Promise<Response | null> | Response | null {
  const target = new URL(request.url);
  target.pathname = pathname;

  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers: request.headers,
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    init.duplex = 'half';
  }
  const rewritten = new Request(target, init);
  return proxy(rewritten);
}

/**
 * Thin agent control-plane routes:
 * - `GET  /api/agent/registry`
 * - `POST /api/agent/extensions/:id/enable`
 * - `POST /api/agent/chat`  → `/api/ext/ai/chat` (via proxy handler)
 * - `POST /api/agent/hitl`  → `/api/ext/hitl/approvals` (via proxy handler)
 *
 * When `proxy` is omitted, chat/HITL return `null` (pass-through).
 */
export function createAgentControlPlaneHandler(
  getModel: () => RegistryModel,
  state: ExtensionEnableState,
  proxy?: GatewayHandler,
): GatewayHandler {
  return async (request) => {
    const pathname = requestPathname(request);

    if (pathname === REGISTRY_PATH) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return methodNotAllowedResponse('GET, HEAD');
      }
      const body = buildEnabledAgentRegistry(getModel(), (ext) =>
        state.isEnabled(ext),
      );
      if (request.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
      return jsonResponse(200, body);
    }

    const enableParsed = parseAgentExtensionEnablePath(pathname);
    if (enableParsed) {
      if (request.method !== 'POST') {
        return methodNotAllowedResponse('POST');
      }
      return handleExtensionEnableRequest(
        request,
        enableParsed.extensionId,
        getModel,
        state,
      );
    }

    if (pathname === CHAT_PATH) {
      if (request.method !== 'POST') {
        return methodNotAllowedResponse('POST');
      }
      if (!proxy) return null;
      return rewriteToProxy(request, '/api/ext/ai/chat', proxy);
    }

    if (pathname === HITL_PATH) {
      if (request.method !== 'POST') {
        return methodNotAllowedResponse('POST');
      }
      if (!proxy) return null;
      return rewriteToProxy(request, '/api/ext/hitl/approvals', proxy);
    }

    return null;
  };
}
