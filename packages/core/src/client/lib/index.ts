/** @agentos/core/client — extension UI SDK (HostProvider + host hooks). */

export {
  HostProvider,
  type HostProviderProps,
} from '@agentos/core/client/components/host-provider';

export {
  ExtensionViewApp,
  applyDocumentTheme,
  markExtensionDocument,
  mountExtensionView,
  resolveThemeFromSearch,
  type ExtensionViewAppProps,
  type MountExtensionViewOptions,
} from './mount-extension-view';

export { createStandaloneHost, isShellIframe } from './standalone-host';

export { useHostStorage } from './use-host-storage';
export { useHostAI } from './use-host-ai';
export { useHostHITL } from './use-host-hitl';
export { useHostNotifications } from './use-host-notifications';
export { useHostApi } from './use-host-api';
export {
  parseSettingsTarget,
  useSettingsTarget,
  type SettingsTarget,
} from './use-settings-target';

export type {
  AiGenerateOptions,
  AiGenerateResult,
  EventPayload,
  HostAPIClient,
  HostFetchInit,
  HostFetchResponse,
  HitlApprovalRequest,
  HitlApprovalResult,
  NotificationType,
  StorageValue,
} from '@agentos/core/sdk';
