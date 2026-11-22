import { describe, expect, test } from 'bun:test';

import {
  createAuth,
  isPostgresUrl,
} from '@agentos/core/builtins/auth/api/lib/create-auth';
import { handleAuthRequest } from '@agentos/core/builtins/auth/api/lib/handle-request';

describe('isPostgresUrl', () => {
  test('detects postgres and postgresql schemes', () => {
    expect(isPostgresUrl('postgres://user:pass@localhost:5432/db')).toBe(true);
    expect(isPostgresUrl('postgresql://localhost/db')).toBe(true);
    expect(isPostgresUrl('/tmp/auth.sqlite')).toBe(false);
    expect(isPostgresUrl(':memory:')).toBe(false);
    expect(isPostgresUrl('file:/tmp/auth.sqlite')).toBe(false);
  });
});

const postgresUrl = Bun.env.AGENT_OS_EXT_AUTH_DB;
const runPostgres =
  typeof postgresUrl === 'string' && isPostgresUrl(postgresUrl);

describe.skipIf(!runPostgres)('createAuth postgres backend', () => {
  test(
    'boots, signs up, and checks permissions on Postgres',
    async () => {
      const ctx = await createAuth({
        databasePath: postgresUrl,
        baseURL: 'http://127.0.0.1:6110',
        secret: 'test-secret-at-least-32-characters-long!!',
        seedDemoUsers: false,
      });
      expect(ctx.dialect).toBe('postgres');

      try {
        const health = await handleAuthRequest(
          ctx,
          new Request('http://127.0.0.1:6110/health'),
        );
        expect(health.status).toBe(200);
        expect(await health.json()).toEqual({ ok: true });

        const email = `pg-auth-${Date.now()}@example.com`;
        const signUp = await handleAuthRequest(
          ctx,
          new Request('http://127.0.0.1:6110/sign-up', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              email,
              password: 'password123',
              name: 'Postgres User',
            }),
          }),
        );
        expect(signUp.status).toBe(200);
        const body = (await signUp.json()) as {
          user: { email: string };
          roles: string[];
        };
        expect(body.user.email).toBe(email);
        expect(body.roles).toContain('viewer');

        const cookies =
          typeof signUp.headers.getSetCookie === 'function'
            ? signUp.headers.getSetCookie()
            : [];
        const cookie = cookies.map((c) => c.split(';')[0]).join('; ');

        const session = await handleAuthRequest(
          ctx,
          new Request('http://127.0.0.1:6110/session', {
            headers: { cookie },
          }),
        );
        expect(session.status).toBe(200);

        const check = await handleAuthRequest(
          ctx,
          new Request('http://127.0.0.1:6110/permissions/check', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              cookie,
            },
            body: JSON.stringify({ permission: 'auth.session.read' }),
          }),
        );
        expect(check.status).toBe(200);
        expect(await check.json()).toEqual({
          allowed: true,
          permission: 'auth.session.read',
        });
      } finally {
        await ctx.close();
      }
    },
    { timeout: 60_000 },
  );
});
