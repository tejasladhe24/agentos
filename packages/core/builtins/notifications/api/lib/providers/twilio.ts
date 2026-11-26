import {
  describeProviderFailure,
  type ChannelProvider,
  type ListSendersResult,
  type SendPayload,
  type SendResult,
  type SenderNumber,
} from './types';

export type TwilioConfig = {
  /** Account SID (`AC…`) — identifies the account in every request URL. */
  accountSid: string;
  /** Account auth token — HTTP basic-auth password (username is the SID). */
  authToken: string;
  /** Default `From` number; a per-send `payload.from` takes precedence. */
  from?: string;
  fetchImpl?: typeof fetch;
  missingConfigError?: string;
};

const TWILIO_API = 'https://api.twilio.com/2010-04-01';
const NUMBERS_PAGE_SIZE = 200;

type IncomingNumber = {
  phone_number?: unknown;
  friendly_name?: unknown;
  capabilities?: { sms?: unknown };
};

function parseNumbers(payload: unknown): SenderNumber[] {
  const rows = (payload as { incoming_phone_numbers?: unknown })
    ?.incoming_phone_numbers;
  if (!Array.isArray(rows)) return [];
  const numbers: SenderNumber[] = [];
  for (const row of rows as IncomingNumber[]) {
    if (typeof row.phone_number !== 'string' || !row.phone_number) continue;
    if (row.capabilities?.sms === false) continue;
    numbers.push({
      phoneNumber: row.phone_number,
      friendlyName:
        typeof row.friendly_name === 'string' && row.friendly_name
          ? row.friendly_name
          : row.phone_number,
    });
  }
  return numbers.sort((a, b) => a.phoneNumber.localeCompare(b.phoneNumber));
}

/** Twilio Messages API SMS adapter (Account SID + auth token). */
export function createTwilioProvider(config: TwilioConfig): ChannelProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const hasCredentials = Boolean(config.accountSid && config.authToken);
  const authorization = `Basic ${btoa(`${config.accountSid}:${config.authToken}`)}`;
  const account = encodeURIComponent(config.accountSid);
  const credentialsError =
    config.missingConfigError ??
    'Twilio requires AGENT_OS_EXT_NOTIFICATIONS_SMS_ACCOUNT_SID and SMS_AUTH_TOKEN';

  async function fetchNumbers(pageSize: number): Promise<ListSendersResult> {
    if (!hasCredentials) return { ok: false, error: credentialsError };
    try {
      const res = await fetchImpl(
        `${TWILIO_API}/Accounts/${account}/IncomingPhoneNumbers.json?PageSize=${pageSize}`,
        { headers: { authorization } },
      );
      if (!res.ok) {
        const detail = await res.text();
        return {
          ok: false,
          error: describeProviderFailure(
            'Twilio',
            res.status,
            detail || res.statusText,
          ),
        };
      }
      return { ok: true, numbers: parseNumbers(await res.json()) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    name: 'twilio',
    async send(payload: SendPayload): Promise<SendResult> {
      const from = payload.from || config.from || '';
      if (!hasCredentials || !from) {
        return {
          ok: false,
          provider: 'twilio',
          error: hasCredentials
            ? 'No SMS sender number is set. Pick one in Settings → SMS, or ask an admin to set an organization default.'
            : credentialsError,
        };
      }
      const body = new URLSearchParams({
        To: payload.to,
        From: from,
        Body: payload.body,
      });
      try {
        const res = await fetchImpl(
          `${TWILIO_API}/Accounts/${account}/Messages.json`,
          {
            method: 'POST',
            headers: {
              authorization,
              'content-type': 'application/x-www-form-urlencoded',
            },
            body,
          },
        );
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
    /** List one incoming number — validates the account SID and auth token. */
    async verify(): Promise<SendResult> {
      const result = await fetchNumbers(1);
      return result.ok
        ? { ok: true, provider: 'twilio' }
        : { ok: false, provider: 'twilio', error: result.error };
    },
    /** SMS-capable numbers on the account, for the sender dropdowns. */
    listSenders(): Promise<ListSendersResult> {
      return fetchNumbers(NUMBERS_PAGE_SIZE);
    },
  };
}
