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
export { useHostAuth } from './use-host-auth';
export { useFilesBlobUrl, useHostFiles } from './use-host-files';
export { extensionPath } from './ext-path';
export {
  hostJson,
  parseErrorBody,
  parseHostJson,
  useHostJson,
  type HostJsonResult,
  type HostResponse,
} from './host-json';
export {
  useHostEvent,
  useHostPublish,
  type HostPublish,
} from './use-host-event';
export {
  useHostSharedState,
  type HostSharedStateOptions,
} from './use-host-shared-state';
export {
  createHostEventDispatcher,
  dispatchHostEvent,
  subscribeHostEvent,
  type HostEventDispatcher,
  type HostEventHandler,
} from './host-events';
export {
  connectHostSharedState,
  type HostSharedState,
} from './host-shared-state';
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
  EmailPreferences,
  EventPayload,
  HostAPIClient,
  HostFetchInit,
  HostFetchResponse,
  HitlApprovalRequest,
  HitlApprovalResult,
  NotificationDelivery,
  NotificationSendInput,
  NotificationType,
  OpenExternalOptions,
  StorageValue,
} from '@agentos/core/sdk';
