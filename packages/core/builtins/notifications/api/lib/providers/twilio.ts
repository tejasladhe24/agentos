import {
  describeProviderFailure,
  type ChannelProvider,
  type SendPayload,
  type SendResult,
} from './types';

export type TwilioConfig = {
  accountSid: string;
  authToken: string;
  from: string;
  fetchImpl?: typeof fetch;
  missingConfigError?: string;
};

/** Twilio Messages API SMS adapter. */
export function createTwilioProvider(config: TwilioConfig): ChannelProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  return {
    name: 'twilio',
    async send(payload: SendPayload): Promise<SendResult> {
      if (!config.accountSid || !config.authToken || !config.from) {
        return {
          ok: false,
          provider: 'twilio',
          error:
            config.missingConfigError ??
            'Twilio requires AGENT_OS_EXT_NOTIFICATIONS_SMS_ACCOUNT_SID, SMS_AUTH_TOKEN, and SMS_FROM',
        };
      }
      const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`;
      const body = new URLSearchParams({
        To: payload.to,
        From: config.from,
        Body: payload.body,
      });
      const auth = btoa(`${config.accountSid}:${config.authToken}`);
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            authorization: `Basic ${auth}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body,
        });
        if (!res.ok) {
          const detail = await res.text();
          return {
            ok: false,
            provider: 'twilio',
            error: describeProviderFailure(
              'Twilio',
              res.status,
              detail || res.statusText,
            ),
          };
        }
        return { ok: true, provider: 'twilio' };
      } catch (error) {
        return {
          ok: false,
          provider: 'twilio',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    /** GET the Account resource — validates SID + auth token without sending. */
    async verify(): Promise<SendResult> {
      if (!config.accountSid || !config.authToken) {
        return {
          ok: false,
          provider: 'twilio',
          error:
            config.missingConfigError ??
            'Twilio account SID and auth token required',
        };
      }
      const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}.json`;
      try {
        const res = await fetchImpl(url, {
          headers: {
            authorization: `Basic ${btoa(`${config.accountSid}:${config.authToken}`)}`,
          },
        });
        if (!res.ok) {
          const detail = await res.text();
          return {
            ok: false,
            provider: 'twilio',
            error: describeProviderFailure(
              'Twilio',
              res.status,
              detail || res.statusText,
            ),
          };
        }
        return { ok: true, provider: 'twilio' };
      } catch (error) {
        return {
          ok: false,
          provider: 'twilio',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
