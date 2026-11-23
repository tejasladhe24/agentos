import { getSession, requireOrg } from '@agentos/core/api/auth';
import {
  buildAuthorizeUrl,
  createPkcePair,
  signOAuthState,
} from '@agentos/core/api/oauth';
import type { RouteHandlers } from '@agentos/core/api';

/**
 * Example OAuth start (ticket 78) — session + org required.
 * Provider URLs/client ids stay in the extension; the kit is generic.
 */
export const middleware = [requireOrg];

export const GET: RouteHandlers['GET'] = async (c) => {
  const orgId = getSession(c)?.orgId;
  if (!orgId) {
    return c.json({ error: 'org_required' }, { status: 400 });
  }

  const { verifier, challenge } = await createPkcePair();
  const state = await signOAuthState({
    orgId,
    extensionId: 'demo',
    provider: 'example',
    codeVerifier: verifier,
    returnTo: '/p/demo',
  });

  const redirectUri = new URL(
    '/api/ext/demo/oauth/callback',
    Bun.env.AGENT_OS_GLOBAL_APP_ORIGIN ?? 'http://127.0.0.1:5173',
  ).toString();

  const authorizeUrl = buildAuthorizeUrl({
    authorizeUrl:
      Bun.env.AGENT_OS_EXT_DEMO_OAUTH_AUTHORIZE_URL ??
      'https://example.com/oauth/authorize',
    clientId: Bun.env.AGENT_OS_EXT_DEMO_OAUTH_CLIENT_ID ?? 'demo-client',
    redirectUri,
    state,
    scope: ['openid'],
    codeChallenge: challenge,
  });

  return c.json({ authorizeUrl, state });
};
