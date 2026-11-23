/** @agentos/core/vite — Vite plugin + filesystem scanner. */

export {
  agentos,
  VIRTUAL_REGISTRY_ID,
  RESOLVED_VIRTUAL_REGISTRY_ID,
  VIRTUAL_CONFIG_ID,
  RESOLVED_VIRTUAL_CONFIG_ID,
  EXT_HTML_PREFIX,
  VIRTUAL_EXT_ENTRY_PREFIX,
  EXT_API_PREFIX,
  PUBLIC_ASSETS_PREFIX,
  createAgentControlPlaneMiddleware,
  createExtApiProxyMiddleware,
  createExtensionEnableMiddleware,
  createExtensionEnableState,
  createPublicAssetsMiddleware,
  parseAgentExtensionEnablePath,
  parseExtApiPath,
  parseExtensionEnablePath,
  parseExtHtmlPath,
  parsePublicAssetPath,
  parseVirtualExtEntryId,
  publicPathUnderRoot,
  renderExtHtmlEntry,
  resolvePublicAssetFile,
  resolvePublicRoot,
  resolvedVirtualExtEntryId,
  resolveCorePackageRoot,
  virtualExtEntryId,
  virtualExtEntryScriptSrc,
} from './agentos-plugin';
export { collectEntryCss } from './collect-entry-css';
export { serializeExtEntryModule } from './ext-entry-module';
export { enrichExtension, enrichRegistry, uiEntryUrl } from './enrich-registry';
export { scanExtensions } from './scan-extensions';
export {
  serializeRegistryModule,
  skillsBindingName,
} from './serialize-registry';
export type {
  ExtensionEnableState,
  ParsedExtApiPath,
  ProxyFetch,
} from './agentos-plugin';

export { DEFAULT_SERVICE_MOUNT } from './types';
export type {
  AgentDescriptors,
  AgentFileName,
  AgentosPluginOptions,
  ApiLanguage,
  ExtensionKind,
  ExtensionMeta,
  ExtensionMetaApi,
  ExtensionMetaPublic,
  ExtensionMetaService,
  ExtensionPublicUiRoute,
  PythonServiceKind,
  RegistryModel,
  ScannedExtension,
  ScanExtensionsOptions,
  ToolDescriptor,
  UiViewName,
} from './types';
