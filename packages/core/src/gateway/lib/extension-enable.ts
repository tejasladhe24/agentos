import {
  applyExtensionEnable,
  parseEnabledFlag,
  type ExtensionEnableState,
} from './enable-state';
import {
  jsonResponse,
  methodNotAllowedResponse,
  requestPathname,
} from './http';
import type { GatewayHandler, RegistryModel } from './types';

const ENABLE_PATH_RE = /^\/api\/extensions\/([^/]+)\/enable\/?$/;

/** Parse `POST /api/extensions/:id/enable` pathname → extension id. */
export function parseExtensionEnablePath(
  pathname: string,
): { extensionId: string } | null {
  const match = ENABLE_PATH_RE.exec(pathname);
  if (!match?.[1]) return null;
  try {
    return { extensionId: decodeURIComponent(match[1]) };
  } catch {
    return null;
  }
}

/**
 * Shared POST enable handler used by `/api/extensions/:id/enable` and
 * `/api/agent/extensions/:id/enable`.
 */
export async function handleExtensionEnableRequest(
  request: Request,
  extensionId: string,
  getModel: () => RegistryModel,
  state: ExtensionEnableState,
): Promise<Response> {
  const extension = getModel().extensions.find((ext) => ext.id === extensionId);
  if (!extension) {
    return jsonResponse(404, {
      error: `Unknown extension: ${extensionId}`,
    });
  }

  let body: unknown;
  try {
    const text = await request.text();
    const raw = text.trim();
    body = raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const enabled = parseEnabledFlag(body);
  if (enabled === undefined) {
    return jsonResponse(400, { error: 'Body must include boolean "enabled"' });
  }

  const result = applyExtensionEnable(extension, enabled, state);
  if (!result.ok) {
    return jsonResponse(result.status, { error: result.error });
  }

  return jsonResponse(200, {
    id: result.id,
    enabled: result.enabled,
  });
}

/**
 * `POST /api/extensions/:id/enable` with `{ enabled: boolean }`.
 * Driven / builtins / non-toggleable extensions cannot be disabled (403).
 */
export function createExtensionEnableHandler(
  getModel: () => RegistryModel,
  state: ExtensionEnableState,
): GatewayHandler {
  return async (request) => {
    const pathname = requestPathname(request);
    const parsed = parseExtensionEnablePath(pathname);
    if (!parsed) {
      return null;
    }

    if (request.method !== 'POST') {
      return methodNotAllowedResponse('POST');
    }

    return handleExtensionEnableRequest(
      request,
      parsed.extensionId,
      getModel,
      state,
    );
  };
}
