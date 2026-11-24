import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  IntegrationSettingsForm,
  integrationDraftBody,
  type IntegrationSectionData,
} from '@agentos/core/client/components/integration-section';

const data = (
  overrides: Partial<IntegrationSectionData> = {},
): IntegrationSectionData => ({
  canManage: true,
  definition: {
    id: 'email.send',
    label: 'Email sending',
    testable: true,
    providers: [
      {
        id: 'resend',
        label: 'Resend',
        settings: [{ name: 'from', label: 'From address', required: true }],
        secrets: [{ name: 'apiKey', label: 'API key', required: true }],
      },
    ],
  },
  platformDefault: { provider: 'log', configured: true },
  instances: [],
  ...overrides,
});

function render(props: Partial<Parameters<typeof IntegrationSettingsForm>[0]>) {
  return renderToStaticMarkup(
    createElement(IntegrationSettingsForm, {
      data: data(),
      draft: { provider: 'resend', settings: {}, secrets: {} },
      onDraftChange: () => {},
      onSave: () => {},
      onRemove: async () => {},
      onTest: async () => ({ ok: true }),
      ...props,
    }),
  );
}

describe('IntegrationSettingsForm', () => {
  test('platform default: badge, not-set secret input, no Remove', () => {
    const html = render({});
    expect(html).toContain('Platform default');
    expect(html).toContain('Not set');
    expect(html).toContain('Test connection');
    expect(html).not.toContain('Remove');
  });

  test('tenant config: "Using your key", masked set secret, Replace + Remove', () => {
    const html = render({
      data: data({
        instances: [
          {
            instanceId: 'default',
            provider: 'resend',
            settings: { from: 'a@example.com' },
            secrets: { apiKey: { set: true } },
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    });
    expect(html).toContain('Using your key');
    expect(html).toContain('Replace');
    expect(html).toContain('Remove');
    expect(html).not.toContain('type="password"');
  });

  test('read-only for users without integrations.manage', () => {
    const html = render({ data: data({ canManage: false }) });
    expect(html).toContain('Only admins can change this integration.');
    expect(html).not.toContain('Save');
  });

  test('draft body drops empty secrets', () => {
    expect(
      integrationDraftBody({
        provider: 'resend',
        settings: { from: 'a@example.com' },
        secrets: { apiKey: '', other: 'x' },
      }),
    ).toEqual({
      provider: 'resend',
      settings: { from: 'a@example.com' },
      secrets: { other: 'x' },
    });
  });
});
