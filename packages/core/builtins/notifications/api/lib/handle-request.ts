import {
  handleIntegrationRoutes,
  type IntegrationRoutesContext,
} from '@agentos/core/api/integrations';

import type { NotificationProviders } from './providers/create-providers';
import type { NotifyStore } from './notify-store';
import { json, parseDeliveryId } from './http';
import {
  handleGetDelivery,
  NOTIFY_EXACT_ROUTES,
  type NotifyRouteDeps,
} from './routes';

export type NotificationsRequestOptions = Omit<
  NotifyRouteDeps,
  'store' | 'providers'
> & {
  /** Mounts `/integrations/*` (email.send + sms Settings cards). */
  integrationRoutes?: IntegrationRoutesContext;
};

/**
 * Thin Bun request router for `/api/ext/notifications/*` upstream paths.
 * Persistence goes through db-store only (ADR 004).
 */
export async function handleNotificationsRequest(
  store: NotifyStore,
  request: Request,
  providers?: NotificationProviders,
  options: NotificationsRequestOptions = {},
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();
  const { integrationRoutes, ...rest } = options;
  const deps: NotifyRouteDeps = { ...rest, store, providers };

  if (integrationRoutes) {
    const handled = await handleIntegrationRoutes(integrationRoutes, request);
    if (handled) return handled;
  }

  for (const route of NOTIFY_EXACT_ROUTES) {
    if (route.method === method && route.path === path) {
      return route.handle(deps, request);
    }
  }

  const deliveryId = parseDeliveryId(path);
  if (method === 'GET' && deliveryId) {
    return handleGetDelivery(deps, request, deliveryId);
  }

  return json({ error: 'not found' }, { status: 404 });
}
