import type {
  RegistryModel,
  ScannedExtension,
  UiViewName,
} from '@agentos/core/vite/lib/types';

import type { ExtensionEnableState } from './enable-state';

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
  fetchImpl?: ProxyFetch;
};

export type { RegistryModel, ScannedExtension, UiViewName };
