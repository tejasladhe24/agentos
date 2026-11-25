import { describe, expect, test } from 'bun:test';

import {
  isFieldInvalid,
  toFieldErrors,
} from '@agentos/core/client/lib/form-errors';
import {
  createIntegrationDraftSchema,
  type IntegrationSectionData,
} from '@agentos/core/client/components/integration-section';

describe('form-errors helpers', () => {
  test('toFieldErrors normalizes string and object errors and drops empty values', () => {
    expect(
      toFieldErrors([
        undefined,
        null,
        '',
        'Required',
        { message: 'Invalid email' },
        { message: '' },
        { other: 123 },
      ]),
    ).toEqual([{ message: 'Required' }, { message: 'Invalid email' }]);
  });

  test('isFieldInvalid requires touched, invalid, and at least one error', () => {
    expect(
      isFieldInvalid({ isTouched: false, isValid: false, errors: ['err'] }),
    ).toBe(false);
    expect(
      isFieldInvalid({ isTouched: true, isValid: true, errors: ['err'] }),
    ).toBe(false);
    expect(
      isFieldInvalid({ isTouched: true, isValid: false, errors: [] }),
    ).toBe(false);
    expect(
      isFieldInvalid({
        isTouched: true,
        isValid: false,
        errors: [{ message: 'Required' }],
      }),
    ).toBe(true);
  });
});

describe('createIntegrationDraftSchema', () => {
  const baseData: IntegrationSectionData = {
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
        {
          id: 'smtp',
          label: 'SMTP',
          settings: [{ name: 'host', label: 'Host', required: true }],
          secrets: [{ name: 'password', label: 'Password', required: true }],
        },
      ],
    },
    platformDefault: null,
    instances: [],
  };

  test('reports missing required settings and secrets on first save', () => {
    const schema = createIntegrationDraftSchema(baseData);
    const result = schema.safeParse({
      provider: 'resend',
      settings: { from: '   ' },
      secrets: { apiKey: '' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('settings.from');
      expect(paths).toContain('secrets.apiKey');
    }
  });

  test('allows blank secret when already saved on the same provider', () => {
    const schema = createIntegrationDraftSchema({
      ...baseData,
      instances: [
        {
          instanceId: 'default',
          provider: 'resend',
          settings: { from: 'a@example.com' },
          secrets: { apiKey: { set: true } },
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const result = schema.safeParse({
      provider: 'resend',
      settings: { from: 'b@example.com' },
      secrets: {},
    });
    expect(result.success).toBe(true);
  });

  test('requires secret again when switching to a different provider', () => {
    const schema = createIntegrationDraftSchema({
      ...baseData,
      instances: [
        {
          instanceId: 'default',
          provider: 'resend',
          settings: { from: 'a@example.com' },
          secrets: { apiKey: { set: true } },
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const result = schema.safeParse({
      provider: 'smtp',
      settings: { host: 'smtp.example.com' },
      secrets: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path.join('.'))).toContain(
        'secrets.password',
      );
    }
  });
});
