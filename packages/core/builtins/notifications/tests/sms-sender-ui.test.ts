import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { smsNumbersHint } from '../ui/sms-number-select';
import { UserSmsFromCardView } from '../ui/user-sms-from-card';
import { parseSmsNumbers, smsNumberLabel } from '../ui/use-sms-numbers';

const loaded = {
  loading: false,
  configured: true,
  error: null,
  numbers: [
    { phoneNumber: '+15550001111', friendlyName: '+15550001111' },
    { phoneNumber: '+15550002222', friendlyName: '(555) 000-2222' },
  ],
};

describe('SMS sender UI helpers', () => {
  test('parseSmsNumbers drops malformed rows and tolerates errors', () => {
    expect(
      parseSmsNumbers(
        JSON.stringify({
          configured: true,
          numbers: [
            { phoneNumber: '+15550001111', friendlyName: 'Main' },
            { friendlyName: 'no number' },
          ],
          error: null,
        }),
      ),
    ).toEqual({
      configured: true,
      numbers: [{ phoneNumber: '+15550001111', friendlyName: 'Main' }],
      error: null,
    });
    expect(
      parseSmsNumbers(
        JSON.stringify({ configured: true, error: 'Twilio 401' }),
      ),
    ).toEqual({ configured: true, numbers: [], error: 'Twilio 401' });
  });

  test('smsNumberLabel adds the friendly name only when distinct', () => {
    expect(smsNumberLabel(loaded.numbers[0]!)).toBe('+15550001111');
    expect(smsNumberLabel(loaded.numbers[1]!)).toBe(
      '+15550002222 · (555) 000-2222',
    );
  });

  test('smsNumbersHint explains an empty dropdown per audience', () => {
    const empty = { ...loaded, configured: false, numbers: [] };
    expect(smsNumbersHint(empty, 'member')).toContain('Ask an admin');
    expect(smsNumbersHint(empty, 'admin')).toContain('Save your API key');
    expect(smsNumbersHint({ ...loaded, numbers: [] }, 'member')).toContain(
      'No SMS-capable numbers',
    );
    expect(smsNumbersHint(loaded, 'member')).toBeNull();
  });
});

describe('UserSmsFromCardView', () => {
  test('renders the personal sender number as a dropdown, not a text input', () => {
    const html = renderToStaticMarkup(
      createElement(UserSmsFromCardView, {
        savedFrom: '+15550002222',
        orgFrom: '+15550001111',
        numbers: loaded,
        entryId: 'sms-from',
        onSave: () => {},
        onClear: () => {},
      }),
    );
    expect(html).toContain('data-slot="user-sms-from-card"');
    expect(html).toContain('data-setting-entry="sms-from"');
    expect(html).toContain('Your sender number');
    expect(html).toContain('id="user-sms-from"');
    expect(html).toContain('data-slot="select-trigger"');
    expect(html).not.toContain('type="text"');
    expect(html).toContain('Use organization default');
  });
});
