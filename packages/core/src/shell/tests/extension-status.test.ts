import { describe, expect, test } from 'bun:test';
import {
  contributionKey,
  deriveExtensionManagerStatus,
  shouldShowExtensionFrameLoading,
} from '@agentos/core/shell/lib';

describe('shouldShowExtensionFrameLoading', () => {
  test('true when visible and status unset or loading', () => {
    expect(shouldShowExtensionFrameLoading(undefined, true)).toBe(true);
    expect(shouldShowExtensionFrameLoading('loading', true)).toBe(true);
  });

  test('false when active, crashed, or not visible', () => {
    expect(shouldShowExtensionFrameLoading('active', true)).toBe(false);
    expect(shouldShowExtensionFrameLoading('crashed', true)).toBe(false);
    expect(shouldShowExtensionFrameLoading('loading', false)).toBe(false);
    expect(shouldShowExtensionFrameLoading(undefined, false)).toBe(false);
  });
});

describe('deriveExtensionManagerStatus', () => {
  const contributions = [
    { extensionId: 'crm', view: 'page' as const, src: '/crm.html' },
    { extensionId: 'crm', view: 'sidebar' as const, src: '/crm-side.html' },
  ];

  test('disabled wins over frame status', () => {
    expect(
      deriveExtensionManagerStatus('crm', false, contributions, {
        [contributionKey('crm', 'page')]: 'active',
      }),
    ).toBe('disabled');
  });

  test('crashed if any frame crashed', () => {
    expect(
      deriveExtensionManagerStatus('crm', true, contributions, {
        [contributionKey('crm', 'page')]: 'active',
        [contributionKey('crm', 'sidebar')]: 'crashed',
      }),
    ).toBe('crashed');
  });

  test('loading if any mounted frame is loading', () => {
    expect(
      deriveExtensionManagerStatus('crm', true, contributions, {
        [contributionKey('crm', 'page')]: 'loading',
        [contributionKey('crm', 'sidebar')]: 'active',
      }),
    ).toBe('loading');
  });

  test('frames that never mounted (lazy, no status yet) are idle, not loading', () => {
    expect(
      deriveExtensionManagerStatus('crm', true, contributions, {
        [contributionKey('crm', 'page')]: 'active',
      }),
    ).toBe('active');
    expect(deriveExtensionManagerStatus('crm', true, contributions, {})).toBe(
      'active',
    );
  });

  test('active when all frames active', () => {
    expect(
      deriveExtensionManagerStatus('crm', true, contributions, {
        [contributionKey('crm', 'page')]: 'active',
        [contributionKey('crm', 'sidebar')]: 'active',
      }),
    ).toBe('active');
  });

  test('active with no frames when enabled', () => {
    expect(deriveExtensionManagerStatus('auth', true, [], {})).toBe('active');
  });
});
