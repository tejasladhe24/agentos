import type {
  AiGenerateOptions,
  EventPayload,
  HitlMetadata,
  StorageValue,
} from './contracts';

/** Toast / notification severity. */
export type NotificationType = 'info' | 'success' | 'error';

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

/**
 * Host → extension RPC surface (exposed by the shell via Comlink).
 * Nested namespaces must be wrapped with `Comlink.proxy` on the host.
 */
export interface HostAPI {
  storage: {
    get<T extends StorageValue>(key: string): Promise<T | null>;
    set<T extends StorageValue>(key: string, value: T): Promise<void>;
    remove(key: string): Promise<void>;
  };
  notifications: {
    show(message: string, type?: NotificationType): Promise<void>;
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
  events: {
    publish(topic: string, payload: EventPayload): Promise<void>;
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
