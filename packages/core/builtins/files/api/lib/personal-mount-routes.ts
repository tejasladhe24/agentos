import {
  buildAuthorizeUrl,
  createPkcePair,
  exchangeAuthorizationCode,
  signOAuthState,
  toStoredTokens,
  verifyOAuthState,
  type OAuthStoredTokens,
} from '@agentos/core/api/oauth';

import { PERMISSION_FILES_READ } from './constants';
import {
  ensurePermission,
  mountResolver,
  resolveOrgOrError,
  viewerOf,
  type FilesContext,
} from './context';
import { json, readJson } from './http';
import type { FilesMount, MountRecord } from './mount-types';
import type { StorageProviderDefinition } from './storage-providers';

const ROUTE = /^\/personal-mounts\/([a-z0-9-]+)\/(connect|callback)$/;
const DEFAULT_RETURN_TO = '/';
const DEFAULT_ORIGIN = 'http://127.0.0.1:5173';

/** Query flag the Files UI reads after the OAuth round trip. */
export const DRIVE_RESULT_PARAM = 'files_drive';

function appOrigin(env: Record<string, string | undefined>): string {
  return (env.AGENT_OS_GLOBAL_APP_ORIGIN ?? DEFAULT_ORIGIN).replace(/\/+$/, '');
}

export function personalCallbackUrl(
  env: Record<string, string | undefined>,
  providerId: string,
): string {
  return `${appOrigin(env)}/api/ext/files/personal-mounts/${providerId}/callback`;
}

/** Same-origin relative paths only (no `//host` or scheme). */
function safeReturnTo(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) {
    return DEFAULT_RETURN_TO;
  }
  return raw.includes('\\') ? DEFAULT_RETURN_TO : raw;
}

function finish(
  returnTo: string,
  status: 'connected' | 'error',
  message?: string,
): Response {
  const url = new URL(returnTo, 'http://app.invalid');
  url.searchParams.set(DRIVE_RESULT_PARAM, status);
  if (message) url.searchParams.set(`${DRIVE_RESULT_PARAM}_message`, message);
  return new Response(null, {
    status: 302,
    headers: { location: `${url.pathname}${url.search}${url.hash}` },
  });
}

function personalProvider(
  ctx: FilesContext,
  id: string,
): StorageProviderDefinition | undefined {
  const provider = ctx.providers?.get(id);
  return provider?.personal && provider.oauth ? provider : undefined;
}

function env(ctx: FilesContext): Record<string, string | undefined> {
  return ctx.runtimeEnv ?? Bun.env;
}

async function handleConnect(
  ctx: FilesContext,
  request: Request,
  provider: StorageProviderDefinition,
): Promise<Response> {
  const org = await resolveOrgOrError(ctx, request);
  if (org instanceof Response) return org;
  if (org.via !== 'session' || !org.userId) {
    return json(
      { error: 'sign in to connect a personal drive' },
      { status: 403 },
    );
  }
  const denied = await ensurePermission(
    ctx,
    request,
    org,
    PERMISSION_FILES_READ,
  );
  if (denied) return denied;
  const oauth = provider.oauth!;
  const client = oauth.client(env(ctx));
  if (!client || !ctx.tokens || !ctx.mounts) {
    return json(
      {
        error: `${provider.label} is not configured on this deployment`,
        code: 'not_configured',
      },
      { status: 503 },
    );
  }
  const body = await readJson<{ mountId?: unknown; returnTo?: unknown }>(
    request,
  );
  if (body instanceof Response) return body;

  let reconnect: FilesMount | undefined;
  if (typeof body.mountId === 'string' && body.mountId) {
    reconnect = await mountResolver(ctx).get(
      org.orgId,
      body.mountId,
      viewerOf(org),
    );
    if (
      !reconnect ||
      reconnect.kind !== 'personal' ||
      reconnect.provider !== provider.id
    ) {
      return json(
        { error: `mount not found: ${body.mountId}` },
        { status: 404 },
      );
    }
  }

  const { verifier, challenge } = await createPkcePair();
  const state = await signOAuthState({
    orgId: org.orgId,
    extensionId: 'files',
    provider: provider.id,
    userId: org.userId,
    codeVerifier: verifier,
    returnTo: safeReturnTo(body.returnTo),
    ...(reconnect ? { context: reconnect.id } : {}),
  });
  const email =
    typeof reconnect?.config?.email === 'string'
      ? reconnect.config.email
      : undefined;
  const url = buildAuthorizeUrl({
    authorizeUrl: oauth.authorizeUrl,
    clientId: client.clientId,
    redirectUri: personalCallbackUrl(env(ctx), provider.id),
    state,
    scope: [...oauth.scopes],
    codeChallenge: challenge,
    extraParams: {
      ...oauth.authorizeParams,
      ...(email ? { login_hint: email } : {}),
    },
  });
  return json({ url });
}

function newPersonalMountId(): string {
  return `p_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

async function handleCallback(
  ctx: FilesContext,
  request: Request,
  provider: StorageProviderDefinition,
): Promise<Response> {
  const url = new URL(request.url);
  const payload = await verifyOAuthState(url.searchParams.get('state') ?? '');
  if (
    !payload ||
    payload.extensionId !== 'files' ||
    payload.provider !== provider.id
  ) {
    return finish(
      DEFAULT_RETURN_TO,
      'error',
      'The connection link expired. Try connecting again.',
    );
  }
  const returnTo = safeReturnTo(payload.returnTo);
  const providerError = url.searchParams.get('error');
  if (providerError) {
    return finish(
      returnTo,
      'error',
      providerError === 'access_denied'
        ? `${provider.label} access was not granted.`
        : `${provider.label} returned an error (${providerError}).`,
    );
  }
  const code = url.searchParams.get('code');
  if (!code) return finish(returnTo, 'error', 'Missing authorization code.');

  // The browser that finishes the flow must be the user who started it.
  const org = await resolveOrgOrError(ctx, request);
  if (
    org instanceof Response ||
    org.via !== 'session' ||
    org.userId !== payload.userId ||
    org.orgId !== payload.orgId
  ) {
    return finish(
      returnTo,
      'error',
      'Sign in as the user who started the connection, then try again.',
    );
  }
  const userId = org.userId!;
  const oauth = provider.oauth!;
  const client = oauth.client(env(ctx));
  if (!client || !ctx.tokens || !ctx.mounts) {
    return finish(
      returnTo,
      'error',
      `${provider.label} is not configured on this deployment.`,
    );
  }

  let tokens: OAuthStoredTokens;
  let account;
  try {
    const raw = await exchangeAuthorizationCode({
      tokenUrl: oauth.tokenUrl,
      code,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      redirectUri: personalCallbackUrl(env(ctx), provider.id),
      ...(payload.codeVerifier ? { codeVerifier: payload.codeVerifier } : {}),
      ...(ctx.oauthFetch ? { fetchImpl: ctx.oauthFetch } : {}),
    });
    const { raw: _raw, ...stored } = toStoredTokens(raw, {
      provider: provider.id,
    });
    tokens = stored;
    account = await oauth.identify(tokens.accessToken);
  } catch {
    return finish(
      returnTo,
      'error',
      `Could not finish connecting ${provider.label}. Try again.`,
    );
  }

  const mine = (await ctx.mounts.list(org.orgId)).filter(
    (r) =>
      r.kind === 'personal' &&
      r.ownerUserId === userId &&
      r.provider === provider.id,
  );
  let existing: MountRecord | undefined;
  if (payload.context) {
    existing = mine.find((r) => r.id === payload.context);
    if (!existing) {
      return finish(returnTo, 'error', 'That drive was disconnected.');
    }
    const expected = existing.config?.accountId;
    if (expected && expected !== account.accountId) {
      const email = existing.config?.email;
      return finish(
        returnTo,
        'error',
        `Reconnect with the same account${typeof email === 'string' ? ` (${email})` : ''}.`,
      );
    }
  } else {
    existing = mine.find((r) => r.config?.accountId === account.accountId);
  }

  const mountId = existing?.id ?? newPersonalMountId();
  if (!tokens.refreshToken) {
    const previous = await ctx.tokens
      .get(org.orgId, userId, mountId)
      .catch(() => undefined);
    if (previous?.refreshToken) tokens.refreshToken = previous.refreshToken;
  }
  const now = new Date().toISOString();
  const label = account.email
    ? `${provider.label} (${account.email})`
    : provider.label;
  const record: MountRecord = {
    id: mountId,
    kind: 'personal',
    ownerUserId: userId,
    provider: provider.id,
    name: existing?.name ?? label,
    isDefault: false,
    status: 'connected',
    config: {
      accountId: account.accountId,
      ...(account.email ? { email: account.email } : {}),
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await ctx.tokens.put(org.orgId, userId, mountId, tokens);
  await ctx.mounts.put(org.orgId, record, { actor: userId });
  mountResolver(ctx).invalidate(org.orgId, mountId);
  return finish(returnTo, 'connected');
}

/** `/personal-mounts/:provider/(connect|callback)` — personal OAuth drives. */
export async function handlePersonalMountsRequest(
  ctx: FilesContext,
  request: Request,
  path: string,
  method: string,
): Promise<Response | null> {
  const match = path.match(ROUTE);
  if (!match) return null;
  const provider = personalProvider(ctx, match[1]!);
  if (!provider) {
    return json(
      { error: 'personal drive provider not available' },
      {
        status: 404,
      },
    );
  }
  if (match[2] === 'connect' && method === 'POST') {
    return handleConnect(ctx, request, provider);
  }
  if (match[2] === 'callback' && method === 'GET') {
    return handleCallback(ctx, request, provider);
  }
  return json({ error: 'method not allowed' }, { status: 405 });
}

/** Disconnect a personal mount: revoke at the provider, drop tokens + record. */
export async function disconnectPersonalMount(
  ctx: FilesContext,
  orgId: string,
  mount: FilesMount,
): Promise<void> {
  const owner = mount.ownerUserId;
  if (owner && ctx.tokens) {
    const tokens = await ctx.tokens.get(orgId, owner, mount.id).catch(() => {
      return undefined;
    });
    const revoke = ctx.providers?.get(mount.provider)?.oauth?.revoke;
    if (tokens && revoke) await revoke(tokens).catch(() => undefined);
    await ctx.tokens.delete(orgId, owner, mount.id);
  }
  await ctx.mounts?.delete(orgId, mount.id, owner);
  mountResolver(ctx).invalidate(orgId, mount.id);
}

/**
 * Member removed (`secrets.user_purged`): their tokens are already gone, so
 * drop every personal mount record they owned in the org.
 */
export async function purgeUserMounts(
  ctx: FilesContext,
  orgId: string,
  userId: string,
): Promise<number> {
  if (!ctx.mounts) return 0;
  const owned = (await ctx.mounts.list(orgId)).filter(
    (r) => r.kind === 'personal' && r.ownerUserId === userId,
  );
  for (const record of owned) {
    await ctx.mounts.delete(orgId, record.id);
    mountResolver(ctx).invalidate(orgId, record.id);
  }
  return owned.length;
}
