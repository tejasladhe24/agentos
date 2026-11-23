import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SecretsManager } from '../ui/components/secrets-manager';

const noopAsync = async () => {};
const reveal = async () => 'should-not-appear-in-list';

const baseProps = {
  loading: false,
  error: null as string | null,
  forbidden: false,
  health: { ok: true, vault: true, masterKey: true },
  orgId: 'org-1',
  canWrite: true,
  keys: [
    {
      key: 'qbo',
      updatedAt: '2026-01-01T00:00:00.000Z',
      hasValue: true as const,
    },
  ],
  filter: '',
  onFilterChange: () => {},
  onRefresh: () => {},
  createOpen: false,
  onCreateOpenChange: () => {},
  rotateKey: null as string | null,
  onRotateKeyChange: () => {},
  deleteKey: null as string | null,
  onDeleteKeyChange: () => {},
  onCreate: noopAsync,
  onRotate: noopAsync,
  onDelete: noopAsync,
  onReveal: reveal,
};

describe('SecretsManager', () => {
  test('renders masked value by default (no plaintext in markup)', () => {
    const html = renderToStaticMarkup(createElement(SecretsManager, baseProps));
    expect(html).toContain('data-slot="secrets-page"');
    expect(html).toContain('Secrets');
    expect(html).toContain('qbo');
    expect(html).toContain('••••••••');
    expect(html).not.toContain('should-not-appear-in-list');
    expect(html).toContain('Create secret');
  });

  test('shows forbidden state without mutate controls', () => {
    const html = renderToStaticMarkup(
      createElement(SecretsManager, {
        ...baseProps,
        forbidden: true,
        error: 'Missing secrets.read permission',
        keys: [],
      }),
    );
    expect(html).toContain('data-slot="secrets-forbidden"');
    expect(html).toContain('Missing secrets.read permission');
    expect(html).not.toContain('Create secret');
    expect(html).not.toContain('data-slot="secrets-table"');
  });

  test('master key banner blocks create when canWrite', () => {
    const html = renderToStaticMarkup(
      createElement(SecretsManager, {
        ...baseProps,
        health: { ok: true, vault: true, masterKey: false },
      }),
    );
    expect(html).toContain('data-slot="secrets-master-key-banner"');
    expect(html).toContain('AGENT_OS_EXT_SECRETS_MASTER_KEY');
    expect(html).not.toContain('Create secret');
  });

  test('hides mutate actions when canWrite is false', () => {
    const html = renderToStaticMarkup(
      createElement(SecretsManager, {
        ...baseProps,
        canWrite: false,
      }),
    );
    expect(html).toContain('qbo');
    expect(html).not.toContain('Create secret');
    expect(html).not.toContain('>Rotate<');
    expect(html).not.toContain('>Delete<');
  });
});
