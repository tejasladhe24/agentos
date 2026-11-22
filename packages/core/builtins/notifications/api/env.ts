import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

import { DEFAULT_DB_STORE_PORT, NOTIFICATIONS_PORT } from './lib/constants';

type RuntimeEnv = Record<string, string | undefined>;

/** notifications extension env (`AGENT_OS_EXT_NOTIFICATIONS_*`). Pass into app `createEnv({ extends: [keys()] })`. */
export const keys = (runtimeEnv: RuntimeEnv = Bun.env) =>
  createEnv({
    server: {
      AGENT_OS_EXT_NOTIFICATIONS_PORT: z.coerce
        .number()
        .int()
        .positive()
        .default(NOTIFICATIONS_PORT),
      /** Peer db-store port for durable inbox. */
      AGENT_OS_EXT_NOTIFICATIONS_DB_STORE_PORT: z.coerce
        .number()
        .int()
        .positive()
        .default(DEFAULT_DB_STORE_PORT),
      AGENT_OS_EXT_NOTIFICATIONS_DB_STORE_HOST: z
        .string()
        .min(1)
        .default('127.0.0.1'),
    },
    clientPrefix: 'AGENT_OS_EXT_NOTIFICATIONS_CLIENT',
    client: {},
    runtimeEnv: {
      AGENT_OS_EXT_NOTIFICATIONS_PORT:
        runtimeEnv.AGENT_OS_EXT_NOTIFICATIONS_PORT,
      AGENT_OS_EXT_NOTIFICATIONS_DB_STORE_PORT:
        runtimeEnv.AGENT_OS_EXT_NOTIFICATIONS_DB_STORE_PORT ??
        runtimeEnv.AGENT_OS_EXT_DB_STORE_PORT,
      AGENT_OS_EXT_NOTIFICATIONS_DB_STORE_HOST:
        runtimeEnv.AGENT_OS_EXT_NOTIFICATIONS_DB_STORE_HOST,
    },
    emptyStringAsUndefined: true,
  });
