import type { ChannelProvider, SendPayload, SendResult } from './types';

/** Dev / unset-env sink: logs the payload and reports success. */
export function createLogProvider(channel: 'email' | 'sms'): ChannelProvider {
  const name = `log:${channel}`;
  return {
    name,
    async send(payload: SendPayload): Promise<SendResult> {
      const subject =
        payload.subject !== undefined
          ? ` subject=${JSON.stringify(payload.subject)}`
          : '';
      console.log(
        `[agentos notifications] ${name} → ${payload.to}${subject} body=${JSON.stringify(payload.body)}`,
      );
      return { ok: true, provider: name };
    },
  };
}
