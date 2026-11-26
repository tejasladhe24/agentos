import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { HostProvider } from '@agentos/core/client';
import type { IntegrationSettingRenderInput } from '@agentos/core/client/components/integration-section';
import type { HostAPIClient } from '@agentos/core/sdk';

import { AiModelField } from '../ui/ai-model-field';
import AiSettings from '../ui/settings';

function testHost(): HostAPIClient {
  return {
    storage: {
      get: async () => null,
      set: async () => {},
      remove: async () => {},
    },
    notifications: { show: async () => {} },
    ai: { generateText: async () => ({ text: '' }) },
    hitl: { requestApproval: async () => ({ approved: true, id: '1' }) },
    api: {
      fetch: async () => ({ ok: true, status: 200, body: '{}' }),
    },
    events: { publish: async () => {} },
    navigation: { openExternal: async () => {} },
    ui: {
      setRightSidebarOpen: async () => {},
      toggleRightSidebar: async () => false,
      isRightSidebarOpen: async () => false,
      openRightSheet: async () => {},
      closeRightSheet: async () => {},
      toggleRightSheet: async () => null,
      getActiveRightSheet: async () => null,
    },
  };
}

const input = (
  overrides: Partial<IntegrationSettingRenderInput> = {},
): IntegrationSettingRenderInput => ({
  id: 'ai-model',
  field: { name: 'model', label: 'Chat model', required: true },
  value: 'gpt-5-mini',
  onValueChange: () => {},
  disabled: false,
  draft: { provider: 'openai', settings: {}, secrets: {} },
  data: {
    canManage: true,
    definition: { id: 'ai', label: 'AI', testable: true, providers: [] },
    platformDefault: null,
    instances: [],
  },
  ...overrides,
});

describe('AI settings UI', () => {
  test('model field is a text input until the model list is loaded', () => {
    const html = renderToStaticMarkup(createElement(AiModelField, input()));
    expect(html).toContain('value="gpt-5-mini"');
    expect(html).toContain('<input');
  });

  test('model field becomes a select over the provider model list', () => {
    const html = renderToStaticMarkup(
      createElement(AiModelField, {
        ...input(),
        options: ['gpt-5-mini', 'gpt-5'],
      }),
    );
    expect(html).toContain('Chat model');
    expect(html).not.toContain('<input id="ai-model"');
  });

  test('settings section mounts inside FieldGroup with standard scroll container', () => {
    const html = renderToStaticMarkup(
      createElement(HostProvider, {
        host: testHost(),
        children: createElement(AiSettings),
      }),
    );
    expect(html).toContain('data-slot="ai-settings"');
    expect(html).toContain('data-slot="field-group"');
    expect(html).not.toContain('data-slot="card"');
    expect(html).toContain('Loading');
  });
});
