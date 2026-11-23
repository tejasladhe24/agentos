import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/** Prefix for platform / global env vars. */
export const GLOBAL_PREFIX = 'AGENT_OS_GLOBAL_' as const;

/** Extension folder id → env domain (`db-store` → `DB_STORE`). */
export function extDomain(extensionId: string): string {
  return extensionId.replace(/-/g, '_').toUpperCase();
}

/** Prefix for extension env vars: `AGENT_OS_EXT_<DOMAIN>_`. */
export function extKeyPrefix(extensionIdOrDomain: string): string {
  const domain = extensionIdOrDomain.includes('-')
    ? extDomain(extensionIdOrDomain)
    : extensionIdOrDomain.toUpperCase();
  return `AGENT_OS_EXT_${domain}_`;
}

export function assertGlobalKey(key: string): void {
  if (!key.startsWith(GLOBAL_PREFIX)) {
    throw new Error(
      `Invalid global env key "${key}": must start with ${GLOBAL_PREFIX}`,
    );
  }
}

export function assertExtKey(key: string, extensionIdOrDomain: string): void {
  const prefix = extKeyPrefix(extensionIdOrDomain);
  if (!key.startsWith(prefix)) {
    throw new Error(
      `Invalid extension env key "${key}": must start with ${prefix}`,
    );
  }
}

type RuntimeEnv = Record<string, string | undefined>;

/** Platform / global env (`AGENT_OS_GLOBAL_*`). Pass into app `createEnv({ extends: [platformKeys()] })`. */
export const platformKeys = (runtimeEnv: RuntimeEnv = Bun.env) =>
  createEnv({
    server: {
      AGENT_OS_GLOBAL_NODE_ENV: z
        .enum(['development', 'production', 'test'])
        .optional(),
      /** Consumer Shell origin (password-reset links, trustedOrigins, secure cookies). */
      AGENT_OS_GLOBAL_APP_ORIGIN: z.url().optional(),
      /**
       * HMAC secret for short-lived public extension link tokens (ticket 72).
       * Required to mint/verify portal links (≥16 chars recommended).
       */
      AGENT_OS_GLOBAL_PUBLIC_LINK_SECRET: z.string().min(16).optional(),
    },
    clientPrefix: 'AGENT_OS_GLOBAL_CLIENT',
    client: {},
    runtimeEnv: {
      AGENT_OS_GLOBAL_NODE_ENV: runtimeEnv.AGENT_OS_GLOBAL_NODE_ENV,
      AGENT_OS_GLOBAL_APP_ORIGIN: runtimeEnv.AGENT_OS_GLOBAL_APP_ORIGIN,
      AGENT_OS_GLOBAL_PUBLIC_LINK_SECRET:
        runtimeEnv.AGENT_OS_GLOBAL_PUBLIC_LINK_SECRET,
    },
    emptyStringAsUndefined: true,
  });
