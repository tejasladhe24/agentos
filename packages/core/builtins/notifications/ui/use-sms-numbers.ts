import { useCallback, useEffect, useState } from 'react';
import { useHostApi, useHostNotifications } from '@agentos/core/client';

export const SMS_NUMBERS_PATH = '/sms/numbers';

export type SmsNumber = {
  phoneNumber: string;
  friendlyName: string;
};

export type SmsNumbersData = {
  /** False when no Twilio account (org or platform) is connected. */
  configured: boolean;
  numbers: SmsNumber[];
  /** Twilio rejection / network error, shown instead of the options. */
  error: string | null;
};

export type SmsNumbersState = SmsNumbersData & {
  loading: boolean;
  reload: () => Promise<void>;
};

const EMPTY: SmsNumbersData = { configured: false, numbers: [], error: null };

export function parseSmsNumbers(body: string): SmsNumbersData {
  const parsed = JSON.parse(body) as Partial<SmsNumbersData>;
  return {
    configured: parsed.configured === true,
    numbers: Array.isArray(parsed.numbers)
      ? parsed.numbers.filter(
          (n): n is SmsNumber =>
            typeof n?.phoneNumber === 'string' && n.phoneNumber.length > 0,
        )
      : [],
    error: typeof parsed.error === 'string' ? parsed.error : null,
  };
}

/** Option label: the E.164 number, plus Twilio's friendly name when distinct. */
export function smsNumberLabel(number: SmsNumber): string {
  return number.friendlyName && number.friendlyName !== number.phoneNumber
    ? `${number.phoneNumber} · ${number.friendlyName}`
    : number.phoneNumber;
}

/** SMS-capable Twilio numbers for the sender dropdowns (`GET /sms/numbers`). */
export function useSmsNumbers(): SmsNumbersState {
  const api = useHostApi();
  const notifications = useHostNotifications();
  const [data, setData] = useState<SmsNumbersData>(EMPTY);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const failure = 'Could not load phone numbers from Twilio.';
    try {
      const res = await api.fetch(SMS_NUMBERS_PATH);
      if (!res.ok) {
        setData({ ...EMPTY, error: failure });
        void notifications.show(failure, 'error');
      } else {
        setData(parseSmsNumbers(res.body));
      }
    } catch {
      setData({ ...EMPTY, error: failure });
      void notifications.show(failure, 'error');
    }
    setLoading(false);
  }, [api, notifications]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...data, loading, reload };
}
