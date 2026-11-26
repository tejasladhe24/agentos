import type {
  AiGenerateOptions,
  EventPayload,
  HitlMetadata,
  JsonObject,
  StorageValue,
} from './contracts';

/** Toast / notification severity. */
export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface HostFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HostFetchResponse {
  ok: boolean;
  status: number;
  body: string;
}

export interface HitlApprovalRequest {
  title: string;
  body?: string;
  metadata?: HitlMetadata;
}

export interface HitlApprovalResult {
  approved: boolean;
  id: string;
}

export interface OpenExternalOptions {
  sameTab?: boolean;
}

export interface AiGenerateResult {
  text: string;
}

/** Input for `HostAPI.notifications.send` (the notifications builtin `notify`). */
export interface NotificationSendInput {
  /** Delivery channel (`email`, `sms`, …); omit for the in-app inbox. */
  channel?: string;
  to?: string;
  subject?: string;
  message?: string;
  templateId?: string;
  vars?: JsonObject;
}

/** One delivery record returned by `notifications.send`. */
export interface NotificationDelivery {
  id: string;
  status: string;
  [key: string]: unknown;
}

/** The caller's email sender preference plus the organization default. */
export interface EmailPreferences {
  from: string | null;
  orgFrom: string | null;
}

/**
 * Host → extension RPC surface (exposed by the shell via Comlink).
 * Nested namespaces must be wrapped with `Comlink.proxy` on the host.
 */
export interface HostAPI {
  /**
   * Per-extension key/value storage shared by every frame of the extension.
   * **Session-only**: it lives in the Shell's memory and is cleared on reload
   * or sign-out. The Shell has no org/user scope to key durable browser
   * storage by, so persisting here could leak values between users of one
   * device. Use the extension's own API (db-store) for anything that must
   * survive a reload.
   */
  storage: {
    get<T extends StorageValue>(key: string): Promise<T | null>;
    set<T extends StorageValue>(key: string, value: T): Promise<void>;
    remove(key: string): Promise<void>;
  };
  notifications: {
    show(message: string, type?: NotificationType): Promise<void>;
    /**
     * Send a notification through the notifications builtin (email, sms, …).
     * Rejects with the server's error message on failure.
     */
    send(input: NotificationSendInput): Promise<NotificationDelivery>;
    /** Read the signed-in user's email sender preference. */
    getEmailPreferences(): Promise<EmailPreferences>;
    /** Set (or with `null`, clear) the user's email sender address. */
    setEmailPreferences(from: string | null): Promise<EmailPreferences>;
  };
  /** Platform authorization checks (no direct calls to the auth builtin). */
  auth: {
    /**
     * Whether the signed-in user holds `permission` in the active org.
     * `false` when signed out; rejects when the auth service is unreachable.
     * Answers are cached per session.
     */
    can(permission: string): Promise<boolean>;
  };
  /** Platform file references (no direct calls to the files builtin). */
  files: {
    /** Same-origin URL that downloads a stored blob by key or `files://` ref. */
    blobUrl(key: string): Promise<string>;
  };
  ai: {
    generateText(
      prompt: string,
      options?: AiGenerateOptions,
    ): Promise<AiGenerateResult>;
  };
  hitl: {
    requestApproval(input: HitlApprovalRequest): Promise<HitlApprovalResult>;
  };
  api: {
    fetch(path: string, init?: HostFetchInit): Promise<HostFetchResponse>;
  };
  /**
   * Shell-brokered event bus. Frames never talk to each other directly: the
   * Shell fans events out to subscribed frames through `ExtensionAPI.onEvent`.
   * The calling extension must declare the topic in `meta.json`
   * (`events.publishes` / `events.subscribes`); undeclared calls reject.
   */
  events: {
    /**
     * Durable publish through the `events` builtin. Delivery to UI
     * subscribers comes back over the Shell's org-scoped SSE bridge, so it
     * also reaches other tabs and server consumers.
     */
    publish(topic: string, payload: EventPayload): Promise<void>;
    /**
     * UI-only publish: delivered in-process to this Shell's subscribed frames
     * with no server round trip. Not durable, not seen by other tabs.
     */
    publishLocal(topic: string, payload: EventPayload): Promise<void>;
    /**
     * Subscribe the calling frame to `topics` (each must be declared in
     * `events.subscribes`). Returns a subscription id for `unsubscribe`.
     * Matching events arrive via `ExtensionAPI.onEvent(topic, payload)`.
     */
    subscribe(topics: string[]): Promise<string>;
    /** Drop a subscription. Unknown ids are ignored. */
    unsubscribe(subscriptionId: string): Promise<void>;
  };
  navigation: {
    /**
     * Open an absolute `http(s)` URL outside the sandboxed iframe — a new tab,
     * or the Shell tab itself with `sameTab` (OAuth consent redirects).
     */
    openExternal(url: string, options?: OpenExternalOptions): Promise<void>;
  };
  ui: {
    /** Open or close the Shell's right sidebar panel. */
    setRightSidebarOpen(open: boolean): Promise<void>;
    /** Toggle the Shell's right sidebar panel; returns the new open state. */
    toggleRightSidebar(): Promise<boolean>;
    /** Read whether the Shell's right sidebar panel is currently open. */
    isRightSidebarOpen(): Promise<boolean>;
    /**
     * Open the global right sheet for `extensionId` (defaults to the calling
     * extension). No-op when that extension has no enabled `ui/right-sheet`.
     */
    openRightSheet(extensionId?: string): Promise<void>;
    /** Close the global right sheet if one is open. */
    closeRightSheet(): Promise<void>;
    /**
     * Open or close the global right sheet for `extensionId` (defaults to the
     * calling extension). Returns the active sheet extension id after toggling,
     * or `null` when closed.
     */
    toggleRightSheet(extensionId?: string): Promise<string | null>;
    /** Extension id whose right sheet is open, or `null` when closed. */
    getActiveRightSheet(): Promise<string | null>;
  };
}

/**
 * Extension → host RPC surface (exposed by the extension via Comlink).
 */
export interface ExtensionAPI {
  onActivate(): Promise<void>;
  onDeactivate(): Promise<void>;
  onEvent(topic: string, payload: EventPayload): Promise<void>;
}

/**
 * Live HostAPI as seen from the extension after dual-channel handshake.
 *
 * Comlink.Remote<> types nested objects as Promise-wrapped; because we mark
 * namespaces with Comlink.proxy, the runtime shape matches HostAPI.
 * `hostApiFromRemote` awaits namespaces so both proxied and cloned shapes work.
 */
export type HostAPIClient = HostAPI;

export class ExtensionRpcTimeoutError extends Error {
  readonly code = 'RPC_TIMEOUT' as const;

  constructor(
    public readonly extensionId: string,
    public readonly method: string,
    public readonly timeoutMs: number,
  ) {
    super(
      `Extension "${extensionId}" timed out on ${method} after ${timeoutMs}ms`,
    );
    this.name = 'ExtensionRpcTimeoutError';
  }
}

export class HandshakeTimeoutError extends Error {
  readonly code = 'HANDSHAKE_TIMEOUT' as const;

  constructor(
    public readonly side: 'client' | 'host',
    public readonly timeoutMs: number,
  ) {
    super(`Extension handshake (${side}) timed out after ${timeoutMs}ms`);
    this.name = 'HandshakeTimeoutError';
  }
}
