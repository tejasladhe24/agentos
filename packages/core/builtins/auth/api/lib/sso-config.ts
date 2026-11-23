import type { SSOOptions } from '@better-auth/sso';

type EnvLike = Record<string, string | undefined>;

export type AuthSsoEnv = {
  /** When set with client id/secret, registers a default OIDC SSO provider. */
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  domain?: string;
  providerId?: string;
  /** Comma-separated extra trusted origins (IdP discovery hosts). */
  trustedOrigins?: string;
};

/** Read SSO-related env (optional — email/password works without these). */
export function readSsoEnv(env: EnvLike = Bun.env): AuthSsoEnv {
  return {
    issuer: env.AGENT_OS_EXT_AUTH_SSO_ISSUER,
    clientId: env.AGENT_OS_EXT_AUTH_SSO_CLIENT_ID,
    clientSecret: env.AGENT_OS_EXT_AUTH_SSO_CLIENT_SECRET,
    domain: env.AGENT_OS_EXT_AUTH_SSO_DOMAIN,
    providerId: env.AGENT_OS_EXT_AUTH_SSO_PROVIDER_ID,
    trustedOrigins: env.AGENT_OS_EXT_AUTH_SSO_TRUSTED_ORIGINS,
  };
}

/**
 * Build Better Auth `sso()` options from env and/or explicit overrides.
 * Returns undefined when no demo/default IdP is configured (plugin still loads).
 */
export function buildSsoPluginOptions(
  ssoEnv: AuthSsoEnv = {},
  overrides?: Partial<SSOOptions>,
): SSOOptions {
  const options: SSOOptions = {
    providersLimit: 10,
    organizationProvisioning: { disabled: true },
    ...overrides,
  };

  const issuer = ssoEnv.issuer?.trim();
  const clientId = ssoEnv.clientId?.trim();
  const clientSecret = ssoEnv.clientSecret?.trim();
  if (issuer && clientId && clientSecret) {
    const domain = (ssoEnv.domain?.trim() || 'example.com').toLowerCase();
    const providerId = ssoEnv.providerId?.trim() || 'default-oidc';
    options.defaultSSO = [
      {
        providerId,
        domain,
        oidcConfig: {
          issuer,
          clientId,
          clientSecret,
          pkce: true,
          discoveryEndpoint: `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`,
          scopes: ['openid', 'email', 'profile'],
        },
      },
      ...(overrides?.defaultSSO ?? []),
    ];
  } else if (overrides?.defaultSSO) {
    options.defaultSSO = overrides.defaultSSO;
  }

  return options;
}

/** Extra IdP origins to merge into Better Auth `trustedOrigins`. */
export function ssoTrustedOrigins(ssoEnv: AuthSsoEnv): string[] {
  const out: string[] = [];
  if (ssoEnv.issuer) {
    try {
      out.push(new URL(ssoEnv.issuer).origin);
    } catch {
      /* ignore invalid issuer */
    }
  }
  if (ssoEnv.trustedOrigins) {
    for (const part of ssoEnv.trustedOrigins.split(',')) {
      const origin = part.trim();
      if (origin) out.push(origin);
    }
  }
  return out;
}

/** Paths that must be forwarded to Better Auth's handler (SSO plugin). */
export function isBetterAuthForwardPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/sign-in/sso' || path.startsWith('/sign-in/sso/')) return true;
  if (path === '/sso' || path.startsWith('/sso/')) return true;
  return false;
}
