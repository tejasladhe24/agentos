import type {
  RegistryModel,
  ScannedExtension,
  UiViewName,
} from '@agentos/core/vite/lib/types';

import type { ExtensionEnableState } from './enable-state';
import type { EnableStatePersister } from './enable-state-store';

/** Fetch-style gateway route: `null` means pass to the next handler / host. */
export type GatewayHandler = (
  request: Request,
) => Response | null | Promise<Response | null>;

/** Fetch-compatible function injected for proxy tests. */
export type ProxyFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/** Shared deps for {@link createGateway} and individual handlers. */
export type GatewayContext = {
  getModel: () => RegistryModel;
  enableState: ExtensionEnableState;
  getPublicRoot: () => string;
  /** Script `src` for iframe HTML entries (Vite virtual id or built chunk). */
  resolveHtmlScriptSrc: (extensionId: string, view: UiViewName) => string;
  /**
   * When false, omit dynamic iframe HTML so the host can serve built
   * `dist/__agentos/ext/...html`. Default true.
   */
  serveExtHtml?: boolean;
  fetchImpl?: ProxyFetch;
  /**
   * Optional durable store for customer enable overrides (ticket 60).
   * When omitted, enable state stays process-local (tests / memory-only).
   */
  enableStatePersister?: EnableStatePersister;
};

export type { RegistryModel, ScannedExtension, UiViewName };
