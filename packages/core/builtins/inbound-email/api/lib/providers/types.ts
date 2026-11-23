import type { NormalizedInboundEmail } from '../types';

export type ProviderVerifyInput = {
  rawBody: string | Uint8Array;
  headers: Headers;
  /** Parsed form fields when content-type is multipart (Mailgun). */
  form?: FormData;
};

export type InboundEmailProvider = {
  name: string;
  /**
   * Verify provider authenticity. Returns false on soft failure;
   * throw only for unexpected errors.
   */
  verify: (input: ProviderVerifyInput) => Promise<boolean>;
  /** Parse a verified request into the normalized inbound shape. */
  parse: (input: ProviderVerifyInput) => Promise<NormalizedInboundEmail>;
};
