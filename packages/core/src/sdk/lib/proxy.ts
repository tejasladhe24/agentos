import { proxy } from 'comlink';
import type { HostAPI } from './types';

/**
 * Marks nested HostAPI namespaces with `Comlink.proxy` so property access
 * stays live across the iframe boundary (plain objects would be structured-cloned).
 */
export function proxyHostApi(api: HostAPI): HostAPI {
  return {
    storage: proxy(api.storage),
    notifications: proxy(api.notifications),
    ai: proxy(api.ai),
    hitl: proxy(api.hitl),
    api: proxy(api.api),
    events: proxy(api.events),
    navigation: proxy(api.navigation),
    ui: proxy(api.ui),
  };
}
