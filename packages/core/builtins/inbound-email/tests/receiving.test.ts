import { describe, expect, test } from 'bun:test';

import {
  EMPTY_RECEIVING_DRAFT,
  parseWebhookStatus,
  receivingDraftBody,
  receivingWebhookUrl,
} from '../ui/receiving';

describe('email receiving settings helpers', () => {
  test('draft body sends only provided secrets', () => {
    expect(
      receivingDraftBody({
        ...EMPTY_RECEIVING_DRAFT,
        receivingDomain: ' in.acme.test ',
        apiKey: 're_1',
      }),
    ).toEqual({
      provider: 'resend',
      settings: { receivingDomain: 'in.acme.test' },
      secrets: { apiKey: 're_1' },
    });
  });

  test('use the same key drops a typed key and sets the flag', () => {
    expect(
      receivingDraftBody({
        ...EMPTY_RECEIVING_DRAFT,
        apiKey: 're_typed',
        signingSecret: 'whsec_x',
        useSendingKey: true,
      }),
    ).toEqual({
      provider: 'resend',
      settings: {},
      secrets: { signingSecret: 'whsec_x' },
      useSendingKey: true,
    });
  });

  test('webhook url + status parsing', () => {
    expect(receivingWebhookUrl('rc_1', 'https://app.test/')).toBe(
      'https://app.test/api/ext/inbound-email/webhooks/resend/rc_1',
    );
    expect(parseWebhookStatus('manual')).toBe('manual');
    expect(parseWebhookStatus('forged')).toBeNull();
  });
});
