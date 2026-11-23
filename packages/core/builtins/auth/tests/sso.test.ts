import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAuth } from '@agentos/core/builtins/auth/api/lib/create-auth';
import { handleAuthRequest } from '@agentos/core/builtins/auth/api/lib/handle-request';

function cookieHeaderFrom(response: Response): string {
  const cookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

const IDP_ORIGIN = 'https://idp.test';
const MOCK_SSO = {
  providerId: 'mock-oidc',
  domain: 'example.com',
  oidcConfig: {
    issuer: IDP_ORIGIN,
    clientId: 'mock-client',
    clientSecret: 'mock-secret',
    pkce: true,
    discoveryEndpoint: `${IDP_ORIGIN}/.well-known/openid-configuration`,
    authorizationEndpoint: `${IDP_ORIGIN}/authorize`,
    tokenEndpoint: `${IDP_ORIGIN}/token`,
    userInfoEndpoint: `${IDP_ORIGIN}/userinfo`,
    jwksEndpoint: `${IDP_ORIGIN}/jwks`,
    scopes: ['openid', 'email', 'profile'] as string[],
  },
};

describe('auth SSO (Better Auth plugin)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentos-auth-sso-'));
  let ctx: Awaited<ReturnType<typeof createAuth>>;
  const originalFetch = globalThis.fetch;

  test('boots with SSO plugin + defaultSSO', async () => {
    ctx = await createAuth({
      databasePath: join(dir, 'auth.sqlite'),
      baseURL: 'http://127.0.0.1:6110',
      secret: 'test-secret-at-least-32-characters-long!!',
      appOrigin: 'http://localhost:5173',
      seedDemoUsers: true,
      ssoEnv: { trustedOrigins: IDP_ORIGIN },
      ssoOptions: { defaultSSO: [MOCK_SSO] },
    });
    expect(ctx.ssoConfigured).toBe(true);
  });

  test('POST /sign-in/sso returns IdP authorize URL', async () => {
    const res = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/sign-in/sso', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerId: 'mock-oidc',
          callbackURL: 'http://localhost:5173/',
          email: 'sso-user@example.com',
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url?: string; redirect?: boolean };
    expect(body.redirect).toBe(true);
    expect(body.url).toContain(`${IDP_ORIGIN}/authorize`);
    expect(body.url).toContain('client_id=mock-client');
    expect(body.url).toContain('state=');
  });

  test('SSO callback happy path (mocked IdP token + userinfo)', async () => {
    const start = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/sign-in/sso', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerId: 'mock-oidc',
          callbackURL: 'http://localhost:5173/',
          email: 'sso-callback@example.com',
        }),
      }),
    );
    expect(start.status).toBe(200);
    const ssoCookie = cookieHeaderFrom(start);
    expect(ssoCookie.length).toBeGreaterThan(0);
    const { url: authorizeUrl } = (await start.json()) as { url: string };
    const state = new URL(authorizeUrl).searchParams.get('state');
    expect(state).toBeTruthy();

    globalThis.fetch = (async (input, init) => {
      const href =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (href.startsWith(`${IDP_ORIGIN}/token`)) {
        return new Response(
          JSON.stringify({
            access_token: 'mock-access-token',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (href.startsWith(`${IDP_ORIGIN}/userinfo`)) {
        return new Response(
          JSON.stringify({
            sub: 'sso-subject-1',
            email: 'sso-callback@example.com',
            name: 'SSO Callback User',
            email_verified: true,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const callback = await handleAuthRequest(
      ctx,
      new Request(
        `http://127.0.0.1:6110/sso/callback/mock-oidc?code=mock-code&state=${encodeURIComponent(state!)}`,
        {
          method: 'GET',
          redirect: 'manual',
          headers: { cookie: ssoCookie },
        },
      ),
    );

    // Better Auth redirects to callbackURL on success (3xx) with session cookies.
    expect(callback.status).toBeGreaterThanOrEqual(300);
    expect(callback.status).toBeLessThan(400);
    const location = callback.headers.get('location') ?? '';
    expect(location.startsWith('http://localhost:5173/')).toBe(true);
    expect(location.includes('error=')).toBe(false);

    const cookie = cookieHeaderFrom(callback);
    expect(cookie.length).toBeGreaterThan(0);

    const session = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/session', {
        headers: { cookie },
      }),
    );
    expect(session.status).toBe(200);
    const sessionBody = (await session.json()) as {
      user: { email: string };
      roles: string[];
    };
    expect(sessionBody.user.email).toBe('sso-callback@example.com');
    expect(sessionBody.roles).toContain('viewer');
  });

  test('email/password still works alongside SSO', async () => {
    const res = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@example.com',
          password: 'password123',
        }),
      }),
    );
    expect(res.status).toBe(200);
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await ctx?.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
