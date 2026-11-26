import { describe, expect, test } from 'bun:test';
import {
  parseSearchString,
  pathToView,
  stringifySearchRecord,
  targetFromLocation,
  targetHref,
  targetsEqual,
  viewToPath,
} from '@agentos/core/shell/lib';

describe('view ↔ path mapping', () => {
  test('viewToPath maps Home, Settings, and extension ids', () => {
    expect(viewToPath('home')).toBe('/');
    expect(viewToPath('settings')).toBe('/settings');
    expect(viewToPath('extensions')).toBe('/extensions');
    expect(viewToPath('crm')).toBe('/ext/crm');
    expect(viewToPath('my ext')).toBe('/ext/my%20ext');
  });

  test('pathToView is the inverse for workspace paths', () => {
    expect(pathToView('/')).toBe('home');
    expect(pathToView('')).toBe('home');
    expect(pathToView('/settings')).toBe('settings');
    expect(pathToView('/settings/')).toBe('settings');
    expect(pathToView('/extensions')).toBe('extensions');
    expect(pathToView('/extensions/')).toBe('extensions');
    expect(pathToView('/ext/crm')).toBe('crm');
    expect(pathToView('/ext/hitl')).toBe('hitl');
    expect(pathToView('/ext/my%20ext')).toBe('my ext');
  });

  test('pathToView returns null for non-workspace paths', () => {
    expect(pathToView('/login')).toBeNull();
    expect(pathToView('/p/demo')).toBeNull();
    expect(pathToView('/ext')).toBeNull();
    expect(pathToView('/ext/')).toBeNull();
    expect(pathToView('/ext/crm/deeper')).toBeNull();
    expect(pathToView('/extensions/deeper')).toBeNull();
    expect(pathToView('/ext/%E0%A4%A')).toBeNull();
    expect(pathToView('/totally-missing')).toBeNull();
  });

  test('round-trips every view', () => {
    for (const view of ['home', 'settings', 'crm', 'files', 'a-b_c']) {
      expect(pathToView(viewToPath(view))).toBe(view);
    }
  });
});

describe('route targets', () => {
  test('targetFromLocation reads settings section + entry', () => {
    expect(
      targetFromLocation('/settings', '?section=files%3Astorage&entry=s3'),
    ).toEqual({ view: 'settings', section: 'files:storage', entry: 's3' });
    expect(targetFromLocation('/settings', '')).toEqual({
      view: 'settings',
      section: undefined,
      entry: undefined,
    });
  });

  test('entry without a section is ignored', () => {
    expect(targetFromLocation('/settings', '?entry=s3')).toEqual({
      view: 'settings',
      section: undefined,
      entry: undefined,
    });
  });

  test('non-settings views ignore search', () => {
    expect(targetFromLocation('/ext/crm', '?section=x')).toEqual({
      view: 'crm',
    });
  });

  test('targetFromLocation is null off the workspace', () => {
    expect(targetFromLocation('/login', '?next=%2F')).toBeNull();
  });

  test('targetHref builds canonical hrefs', () => {
    expect(targetHref({ view: 'home' })).toBe('/');
    expect(targetHref({ view: 'crm' })).toBe('/ext/crm');
    expect(targetHref({ view: 'settings' })).toBe('/settings');
    expect(
      targetHref({ view: 'settings', section: 'files:storage', entry: 's3' }),
    ).toBe('/settings?section=files%3Astorage&entry=s3');
    expect(targetHref({ view: 'settings', entry: 's3' })).toBe('/settings');
  });

  test('targetHref ↔ targetFromLocation round-trip', () => {
    const target = {
      view: 'settings',
      section: 'ai:providers',
      entry: 'openai key',
    };
    const href = targetHref(target);
    const [pathname, search = ''] = href.split('?');
    expect(
      targetFromLocation(pathname ?? '', search ? `?${search}` : ''),
    ).toEqual(target);
  });

  test('targetsEqual compares settings selection only for settings', () => {
    expect(targetsEqual({ view: 'crm' }, { view: 'crm' })).toBe(true);
    expect(targetsEqual({ view: 'crm' }, { view: 'files' })).toBe(false);
    expect(
      targetsEqual(
        { view: 'settings', section: 'a' },
        { view: 'settings', section: 'b' },
      ),
    ).toBe(false);
    expect(
      targetsEqual({ view: 'settings' }, { view: 'settings', section: 'a' }),
    ).toBe(false);
    expect(
      targetsEqual(
        { view: 'settings', section: 'a', entry: 'e' },
        { view: 'settings', section: 'a', entry: 'e' },
      ),
    ).toBe(true);
  });
});

describe('search codec', () => {
  test('keeps every value a string (no JSON coercion)', () => {
    expect(parseSearchString('?token=1e5&n=007&t=true&nul=null')).toEqual({
      token: '1e5',
      n: '007',
      t: 'true',
      nul: 'null',
    });
  });

  test('round-trips opaque tokens unchanged', () => {
    const token = '1e5';
    expect(stringifySearchRecord(parseSearchString(`?token=${token}`))).toBe(
      `?token=${token}`,
    );
  });

  test('stringify drops empty values and returns "" when empty', () => {
    expect(stringifySearchRecord({ a: undefined, b: null, c: '' })).toBe('');
    expect(stringifySearchRecord({ a: 'x y', b: 2 })).toBe('?a=x+y&b=2');
  });

  test('parse accepts a missing leading "?"', () => {
    expect(parseSearchString('a=1')).toEqual({ a: '1' });
    expect(parseSearchString('')).toEqual({});
  });
});
