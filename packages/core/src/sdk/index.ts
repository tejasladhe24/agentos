/** @agentos/core/sdk — low-level Comlink (dual MessageChannel, ADR 005). */

export {
  HOST_THEME_TOPIC,
  fromDomMessageEvent,
  isPlainObject,
  toError,
  type AiGenerateOptions,
  type CatchValue,
  type EventPayload,
  type ExtensionContentWindow,
  type HandshakeIncomingMessage,
  type HandshakeMessageSource,
  type HandshakeMessageTarget,
  type HandshakeTimerId,
  type HitlMetadata,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
  type StorageValue,
  type WireMessageData,
} from './lib/contracts';

export {
  HANDSHAKE,
  isHandshakeMessage,
  isHandshakeType,
  type HandshakeMessage,
  type HandshakeType,
} from './lib/handshake';

export {
  ExtensionRpcTimeoutError,
  HandshakeTimeoutError,
  type AiGenerateResult,
  type EmailPreferences,
  type ExtensionAPI,
  type HostAPI,
  type HostAPIClient,
  type HostFetchInit,
  type HostFetchResponse,
  type HitlApprovalRequest,
  type HitlApprovalResult,
  type NotificationDelivery,
  type NotificationSendInput,
  type NotificationType,
  type OpenExternalOptions,
} from './lib/types';

export { withRpcTimeout } from './lib/timeout';

export { proxyHostApi } from './lib/proxy';

export {
  createExtensionClient,
  hostApiFromRemote,
  type ExtensionClient,
  type ExtensionClientOptions,
} from './lib/client';

export {
  connectExtensionHost,
  type ConnectExtensionHostOptions,
  type ExtensionHostConnection,
} from './lib/host';
