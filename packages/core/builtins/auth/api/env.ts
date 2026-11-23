import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

import { AUTH_PORT, DEFAULT_DEV_AUTH_SECRET } from './lib/constants';
import { isAuthProduction } from './lib/production';

type RuntimeEnv = Record<string, string | undefined>;

/** Auth extension env (`AGENT_OS_EXT_AUTH_*`). Pass into app `createEnv({ extends: [keys()] })`. */
export const keys = (runtimeEnv: RuntimeEnv = Bun.env) => {
  const production = isAuthProduction(runtimeEnv);

  return createEnv({
    server: {
      AGENT_OS_EXT_AUTH_SECRET: production
        ? z.string().min(32)
        : z.string().min(1).default(DEFAULT_DEV_AUTH_SECRET),
      AGENT_OS_EXT_AUTH_DB: z.string().min(1).optional(),
      AGENT_OS_EXT_AUTH_BASE_URL: z.url().optional(),
      AGENT_OS_EXT_AUTH_PORT: z.coerce
        .number()
        .int()
        .positive()
        .default(AUTH_PORT),
      /** Explicit demo-seed override (`true`/`false`). Unset → seed only outside production. */
      AGENT_OS_EXT_AUTH_SEED_DEMO: z.enum(['true', 'false']).optional(),
      /** OIDC issuer URL for defaultSSO (e.g. https://acme.auth0.com). */
      AGENT_OS_EXT_AUTH_SSO_ISSUER: z.url().optional(),
      AGENT_OS_EXT_AUTH_SSO_CLIENT_ID: z.string().min(1).optional(),
      AGENT_OS_EXT_AUTH_SSO_CLIENT_SECRET: z.string().min(1).optional(),
      /** Email domain matched to the default IdP (default example.com). */
      AGENT_OS_EXT_AUTH_SSO_DOMAIN: z.string().min(1).optional(),
      /** Better Auth providerId for defaultSSO (default default-oidc). */
      AGENT_OS_EXT_AUTH_SSO_PROVIDER_ID: z.string().min(1).optional(),
      /** Comma-separated extra trusted origins for IdP discovery. */
      AGENT_OS_EXT_AUTH_SSO_TRUSTED_ORIGINS: z.string().min(1).optional(),
    },
    clientPrefix: 'AGENT_OS_EXT_AUTH_CLIENT',
    client: {},
    runtimeEnv: {
      AGENT_OS_EXT_AUTH_SECRET: runtimeEnv.AGENT_OS_EXT_AUTH_SECRET,
      AGENT_OS_EXT_AUTH_DB: runtimeEnv.AGENT_OS_EXT_AUTH_DB,
      AGENT_OS_EXT_AUTH_BASE_URL: runtimeEnv.AGENT_OS_EXT_AUTH_BASE_URL,
      AGENT_OS_EXT_AUTH_PORT: runtimeEnv.AGENT_OS_EXT_AUTH_PORT,
      AGENT_OS_EXT_AUTH_SEED_DEMO: runtimeEnv.AGENT_OS_EXT_AUTH_SEED_DEMO,
      AGENT_OS_EXT_AUTH_SSO_ISSUER: runtimeEnv.AGENT_OS_EXT_AUTH_SSO_ISSUER,
      AGENT_OS_EXT_AUTH_SSO_CLIENT_ID:
        runtimeEnv.AGENT_OS_EXT_AUTH_SSO_CLIENT_ID,
      AGENT_OS_EXT_AUTH_SSO_CLIENT_SECRET:
        runtimeEnv.AGENT_OS_EXT_AUTH_SSO_CLIENT_SECRET,
      AGENT_OS_EXT_AUTH_SSO_DOMAIN: runtimeEnv.AGENT_OS_EXT_AUTH_SSO_DOMAIN,
      AGENT_OS_EXT_AUTH_SSO_PROVIDER_ID:
        runtimeEnv.AGENT_OS_EXT_AUTH_SSO_PROVIDER_ID,
      AGENT_OS_EXT_AUTH_SSO_TRUSTED_ORIGINS:
        runtimeEnv.AGENT_OS_EXT_AUTH_SSO_TRUSTED_ORIGINS,
    },
    emptyStringAsUndefined: true,
  });
};
