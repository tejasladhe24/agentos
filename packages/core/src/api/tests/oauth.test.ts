import { afterEach, describe, expect, test } from 'bun:test';

import {
  buildAuthorizeUrl,
  createPkcePair,
  exchangeAuthorizationCode,
  persistOAuthTokens,
  signOAuthState,
  toStoredTokens,
  verifyOAuthState,
} from '@agentos/core/api/oauth';

const SECRET = 'test-oauth-state-secret-32chars!!';
const originalFetch = globalThis.fetch;
const originalOauthSecret = Bun.env.AGENT_OS_GLOBAL_OAUTH_STATE_SECRET;
const originalPublicSecret = Bun.env.AGENT_OS_GLOBAL_PUBLIC_LINK_SECRET;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalOauthSecret === undefined) {
    delete Bun.env.AGENT_OS_GLOBAL_OAUTH_STATE_SECRET;
  } else {
    Bun.env.AGENT_OS_GLOBAL_OAUTH_STATE_SECRET = originalOauthSecret;
  }
  if (originalPublicSecret === undefined) {
    delete Bun.env.AGENT_OS_GLOBAL_PUBLIC_LINK_SECRET;
  } else {
    Bun.env.AGENT_OS_GLOBAL_PUBLIC_LINK_SECRET = originalPublicSecret;
  }
});

describe('oauth state', () => {
  test('sign + verify round-trip', async () => {
    const state = await signOAuthState({
      orgId: 'org-1',
      extensionId: 'ledger',
      provider: 'qbo',
      returnTo: '/integrations',
      ttlSeconds: 120,
      secret: SECRET,
    });
    const payload = await verifyOAuthState(state, { secret: SECRET });
    expect(payload).toMatchObject({
      orgId: 'org-1',
      extensionId: 'ledger',
      provider: 'qbo',
      returnTo: '/integrations',
    });
    expect(payload!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test('rejects expired and tampered state', async () => {
    const state = await signOAuthState({
      orgId: 'org-1',
      extensionId: 'ledger',
      provider: 'qbo',
      ttlSeconds: 60,
      secret: SECRET,
    });
    expect(
      await verifyOAuthState(state, {
        secret: SECRET,
        nowSeconds: Math.floor(Date.now() / 1000) + 120,
      }),
    ).toBeNull();

    const [body] = state.split('.');
    const bad = `${body}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
    expect(await verifyOAuthState(bad, { secret: SECRET })).toBeNull();
  });

  test('falls back to public-link secret', async () => {
    delete Bun.env.AGENT_OS_GLOBAL_OAUTH_STATE_SECRET;
    Bun.env.AGENT_OS_GLOBAL_PUBLIC_LINK_SECRET = SECRET;
    const state = await signOAuthState({
      orgId: 'org-1',
      extensionId: 'ats',
      provider: 'bullhorn',
    });
    expect(await verifyOAuthState(state)).toMatchObject({
      provider: 'bullhorn',
    });
  });
});

describe('oauth authorize + exchange', () => {
  test('buildAuthorizeUrl encodes params + PKCE', async () => {
    const { verifier, challenge } = await createPkcePair();
    expect(verifier.length).toBeGreaterThan(20);
    expect(challenge.length).toBeGreaterThan(20);

    const url = buildAuthorizeUrl({
      authorizeUrl: 'https://provider.example/oauth/authorize',
      clientId: 'cid',
      redirectUri: 'https://app.example/api/ext/ledger/oauth/callback',
      state: 'abc.state',
      scope: ['openid', 'accounting'],
      codeChallenge: challenge,
      extraParams: { audience: 'api' },
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('client_id')).toBe('cid');
    expect(parsed.searchParams.get('scope')).toBe('openid accounting');
    expect(parsed.searchParams.get('code_challenge')).toBe(challenge);
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('audience')).toBe('api');
  });

  test('exchangeAuthorizationCode posts form body', async () => {
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      expect(url).toBe('https://provider.example/oauth/token');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('content-type')).toBe(
        'application/x-www-form-urlencoded',
      );
      const body = new URLSearchParams(String(init?.body ?? ''));
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('auth-code');
      expect(body.get('code_verifier')).toBe('verifier');
      return Response.json({
        access_token: 'access',
        refresh_token: 'refresh',
        expires_in: 3600,
        token_type: 'bearer',
      });
    }) as typeof fetch;

    const tokens = await exchangeAuthorizationCode({
      tokenUrl: 'https://provider.example/oauth/token',
      code: 'auth-code',
      clientId: 'cid',
      redirectUri: 'https://app.example/callback',
      codeVerifier: 'verifier',
    });
    expect(tokens.access_token).toBe('access');
    expect(toStoredTokens(tokens, { provider: 'qbo', nowMs: 0 })).toMatchObject(
      {
        accessToken: 'access',
        refreshToken: 'refresh',
        provider: 'qbo',
        expiresAt: new Date(3600_000).toISOString(),
      },
    );
  });

  test('persistOAuthTokens writes JSON via secrets vault', async () => {
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      expect(url).toBe('http://secrets.test/secrets/integrations%2Fqbo');
      expect(init?.method).toBe('PUT');
      expect(new Headers(init?.headers).get('x-agentos-org-id')).toBe('org-1');
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        value: string;
        expiresAt?: string;
      };
      const stored = JSON.parse(body.value) as { accessToken: string };
      expect(stored.accessToken).toBe('access');
      return Response.json({
        key: 'integrations/qbo',
        rotatedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
      });
    }) as typeof fetch;

    const meta = await persistOAuthTokens({
      orgId: 'org-1',
      key: 'integrations/qbo',
      tokens: { accessToken: 'access', refreshToken: 'refresh' },
      env: { AGENT_OS_SECRETS_API_BASE: 'http://secrets.test' },
    });
    expect(meta).toMatchObject({ key: 'integrations/qbo', version: 1 });
  });
});
