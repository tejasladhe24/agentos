import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_EMAIL_SECTION,
  EMAIL_SECTIONS,
  isEmailSection,
  parseEmailSection,
} from '../ui/email-section';
import { authenticationSummary, parseErrorBody } from '../ui/email-types';

describe('email manager UI helpers', () => {
  test('parses email sections', () => {
    expect(EMAIL_SECTIONS).toContain('inbox');
    expect(isEmailSection('compose')).toBe(true);
    expect(isEmailSection('nope')).toBe(false);
    expect(parseEmailSection('deliveries')).toBe('deliveries');
    expect(parseEmailSection(null)).toBe(DEFAULT_EMAIL_SECTION);
  });

  test('parseErrorBody', () => {
    expect(parseErrorBody('{"error":"forbidden"}', 'x')).toBe('forbidden');
    expect(parseErrorBody('plain', 'fallback')).toBe('plain');
  });

  test('authentication summary', () => {
    expect(authenticationSummary(undefined)).toBeNull();
    expect(authenticationSummary({})).toBeNull();
    expect(
      authenticationSummary({ spf: 'pass', dkim: 'pass', dmarc: 'pass' }),
    ).toEqual({ label: 'SPF pass · DKIM pass · DMARC pass', failing: false });
    expect(authenticationSummary({ spf: 'softfail', dkim: 'pass' })).toEqual({
      label: 'SPF softfail · DKIM pass',
      failing: true,
    });
  });
});
