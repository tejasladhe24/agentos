import {
  applyExtensionEnable,
  parseEnabledFlag,
  type ExtensionEnableState,
} from './enable-state';
import {
  persistExtensionEnableState,
  serializeEnableOverrides,
  type EnableStatePersister,
} from './enable-state-store';
import {
  jsonResponse,
  methodNotAllowedResponse,
  requestPathname,
} from './http';
import type { GatewayHandler, RegistryModel } from './types';

const ENABLE_PATH_RE = /^\/api\/extensions\/([^/]+)\/enable\/?$/;
const ENABLE_STATE_PATH = '/api/extensions/enable-state';

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

/** True when pathname is `GET /api/extensions/enable-state`. */
export function isExtensionEnableStatePath(pathname: string): boolean {
  return pathname === ENABLE_STATE_PATH || pathname === `${ENABLE_STATE_PATH}/`;
}

/**
 * Shared POST enable handler used by `/api/extensions/:id/enable` and
 * `/api/agent/extensions/:id/enable`.
 * When `persister` is set, writes durable overrides after a successful toggle;
 * on persist failure rolls back the Map and returns 502.
 */
export async function handleExtensionEnableRequest(
  request: Request,
  extensionId: string,
  getModel: () => RegistryModel,
  state: ExtensionEnableState,
  persister?: EnableStatePersister,
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

  const hadKey = state.enabledById.has(extension.id);
  const previous = state.enabledById.get(extension.id);

  const result = applyExtensionEnable(extension, enabled, state);
  if (!result.ok) {
    return jsonResponse(result.status, { error: result.error });
  }

  if (persister) {
    try {
      await persistExtensionEnableState(state, persister);
    } catch (err) {
      if (!hadKey) {
        state.enabledById.delete(extension.id);
      } else {
        state.setEnabled(extension.id, previous!);
      }
      console.warn('[agentos] enable-state persist failed:', err);
      return jsonResponse(502, {
        error: 'Failed to persist extension enable state',
      });
    }
  }

  return jsonResponse(200, {
    id: result.id,
    enabled: result.enabled,
  });
}

/** `GET /api/extensions/enable-state` → `{ enabledById }`. */
export function handleExtensionEnableStateGet(
  state: ExtensionEnableState,
): Response {
  return jsonResponse(200, {
    enabledById: serializeEnableOverrides(state.enabledById),
  });
}

/**
 * `POST /api/extensions/:id/enable` with `{ enabled: boolean }` and
 * `GET /api/extensions/enable-state`.
 * Driven / builtins / non-toggleable extensions cannot be disabled (403).
 */
export function createExtensionEnableHandler(
  getModel: () => RegistryModel,
  state: ExtensionEnableState,
  persister?: EnableStatePersister,
): GatewayHandler {
  return async (request) => {
    const pathname = requestPathname(request);

    if (isExtensionEnableStatePath(pathname)) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return methodNotAllowedResponse('GET, HEAD');
      }
      if (request.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
      return handleExtensionEnableStateGet(state);
    }

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
      persister,
    );
  };
}
