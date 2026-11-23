import { json } from './http';
import {
  EXACT_ROUTES,
  handleGetMessage,
  handlePatchMessage,
  parseMessageId,
  type InboundEmailDeps,
} from './routes';

/**
 * Thin Bun request router for `/api/ext/inbound-email/*` upstream paths.
 */
export async function handleInboundEmailRequest(
  deps: InboundEmailDeps,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  for (const route of EXACT_ROUTES) {
    if (route.method === method && route.path === path) {
      return route.handle(deps, request);
    }
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
