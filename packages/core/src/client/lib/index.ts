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
export { useHostNavigation } from './use-host-navigation';
export { useHostUi } from './use-host-ui';
export {
  useHostEvent,
  useHostPublish,
  type HostPublish,
} from './use-host-event';
export {
  dispatchHostEvent,
  subscribeHostEvent,
  type HostEventHandler,
} from './host-events';
export {
  parseSettingsTarget,
  useSettingsTarget,
  type SettingsTarget,
} from './use-settings-target';

export {
  isFieldInvalid,
  toFieldErrors,
  type UiFieldError,
} from './form-errors';

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
  OpenExternalOptions,
  StorageValue,
} from '@agentos/core/sdk';
