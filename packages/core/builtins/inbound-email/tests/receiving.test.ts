import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { HostProvider } from '@agentos/core/client';
import type { HostAPIClient } from '@agentos/core/sdk';

import {
  EMPTY_RECEIVING_DRAFT,
  parseWebhookStatus,
  receivingDraftBody,
  receivingWebhookUrl,
} from '../ui/receiving';
import EmailSettings from '../ui/settings';
import { UserEmailFromCardView } from '../ui/user-email-from-card';

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

  test('EmailSettings uses FieldGroup without Card', () => {
    const host: HostAPIClient = {
      storage: {
        get: async () => null,
        set: async () => {},
        remove: async () => {},
      },
      notifications: { show: async () => {} },
      ai: { generateText: async () => ({ text: '' }) },
      hitl: { requestApproval: async () => ({ approved: true, id: '1' }) },
      api: { fetch: async () => ({ ok: true, status: 200, body: '{}' }) },
      events: { publish: async () => {} },
      navigation: { openExternal: async () => {} },
      ui: {
        setRightSidebarOpen: async () => {},
        toggleRightSidebar: async () => false,
        isRightSidebarOpen: async () => false,
      },
    };
    const html = renderToStaticMarkup(
      createElement(HostProvider, {
        host,
        children: createElement(EmailSettings),
      }),
    );
    expect(html).toContain('data-slot="settings-email"');
    expect(html).toContain('data-slot="field-group"');
    expect(html).not.toContain('data-slot="card"');
  });

  test('personal sender section renders as FieldSet without Card', () => {
    const html = renderToStaticMarkup(
      createElement(UserEmailFromCardView, {
        savedFrom: null,
        orgFrom: 'Acme <hi@acme.com>',
        entryId: 'email-from',
        onSave: () => {},
        onClear: () => {},
      }),
    );
    expect(html).toContain('data-slot="user-email-from-card"');
    expect(html).toContain('data-setting-entry="email-from"');
    expect(html).toContain('Your sender address');
    expect(html).not.toContain('data-slot="card"');
  });
});
