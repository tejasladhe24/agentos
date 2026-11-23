import { describe, expect, test } from 'bun:test';

import {
  filtersToQuery,
  hasActiveFilters,
  metaSummary,
  parseFiltersFromSearch,
  parseFiltersFromStorage,
} from '../ui/lib/parse-filters';
import { redactMeta } from '../ui/lib/redact-meta';
import { EMPTY_FILTERS } from '../ui/lib/types';

describe('activity UI helpers', () => {
  test('empty state helpers when no filters', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(metaSummary(undefined)).toBe('—');
  });

  test('loaded / filtered query builders', () => {
    expect(parseFiltersFromSearch('?action=subject.delete&q=alpha')).toEqual({
      action: 'subject.delete',
      q: 'alpha',
    });
    expect(
      parseFiltersFromStorage(
        JSON.stringify({ action: 'doc.view', actor: 'u1', junk: 1 }),
      ),
    ).toEqual({ action: 'doc.view', actor: 'u1' });
    expect(parseFiltersFromStorage('not-json')).toEqual({});

    const params = filtersToQuery({
      ...EMPTY_FILTERS,
      action: ' subject.delete ',
      q: '',
    });
    expect(params.get('action')).toBe('subject.delete');
    expect(params.has('q')).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, resource: 'doc/1' })).toBe(
      true,
    );
    expect(metaSummary({ a: 1 })).toBe('{"a":1}');
  });

  test('error-safe redaction for secret-shaped meta keys', () => {
    expect(redactMeta({ token: 'secret', ok: true })).toEqual({
      token: '[REDACTED]',
      ok: true,
    });
    expect(redactMeta({ nested: { api_key: 'x', title: 'ok' } })).toEqual({
      nested: { api_key: '[REDACTED]', title: 'ok' },
    });
  });
});
