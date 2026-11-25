import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  IntegrationSettingsForm,
  integrationDraftBody,
  switchDraftProvider,
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
  test('renders FieldSet and responsive Field rows without Card wrappers', () => {
    const html = render({ entryId: 'email-sending' });
    expect(html).toContain('data-slot="field-set"');
    expect(html).toContain('data-slot="field-legend"');
    expect(html).toContain('data-slot="field-group"');
    expect(html).toContain('data-setting-entry="email-sending"');
    expect(html).toContain('data-orientation="responsive"');
    expect(html).not.toContain('data-slot="card"');
  });

  test('platform default: badge, not-set info icon, no Remove', () => {
    const html = render({});
    expect(html).toContain('Platform default');
    expect(html).toContain('aria-label="Not set"');
    expect(html).not.toContain('>Not set<');
    expect(html.indexOf('aria-label="Not set"')).toBeLessThan(
      html.indexOf('API key'),
    );
    expect(html).toContain('Test connection');
    expect(html).not.toContain('Remove');
  });

  test('unconfigured platform default renders (i) icon in the left gutter beside the section title', () => {
    const html = render({
      data: data({
        platformDefault: { provider: 'resend', configured: false },
      }),
    });
    expect(html).toContain('aria-label="Platform default (not configured)"');
    expect(html).toContain('-left-5');
    expect(html).not.toContain('>Platform default (not configured)<');
    expect(
      html.indexOf('aria-label="Platform default (not configured)"'),
    ).toBeLessThan(html.indexOf('Email sending'));
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

  test('renderSetting swaps one control; renderExtra adds content', () => {
    const html = render({
      renderSetting: ({ field, value }) =>
        field.name === 'from' ? `custom:${value || 'empty'}` : undefined,
      renderExtra: ({ draft }) => `extra:${draft.provider}`,
    });
    expect(html).toContain('custom:empty');
    expect(html).toContain('extra:resend');
    expect(html).not.toContain('From address');
  });

  test('switching provider drops settings the new provider does not accept', () => {
    const two = data({
      definition: {
        ...data().definition,
        providers: [
          ...data().definition.providers,
          {
            id: 'smtp',
            label: 'SMTP',
            settings: [{ name: 'host', label: 'Host' }],
            secrets: [],
          },
        ],
      },
    });
    expect(
      switchDraftProvider(
        two,
        {
          provider: 'resend',
          settings: { from: 'a@example.com', host: 'h' },
          secrets: { apiKey: 'k' },
        },
        'smtp',
      ),
    ).toEqual({ provider: 'smtp', settings: { host: 'h' }, secrets: {} });
  });
});
