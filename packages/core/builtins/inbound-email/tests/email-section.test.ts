import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_EMAIL_SECTION,
  EMAIL_SECTIONS,
  isEmailSection,
  parseEmailSection,
} from '../ui/email-section';
import {
  authenticationSummary,
  filesBlobUrl,
  parseErrorBody,
} from '../ui/email-types';

describe('email manager UI helpers', () => {
  test('parses email sections', () => {
    expect(EMAIL_SECTIONS).toContain('inbox');
    expect(isEmailSection('compose')).toBe(true);
    expect(isEmailSection('nope')).toBe(false);
    expect(parseEmailSection('deliveries')).toBe('deliveries');
    expect(parseEmailSection(null)).toBe(DEFAULT_EMAIL_SECTION);
  });

  test('parseErrorBody + filesBlobUrl', () => {
    expect(parseErrorBody('{"error":"forbidden"}', 'x')).toBe('forbidden');
    expect(parseErrorBody('plain', 'fallback')).toBe('plain');
    expect(filesBlobUrl('orgs/a/inbound/1.pdf')).toBe(
      '/api/ext/files/blobs/orgs%2Fa%2Finbound%2F1.pdf',
    );
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
