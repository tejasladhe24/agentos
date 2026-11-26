import { afterEach, describe, expect, test } from 'bun:test';

import { builtinApiEnv } from '../lib/builtin-servers';

const original = Bun.env.AGENT_OS_EVENTS_SERVICE_TOKEN;
afterEach(() => {
  if (original === undefined) delete Bun.env.AGENT_OS_EVENTS_SERVICE_TOKEN;
  else Bun.env.AGENT_OS_EVENTS_SERVICE_TOKEN = original;
});

describe('builtinApiEnv events service token', () => {
  test('generates a random 256-bit token per call when unset', () => {
    delete Bun.env.AGENT_OS_EVENTS_SERVICE_TOKEN;
    const a = builtinApiEnv('http://gw.test').AGENT_OS_EVENTS_SERVICE_TOKEN;
    const b = builtinApiEnv('http://gw.test').AGENT_OS_EVENTS_SERVICE_TOKEN;
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  test('honors an operator-pinned token', () => {
    Bun.env.AGENT_OS_EVENTS_SERVICE_TOKEN = '  pinned-token  ';
    expect(builtinApiEnv('http://gw.test').AGENT_OS_EVENTS_SERVICE_TOKEN).toBe(
      'pinned-token',
    );
  });
});
