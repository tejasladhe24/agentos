export type SendPayload = {
  to: string;
  subject?: string;
  body: string;
  /** Optional per-user sender override (falls back to provider's configured `from`). */
  from?: string;
};

export type SendResult = {
  ok: boolean;
  provider: string;
  error?: string;
};

export type ChannelProvider = {
  name: string;
  send: (payload: SendPayload) => Promise<SendResult>;
  /** Check credentials without sending (when the provider has an endpoint). */
  verify?: () => Promise<SendResult>;
};

/** Turn a provider HTTP failure into an operator-readable error. */
export function describeProviderFailure(
  label: string,
  status: number,
  detail: string,
): string {
  if (status === 401 || status === 403) {
    return `${label} ${status}: credentials rejected (invalid or unauthorized key) — ${detail}`;
  }
  return `${label} ${status}: ${detail}`;
}
