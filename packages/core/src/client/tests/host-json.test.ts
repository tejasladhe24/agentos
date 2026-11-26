import { describe, expect, test } from 'bun:test';
import {
  hostJson,
  parseErrorBody,
  parseHostJson,
} from '@agentos/core/client/lib/host-json';

const ok = (body: string, status = 200) => ({ ok: true, status, body });
const fail = (body: string, status = 500) => ({ ok: false, status, body });

describe('parseErrorBody', () => {
  test('prefers error, then message, then the plain body, then the fallback', () => {
    expect(parseErrorBody('{"error":"bad","message":"m"}', 'f')).toBe('bad');
    expect(parseErrorBody('{"message":"m"}', 'f')).toBe('m');
    expect(parseErrorBody('plain text', 'f')).toBe('plain text');
    expect(parseErrorBody('   ', 'f')).toBe('f');
    expect(parseErrorBody('{"error":""}', 'f')).toBe('{"error":""}');
    expect(parseErrorBody('{"error":3}', 'f')).toBe('{"error":3}');
  });
});

describe('parseHostJson', () => {
  test('parses a successful JSON body', () => {
    const result = parseHostJson<{ items: number[] }>(ok('{"items":[1]}'));
    expect(result).toEqual({
      ok: true,
      status: 200,
      data: { items: [1] },
      error: null,
    });
  });

  test('a failed response carries the server error, status, and no data', () => {
    expect(parseHostJson(fail('{"error":"nope"}', 403), 'Failed')).toEqual({
      ok: false,
      status: 403,
      data: null,
      error: 'nope',
    });
    expect(parseHostJson(fail('', 502), 'Failed to load')).toEqual({
      ok: false,
      status: 502,
      data: null,
      error: 'Failed to load',
    });
  });

  test('a 2xx response with an unparsable body is an error, not a throw', () => {
    expect(parseHostJson(ok('<html>'))).toEqual({
      ok: false,
      status: 200,
      data: null,
      error: 'Invalid response',
    });
  });
});

describe('hostJson', () => {
  test('fetches and parses in one call', async () => {
    const calls: Array<[string, unknown]> = [];
    const api = {
      fetch: async (path: string, init?: unknown) => {
        calls.push([path, init]);
        return ok('{"a":1}');
      },
    };
    const result = await hostJson<{ a: number }>(
      api,
      '/x',
      { method: 'POST' },
      'fallback',
    );
    expect(result.ok && result.data.a).toBe(1);
    expect(calls).toEqual([['/x', { method: 'POST' }]]);
  });
});
