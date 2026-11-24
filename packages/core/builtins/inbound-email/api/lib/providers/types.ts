import type { NormalizedInboundEmail } from '../types';

export type ProviderVerifyInput = {
  rawBody: string | Uint8Array;
  headers: Headers;
};

/** Provider API failure while fetching content — maps to 502 so the sender retries. */
export class ProviderUpstreamError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ProviderUpstreamError';
    this.status = status;
  }
}

export type InboundEmailProvider = {
  name: string;
  /**
   * Verify provider authenticity. Returns false on soft failure;
   * throw only for unexpected errors.
   */
  verify: (input: ProviderVerifyInput) => Promise<boolean>;
  /**
   * Parse a verified request into the normalized inbound shape, or `null`
   * for provider events that carry no message (acknowledged and ignored).
   */
  parse: (input: ProviderVerifyInput) => Promise<NormalizedInboundEmail | null>;
};
