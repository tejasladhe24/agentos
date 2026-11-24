/**
 * @agentos/core/api/oauth — provider-agnostic OAuth connect/callback helpers
 * (ticket 78). Third-party integration OAuth — not Better Auth SSO.
 *
 * Tokens persist via the secrets vault (`putSecret`), never plaintext env or
 * db-store documents on the production path.
 */

import {
  decodeBase64Url,
  encodeBase64Url,
  hmacSha256Base64Url,
  timingSafeEqualString,
} from './hmac';
import type { EnvMap } from './http';
import { putSecret, type SecretMeta, type SecretsCallInit } from './secrets';

/** Signed OAuth `state` payload (CSRF + org binding for the callback). */
export type OAuthStatePayload = {
  orgId: string;
  extensionId: string;
  /** Provider id chosen by the extension (`qbo`, `xero`, `bullhorn`, …). */
  provider: string;
  /** Unix epoch seconds. */
  exp: number;
  /** Optional PKCE verifier (stored in state when not using a server session). */
  codeVerifier?: string;
  /** Optional post-connect redirect path inside the app. */
  returnTo?: string;
  /** User who started the flow — the callback must be completed by them. */
  userId?: string;
  /** Opaque flow context (e.g. the mount being reconnected). */
  context?: string;
};

export type SignOAuthStateInput = {
  orgId: string;
  extensionId: string;
  provider: string;
  /** Time-to-live in seconds (default 600). */
  ttlSeconds?: number;
  codeVerifier?: string;
  returnTo?: string;
  userId?: string;
  context?: string;
  /** Override signing secret (tests). */
  secret?: string;
};

export type BuildAuthorizeUrlInput = {
  authorizeUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string | string[];
  /** PKCE S256 challenge (from {@link createPkcePair}). */
  codeChallenge?: string;
  codeChallengeMethod?: 'S256' | 'plain';
  /** Extra query params (provider-specific). */
  extraParams?: Record<string, string>;
};

export type ExchangeCodeInput = {
  tokenUrl: string;
  code: string;
  clientId: string;
  redirectUri: string;
  clientSecret?: string;
  codeVerifier?: string;
  /** Extra form fields (provider-specific). */
  extraBody?: Record<string, string>;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
};

/** Subset of a typical OAuth token JSON body. */
export type OAuthTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  [key: string]: unknown;
};

/** JSON shape stored in the secrets vault for an OAuth connection. */
export type OAuthStoredTokens = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: string;
  provider?: string;
  raw?: Record<string, unknown>;
};

export type PersistOAuthTokensInput = {
  orgId: string;
  /** Vault key, e.g. `integrations/qbo`. */
  key: string;
  tokens: OAuthStoredTokens;
  /**
   * `org` (default): shared org connection. `user`: personal tokens readable
   * only by `userId` (ticket 104) — e.g. a personal Google Drive mount.
   */
  scope?: 'org' | 'user';
  /** Required when `scope` is `user`: the user completing the OAuth flow. */
  userId?: string;
  env?: EnvMap;
  init?: Omit<SecretsCallInit, 'orgId' | 'ownerUserId'>;
};

function resolveOAuthStateSecret(override?: string): string {
  const secret =
    override ??
    Bun.env.AGENT_OS_GLOBAL_OAUTH_STATE_SECRET ??
    Bun.env.AGENT_OS_GLOBAL_PUBLIC_LINK_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'AGENT_OS_GLOBAL_OAUTH_STATE_SECRET (or AGENT_OS_GLOBAL_PUBLIC_LINK_SECRET) must be set (≥16 chars) to sign/verify OAuth state',
    );
  }
  return secret;
}

function stableStateJson(payload: OAuthStatePayload): string {
  const ordered: Record<string, unknown> = {
    exp: payload.exp,
    extensionId: payload.extensionId,
    orgId: payload.orgId,
    provider: payload.provider,
  };
  if (payload.codeVerifier != null) ordered.codeVerifier = payload.codeVerifier;
  if (payload.returnTo != null) ordered.returnTo = payload.returnTo;
  if (payload.userId != null) ordered.userId = payload.userId;
  if (payload.context != null) ordered.context = payload.context;
  return JSON.stringify(ordered);
}

/**
 * Mint a signed OAuth `state` value.
 * Format: `base64url(payloadJson).base64url(hmac)`.
 */
export async function signOAuthState(
  input: SignOAuthStateInput,
): Promise<string> {
  const secret = resolveOAuthStateSecret(input.secret);
  const ttl = input.ttlSeconds ?? 600;
  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw new Error('ttlSeconds must be a positive number');
  }
  const payload: OAuthStatePayload = {
    orgId: input.orgId,
    extensionId: input.extensionId,
    provider: input.provider,
    exp: Math.floor(Date.now() / 1000) + Math.floor(ttl),
  };
  if (input.codeVerifier) payload.codeVerifier = input.codeVerifier;
  if (input.returnTo) payload.returnTo = input.returnTo;
  if (input.userId) payload.userId = input.userId;
  if (input.context) payload.context = input.context;

  const bodyB64 = encodeBase64Url(
    new TextEncoder().encode(stableStateJson(payload)),
  );
  const sig = await hmacSha256Base64Url(secret, bodyB64);
  return `${bodyB64}.${sig}`;
}

/** Verify and decode OAuth `state`. Returns null when invalid/expired. */
export async function verifyOAuthState(
  state: string,
  options: { secret?: string; nowSeconds?: number } = {},
): Promise<OAuthStatePayload | null> {
  try {
    const secret = resolveOAuthStateSecret(options.secret);
    const parts = state.split('.');
    if (parts.length !== 2) return null;
    const [bodyB64, sig] = parts;
    if (!bodyB64 || !sig) return null;
    const expected = await hmacSha256Base64Url(secret, bodyB64);
    if (!timingSafeEqualString(expected, sig)) return null;

    const json = new TextDecoder().decode(decodeBase64Url(bodyB64));
    const parsed = JSON.parse(json) as Partial<OAuthStatePayload>;
    if (
      typeof parsed.orgId !== 'string' ||
      typeof parsed.extensionId !== 'string' ||
      typeof parsed.provider !== 'string' ||
      typeof parsed.exp !== 'number'
    ) {
      return null;
    }
    const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (parsed.exp <= now) return null;

    const payload: OAuthStatePayload = {
      orgId: parsed.orgId,
      extensionId: parsed.extensionId,
      provider: parsed.provider,
      exp: parsed.exp,
    };
    if (typeof parsed.codeVerifier === 'string') {
      payload.codeVerifier = parsed.codeVerifier;
    }
    if (typeof parsed.returnTo === 'string') {
      payload.returnTo = parsed.returnTo;
    }
    if (typeof parsed.userId === 'string') payload.userId = parsed.userId;
    if (typeof parsed.context === 'string') payload.context = parsed.context;
    return payload;
  } catch {
    return null;
  }
}

/** Build a provider authorize URL (query-encoded). */
export function buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
  const url = new URL(input.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  if (input.scope !== undefined) {
    const scope = Array.isArray(input.scope)
      ? input.scope.join(' ')
      : input.scope;
    if (scope) url.searchParams.set('scope', scope);
  }
  if (input.codeChallenge) {
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set(
      'code_challenge_method',
      input.codeChallengeMethod ?? 'S256',
    );
  }
  if (input.extraParams) {
    for (const [k, v] of Object.entries(input.extraParams)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

/** Create a PKCE verifier + S256 challenge pair. */
export async function createPkcePair(): Promise<{
  verifier: string;
  challenge: string;
}> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = encodeBase64Url(bytes);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: encodeBase64Url(new Uint8Array(digest)) };
}

/**
 * Exchange an authorization code for tokens (`application/x-www-form-urlencoded`).
 */
export async function exchangeAuthorizationCode(
  input: ExchangeCodeInput,
): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('code', input.code);
  body.set('client_id', input.clientId);
  body.set('redirect_uri', input.redirectUri);
  if (input.clientSecret) body.set('client_secret', input.clientSecret);
  if (input.codeVerifier) body.set('code_verifier', input.codeVerifier);
  if (input.extraBody) {
    for (const [k, v] of Object.entries(input.extraBody)) {
      body.set(k, v);
    }
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const res = await fetchImpl(input.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      `oauth exchangeAuthorizationCode failed (${res.status}): ${detail || res.statusText}`,
    );
  }
  const json = (await res.json()) as OAuthTokenResponse;
  if (!json || typeof json.access_token !== 'string') {
    throw new Error('oauth exchangeAuthorizationCode: missing access_token');
  }
  return json;
}

/** Normalize a token response into the vault JSON shape. */
export function toStoredTokens(
  tokens: OAuthTokenResponse,
  options: { provider?: string; nowMs?: number } = {},
): OAuthStoredTokens {
  const now = options.nowMs ?? Date.now();
  const stored: OAuthStoredTokens = {
    accessToken: tokens.access_token,
  };
  if (typeof tokens.refresh_token === 'string') {
    stored.refreshToken = tokens.refresh_token;
  }
  if (typeof tokens.token_type === 'string') {
    stored.tokenType = tokens.token_type;
  }
  if (typeof tokens.scope === 'string') {
    stored.scope = tokens.scope;
  }
  if (
    typeof tokens.expires_in === 'number' &&
    Number.isFinite(tokens.expires_in)
  ) {
    stored.expiresAt = new Date(now + tokens.expires_in * 1000).toISOString();
  }
  if (options.provider) stored.provider = options.provider;
  stored.raw = { ...tokens };
  return stored;
}

/**
 * Persist OAuth tokens in the secrets vault (ticket 77); `scope: 'user'` → user-owned (104).
 * Value is JSON (`OAuthStoredTokens`); never log it.
 */
export async function persistOAuthTokens(
  input: PersistOAuthTokensInput,
): Promise<SecretMeta> {
  if (input.scope === 'user' && !input.userId) {
    throw new Error('persistOAuthTokens: userId required when scope is "user"');
  }
  const value = JSON.stringify(input.tokens);
  return putSecret(
    input.key,
    {
      value,
      expiresAt: input.tokens.expiresAt,
    },
    input.env,
    {
      ...input.init,
      orgId: input.orgId,
      ...(input.scope === 'user' ? { ownerUserId: input.userId } : {}),
    },
  );
}
