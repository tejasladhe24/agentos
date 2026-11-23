import { describe, expect, test } from 'bun:test';
import {
  CubeIcon,
  EnvelopeIcon,
  GearSixIcon,
  UserIcon,
  UsersIcon,
} from '@phosphor-icons/react';
import {
  DEFAULT_EXTENSION_ICON,
  normalizeExtensionIconName,
  resolveExtensionIcon,
} from '../lib/chrome/resolve-extension-icon';

describe('resolveExtensionIcon', () => {
  test('normalize strips Icon suffix and trims', () => {
    expect(normalizeExtensionIconName(' Users ')).toBe('Users');
    expect(normalizeExtensionIconName('UsersIcon')).toBe('Users');
    expect(normalizeExtensionIconName('')).toBeUndefined();
    expect(normalizeExtensionIconName(null)).toBeUndefined();
  });

  test('resolves known names and falls back to Cube', () => {
    expect(resolveExtensionIcon('Users')).toBe(UsersIcon);
    expect(resolveExtensionIcon('UsersIcon')).toBe(UsersIcon);
    expect(resolveExtensionIcon('User')).toBe(UserIcon);
    expect(resolveExtensionIcon('GearSix')).toBe(GearSixIcon);
    expect(resolveExtensionIcon('Envelope')).toBe(EnvelopeIcon);
    expect(resolveExtensionIcon('Nope')).toBe(DEFAULT_EXTENSION_ICON);
    expect(resolveExtensionIcon(undefined)).toBe(CubeIcon);
  });
});
