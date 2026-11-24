import {
  handleIntegrationRoutes,
  type IntegrationRoutesContext,
} from '@agentos/core/api/integrations';

import { json } from './http';
import {
  EXACT_ROUTES,
  handleGetMessage,
  handlePatchMessage,
  handleResendConnectionWebhook,
  parseMessageId,
  parseResendConnectionId,
  type InboundEmailDeps,
} from './routes';

export type InboundEmailRequestOptions = {
  /** Mount `/integrations/*` (email.receive BYOK) when provided. */
  integrationRoutes?: IntegrationRoutesContext;
};

/**
 * Thin Bun request router for `/api/ext/inbound-email/*` upstream paths.
 */
export async function handleInboundEmailRequest(
  deps: InboundEmailDeps,
  request: Request,
  options: InboundEmailRequestOptions = {},
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  for (const route of EXACT_ROUTES) {
    if (route.method === method && route.path === path) {
      return route.handle(deps, request);
    }
  }

  if (options.integrationRoutes) {
    const handled = await handleIntegrationRoutes(
      options.integrationRoutes,
      request,
    );
    if (handled) return handled;
  }

  const connectionId = parseResendConnectionId(path);
  if (connectionId && method === 'POST') {
    return handleResendConnectionWebhook(deps, request, connectionId);
  }

  const messageId = parseMessageId(path);
  if (messageId) {
    if (method === 'GET') {
      return handleGetMessage(deps, request, messageId);
    }
    if (method === 'PATCH') {
      return handlePatchMessage(deps, request, messageId);
    }
  }

  return json({ error: 'not found' }, { status: 404 });
}
