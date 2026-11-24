import { describe, expect, test } from 'bun:test';

import { parseSettingsTarget } from '../lib/use-settings-target';

describe('parseSettingsTarget', () => {
  test('parses section only', () => {
    expect(parseSettingsTarget('#profile')).toEqual({
      section: 'profile',
      entry: null,
    });
  });

  test('parses section:entry', () => {
    expect(parseSettingsTarget('#profile:display-name')).toEqual({
      section: 'profile',
      entry: 'display-name',
    });
  });

  test('handles empty hash', () => {
    expect(parseSettingsTarget('')).toEqual({ section: '', entry: null });
  });
});
