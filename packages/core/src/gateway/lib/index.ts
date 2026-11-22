/** @agentos/core/gateway — host-agnostic fetch handlers. */

export { createGateway } from './create-gateway';
export {
  createAgentControlPlaneHandler,
  parseAgentExtensionEnablePath,
} from './agent-control-plane';
export {
  EXT_API_PREFIX,
  createExtApiProxyHandler,
  parseExtApiPath,
} from './ext-api-proxy';
export type { ParsedExtApiPath } from './ext-api-proxy';
export {
  createExtensionEnableHandler,
  handleExtensionEnableRequest,
  parseExtensionEnablePath,
} from './extension-enable';
export {
  applyExtensionEnable,
  createExtensionEnableState,
  isLockedExtension,
  parseEnabledFlag,
} from './enable-state';
export type { ApplyEnableResult, ExtensionEnableState } from './enable-state';
export {
  EXT_HTML_PREFIX,
  isUiViewName,
  parseExtHtmlPath,
  renderExtHtmlEntry,
} from './html-entry';
export type { ParsedExtHtmlPath } from './html-entry';
export { createExtHtmlHandler } from './ext-html';
export {
  PUBLIC_ASSETS_PREFIX,
  createPublicAssetsHandler,
  parsePublicAssetPath,
  pathUnderRoot,
  publicAssetNotFoundHtml,
  resolvePublicAssetFile,
  resolvePublicRoot,
} from './public-assets';
export {
  jsonResponse,
  methodNotAllowedResponse,
  plainResponse,
  requestPathname,
  requestSearch,
} from './http';
export type {
  GatewayContext,
  GatewayHandler,
  ProxyFetch,
  RegistryModel,
  ScannedExtension,
  UiViewName,
} from './types';
