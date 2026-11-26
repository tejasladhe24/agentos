/**
 * Shared wire / RPC contracts for `@agentos/core/sdk`.
 *
 * Prefer these named stubs over `unknown` / `any`. Narrow or replace stubs
 * as Shell, builtins (ai / hitl / events), and Comlink error shapes stabilize.
 */

/** JSON-serializable primitive (structured-clone safe). */
export type JsonPrimitive = string | number | boolean | null;

/** JSON-serializable object map. */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/**
 * JSON-serializable value.
 * Stub ceiling for anything that crosses iframe / MessageChannel boundaries.
 */
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

/**
 * Host storage values.
 * Stub: today JSON-only; widen if we add binary / typed blobs later.
 */
export type StorageValue = JsonValue;

/**
 * Event payload carried by the Shell event bus (HostAPI.events /
 * ExtensionAPI.onEvent). Always JSON; topics are namespaced `<extId>.<event>`
 * and declared per extension in `meta.json` `events`.
 */
export type EventPayload = JsonValue;

/**
 * HITL approval metadata bag.
 * Stub: free-form JSON until hitl builtin locks fields (assignee, severity, …).
 */
export type HitlMetadata = JsonObject;

/**
 * Options for HostAPI.ai.generateText.
 * Stub: expand as builtin `ai` (ticket 18) locks provider params.
 */
export interface AiGenerateOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Provider-specific knobs; tighten per-provider later. */
  providerOptions?: JsonObject;
}

/**
 * Values that may appear in `catch` / Promise rejection callbacks.
 * Prefer throwing `Error` at SDK boundaries; refine as Comlink error
 * serialization is standardized.
 */
export type CatchValue =
  | Error
  | string
  | number
  | boolean
  | null
  | undefined
  | {
      message?: string;
      name?: string;
      code?: string;
    };

/**
 * Raw `postMessage` / `MessageEvent.data` before handshake narrowing.
 * Stub: replace with a versioned message-bus envelope when Shell owns one.
 * Includes `{ type: string }` so HandshakeMessage is a valid narrowing target.
 */
export type WireMessageData = JsonValue | { readonly type: string };

/**
 * Extension iframe window surface needed to complete HOST_ACK.
 */
export interface ExtensionContentWindow {
  postMessage(
    message: { type: string },
    targetOrigin: string,
    transfer?: Transferable[],
  ): void;
}

/** Timer handle from the host environment (DOM number or Bun/Node Timeout). */
export type HandshakeTimerId = ReturnType<typeof setTimeout>;

/**
 * Incoming handshake message shape used by host/client listeners.
 * Narrower than DOM `MessageEvent` so tests can implement it without casts.
 */
export interface HandshakeIncomingMessage {
  data: WireMessageData;
  /**
   * Posting frame identity (compared by reference).
   * Includes real windows and test fakes.
   */
  source:
    ExtensionContentWindow | HandshakeMessageTarget | MessageEventSource | null;
  ports: readonly MessagePort[];
}

/**
 * Shell (or test) window that listens for PORT_READY / READY.
 */
export interface HandshakeMessageTarget {
  setTimeout(handler: () => void, timeout?: number): HandshakeTimerId;
  clearTimeout(id?: HandshakeTimerId): void;
  addEventListener(
    type: 'message',
    listener: (event: HandshakeIncomingMessage) => void,
  ): void;
  removeEventListener(
    type: 'message',
    listener: (event: HandshakeIncomingMessage) => void,
  ): void;
}

/**
 * Identity of the posting frame; compared by reference during handshake.
 */
export type HandshakeMessageSource = HandshakeIncomingMessage['source'];

/** Normalize catch/rejection values into Error. */
export function toError(value: CatchValue): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof value.message === 'string'
  ) {
    return new Error(value.message);
  }
  return new Error('Unexpected failure');
}

/**
 * Adapt a DOM `MessageEvent` into our handshake message contract.
 * lib.dom types `data` loosely; this is the single DOM→SDK boundary adapter.
 */
export function fromDomMessageEvent(
  event: MessageEvent,
): HandshakeIncomingMessage {
  return {
    // DOM types MessageEvent.data loosely; pin to WireMessageData at the edge.
    data: event.data as WireMessageData,
    source: event.source as HandshakeMessageSource,
    ports: event.ports,
  };
}

export function isPlainObject(
  value: WireMessageData,
): value is { readonly [key: string]: JsonValue | string } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
