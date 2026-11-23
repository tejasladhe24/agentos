import {
  exchangeAuthorizationCode,
  persistOAuthTokens,
  toStoredTokens,
  verifyOAuthState,
} from '@agentos/core/api/oauth';
import type { RouteHandlers } from '@agentos/core/api';

/**
 * Example OAuth callback (ticket 78) — open prefix (no session).
 * Auth is the signed `state` + provider code exchange; tokens go to the vault.
 */
export const GET: RouteHandlers['GET'] = async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    return c.json({ error: 'missing_code_or_state' }, { status: 400 });
  }

  const payload = await verifyOAuthState(state);
  if (!payload) {
    return c.json({ error: 'invalid_state' }, { status: 401 });
  }

  const redirectUri = new URL(
    '/api/ext/demo/oauth/callback',
    Bun.env.AGENT_OS_GLOBAL_APP_ORIGIN ?? 'http://127.0.0.1:5173',
  ).toString();

  // Demo stub: when no real token URL is configured, vault a placeholder.
  const tokenUrl = Bun.env.AGENT_OS_EXT_DEMO_OAUTH_TOKEN_URL;
  let tokens;
  if (tokenUrl) {
    const raw = await exchangeAuthorizationCode({
      tokenUrl,
      code,
      clientId: Bun.env.AGENT_OS_EXT_DEMO_OAUTH_CLIENT_ID ?? 'demo-client',
      clientSecret: Bun.env.AGENT_OS_EXT_DEMO_OAUTH_CLIENT_SECRET,
      redirectUri,
      codeVerifier: payload.codeVerifier,
    });
    tokens = toStoredTokens(raw, { provider: payload.provider });
  } else {
    tokens = {
      accessToken: `demo-stub:${code}`,
      provider: payload.provider,
    };
  }

  await persistOAuthTokens({
    orgId: payload.orgId,
    key: `integrations/${payload.provider}`,
    tokens,
  });

  return c.json({
    ok: true,
    orgId: payload.orgId,
    provider: payload.provider,
    returnTo: payload.returnTo ?? null,
  });
};
