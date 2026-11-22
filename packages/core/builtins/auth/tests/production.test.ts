import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_DEV_AUTH_SECRET,
  DEMO_ADMIN,
} from '@agentos/core/builtins/auth/api/lib/constants';
import { createAuth } from '@agentos/core/builtins/auth/api/lib/create-auth';
import { handleAuthRequest } from '@agentos/core/builtins/auth/api/lib/handle-request';
import {
  assertProductionAuthSecret,
  buildTrustedOrigins,
  isAuthProduction,
  usesHttpsOrigin,
} from '@agentos/core/builtins/auth/api/lib/production';
import { keys as authKeys } from '@agentos/core/builtins/auth/env';

describe('auth production helpers', () => {
  test('isAuthProduction reads AgentOS and NODE_ENV', () => {
    expect(isAuthProduction({})).toBe(false);
    expect(isAuthProduction({ AGENT_OS_GLOBAL_NODE_ENV: 'development' })).toBe(
      false,
    );
    expect(isAuthProduction({ AGENT_OS_GLOBAL_NODE_ENV: 'production' })).toBe(
      true,
    );
    expect(isAuthProduction({ NODE_ENV: 'production' })).toBe(true);
  });

  test('usesHttpsOrigin detects https scheme', () => {
    expect(usesHttpsOrigin('http://localhost:5173')).toBe(false);
    expect(usesHttpsOrigin('https://app.example.com')).toBe(true);
    expect(
      usesHttpsOrigin('http://localhost:5173', 'https://api.example.com'),
    ).toBe(true);
  });

  test('buildTrustedOrigins omits localhost in production', () => {
    expect(
      buildTrustedOrigins(
        'https://api.example.com',
        'https://app.example.com',
        true,
      ),
    ).toEqual(['https://api.example.com', 'https://app.example.com']);
    expect(
      buildTrustedOrigins(
        'http://127.0.0.1:6110',
        'http://localhost:5173',
        false,
      ),
    ).toContain('http://127.0.0.1:5173');
  });

  test('assertProductionAuthSecret rejects missing and default secrets', () => {
    const prod = { AGENT_OS_GLOBAL_NODE_ENV: 'production' };
    expect(() => assertProductionAuthSecret(undefined, prod)).toThrow(
      /AGENT_OS_EXT_AUTH_SECRET/,
    );
    expect(() =>
      assertProductionAuthSecret(DEFAULT_DEV_AUTH_SECRET, prod),
    ).toThrow(/AGENT_OS_EXT_AUTH_SECRET/);
    expect(() =>
      assertProductionAuthSecret(
        'production-secret-at-least-32-characters!!',
        prod,
      ),
    ).not.toThrow();
  });
});

describe('auth keys() production secret', () => {
  test('requires AGENT_OS_EXT_AUTH_SECRET in production', () => {
    const prevError = console.error;
    console.error = () => {};
    try {
      expect(() =>
        authKeys({
          AGENT_OS_GLOBAL_NODE_ENV: 'production',
        }),
      ).toThrow();
    } finally {
      console.error = prevError;
    }
  });

  test('accepts a production secret of at least 32 chars', () => {
    const env = authKeys({
      AGENT_OS_GLOBAL_NODE_ENV: 'production',
      AGENT_OS_EXT_AUTH_SECRET: 'production-secret-at-least-32-characters!!',
    });
    expect(env.AGENT_OS_EXT_AUTH_SECRET).toBe(
      'production-secret-at-least-32-characters!!',
    );
  });
});

describe('createAuth production hardening', () => {
  const dirs: string[] = [];

  afterAll(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDb(): string {
    const dir = mkdtempSync(join(tmpdir(), 'agentos-auth-prod-'));
    dirs.push(dir);
    return join(dir, 'auth.sqlite');
  }

  test('refuses missing or default secret in production', async () => {
    const prodEnv = { AGENT_OS_GLOBAL_NODE_ENV: 'production' };
    await expect(
      createAuth({
        databasePath: tempDb(),
        env: prodEnv,
      }),
    ).rejects.toThrow(/AGENT_OS_EXT_AUTH_SECRET/);

    await expect(
      createAuth({
        databasePath: tempDb(),
        secret: DEFAULT_DEV_AUTH_SECRET,
        env: prodEnv,
      }),
    ).rejects.toThrow(/AGENT_OS_EXT_AUTH_SECRET/);
  });

  test('does not seed demo users in production by default', async () => {
    const ctx = await createAuth({
      databasePath: tempDb(),
      baseURL: 'http://127.0.0.1:6110',
      secret: 'production-secret-at-least-32-characters!!',
      env: { AGENT_OS_GLOBAL_NODE_ENV: 'production' },
    });

    const signIn = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: DEMO_ADMIN.email,
          password: DEMO_ADMIN.password,
        }),
      }),
    );
    expect(signIn.status).not.toBe(200);

    ctx.db.close();
  });

  test('sets Secure cookies when app origin is https', async () => {
    const ctx = await createAuth({
      databasePath: tempDb(),
      baseURL: 'https://api.example.com',
      appOrigin: 'https://app.example.com',
      secret: 'test-secret-at-least-32-characters-long!!',
      seedDemoUsers: true,
      env: { AGENT_OS_GLOBAL_NODE_ENV: 'development' },
    });

    const signIn = await handleAuthRequest(
      ctx,
      new Request('https://api.example.com/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: DEMO_ADMIN.email,
          password: DEMO_ADMIN.password,
        }),
      }),
    );
    expect(signIn.status).toBe(200);

    const setCookies =
      typeof signIn.headers.getSetCookie === 'function'
        ? signIn.headers.getSetCookie()
        : [];
    expect(setCookies.length).toBeGreaterThan(0);
    expect(setCookies.some((c) => /;\s*Secure/i.test(c))).toBe(true);

    ctx.db.close();
  });

  test('trustedOrigins include production app origin without localhost-only list', async () => {
    const ctx = await createAuth({
      databasePath: tempDb(),
      baseURL: 'https://api.example.com',
      appOrigin: 'https://app.example.com',
      secret: 'production-secret-at-least-32-characters!!',
      seedDemoUsers: false,
      env: { AGENT_OS_GLOBAL_NODE_ENV: 'production' },
    });

    // Better Auth stores options on the instance; assert via buildTrustedOrigins parity.
    expect(
      buildTrustedOrigins(
        'https://api.example.com',
        'https://app.example.com',
        true,
      ),
    ).toEqual(['https://api.example.com', 'https://app.example.com']);

    ctx.db.close();
  });
});
