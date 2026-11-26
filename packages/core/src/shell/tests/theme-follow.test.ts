import { describe, expect, test } from 'bun:test';
import { HOST_THEME_TOPIC } from '@agentos/core/sdk';
import {
  applyThemeEvent,
  isAgentosTheme,
} from '@agentos/core/client/lib/document-theme';
import {
  filterContributions,
  pushThemeToFrame,
  type UiContribution,
} from '@agentos/core/shell/lib';

describe('theme without reload', () => {
  test('pushThemeToFrame sends shell.theme.changed to the live remote', () => {
    const calls: Array<[string, unknown]> = [];
    pushThemeToFrame(
      {
        onEvent: async (topic, payload) => {
          calls.push([topic, payload]);
        },
      },
      'light',
    );
    expect(calls).toEqual([[HOST_THEME_TOPIC, { theme: 'light' }]]);
    expect(HOST_THEME_TOPIC).toBe('shell.theme.changed');
  });

  test('pushThemeToFrame is a no-op without a remote or theme', () => {
    expect(() => pushThemeToFrame(null, 'dark')).not.toThrow();
    const calls: unknown[] = [];
    pushThemeToFrame({ onEvent: async () => void calls.push(1) }, undefined);
    expect(calls).toEqual([]);
  });

  test('pushThemeToFrame never throws when the frame is gone', async () => {
    expect(() =>
      pushThemeToFrame(
        {
          onEvent: () => {
            throw new Error('port closed');
          },
        },
        'dark',
      ),
    ).not.toThrow();
    expect(() =>
      pushThemeToFrame(
        { onEvent: () => Promise.reject(new Error('x')) },
        'dark',
      ),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 0)); // no unhandled rejection
  });

  test('the frame applies valid theme events and ignores junk', () => {
    expect(applyThemeEvent({ theme: 'light' })).toBe('light');
    expect(applyThemeEvent({ theme: 'dark' })).toBe('dark');
    expect(applyThemeEvent({ theme: 'neon' })).toBeNull();
    expect(applyThemeEvent({})).toBeNull();
    expect(applyThemeEvent(null)).toBeNull();
    expect(applyThemeEvent('light')).toBeNull();
    expect(applyThemeEvent(['light'])).toBeNull();
    expect(isAgentosTheme('light')).toBe(true);
    expect(isAgentosTheme(3)).toBe(false);
  });
});

describe('filterContributions', () => {
  const all: UiContribution[] = [
    { extensionId: 'a', view: 'page', src: '/a/page.html' },
    { extensionId: 'a', view: 'sidebar', src: '/a/sidebar.html' },
    { extensionId: 'b', view: 'page', src: '/b/page.html' },
  ];

  test('returns the same array when no view is requested', () => {
    expect(filterContributions(all)).toBe(all);
  });

  test('filters by view', () => {
    expect(filterContributions(all, 'page').map((c) => c.extensionId)).toEqual([
      'a',
      'b',
    ]);
    expect(filterContributions(all, 'widget')).toEqual([]);
  });
});
