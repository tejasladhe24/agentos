import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

import { SECRETS_PORT } from './lib/constants';

type RuntimeEnv = Record<string, string | undefined>;

/** secrets extension env (`AGENT_OS_EXT_SECRETS_*`). Pass into app `createEnv({ extends: [keys()] })`. */
export const keys = (runtimeEnv: RuntimeEnv = Bun.env) =>
  createEnv({
    server: {
      AGENT_OS_EXT_SECRETS_PORT: z.coerce
        .number()
        .int()
        .positive()
        .default(SECRETS_PORT),
      /** Optional JSON object of secret key → value (env fallback / bootstrap). */
      AGENT_OS_EXT_SECRETS_MAP: z.string().min(1).optional(),
      /**
       * AES-256 master key for vault encryption at rest.
       * 32-byte value as base64 (preferred) or 64-char hex. Required for PUT.
       */
      AGENT_OS_EXT_SECRETS_MASTER_KEY: z.string().min(1).optional(),
      AGENT_OS_EXT_SECRETS_DB_STORE_HOST: z
        .string()
        .min(1)
        .default('127.0.0.1'),
      AGENT_OS_EXT_SECRETS_DB_STORE_PORT: z.coerce
        .number()
        .int()
        .positive()
        .default(6111),
      AGENT_OS_EXT_SECRETS_AUTH_API_BASE: z.string().url().optional(),
    },
    clientPrefix: 'AGENT_OS_EXT_SECRETS_CLIENT',
    client: {},
    runtimeEnv: {
      AGENT_OS_EXT_SECRETS_PORT: runtimeEnv.AGENT_OS_EXT_SECRETS_PORT,
      AGENT_OS_EXT_SECRETS_MAP: runtimeEnv.AGENT_OS_EXT_SECRETS_MAP,
      AGENT_OS_EXT_SECRETS_MASTER_KEY:
        runtimeEnv.AGENT_OS_EXT_SECRETS_MASTER_KEY,
      AGENT_OS_EXT_SECRETS_DB_STORE_HOST:
        runtimeEnv.AGENT_OS_EXT_SECRETS_DB_STORE_HOST,
      AGENT_OS_EXT_SECRETS_DB_STORE_PORT:
        runtimeEnv.AGENT_OS_EXT_SECRETS_DB_STORE_PORT ??
        runtimeEnv.AGENT_OS_EXT_DB_STORE_PORT,
      AGENT_OS_EXT_SECRETS_AUTH_API_BASE:
        runtimeEnv.AGENT_OS_EXT_SECRETS_AUTH_API_BASE,
    },
    emptyStringAsUndefined: true,
  });
