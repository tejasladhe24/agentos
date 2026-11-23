import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

import { DB_STORE_PORT } from './lib/constants';

type RuntimeEnv = Record<string, string | undefined>;

/** db-store extension env (`AGENT_OS_EXT_DB_STORE_*`). Pass into app `createEnv({ extends: [keys()] })`. */
export const keys = (runtimeEnv: RuntimeEnv = Bun.env) =>
  createEnv({
    server: {
      AGENT_OS_EXT_DB_STORE_PORT: z.coerce
        .number()
        .int()
        .positive()
        .default(DB_STORE_PORT),
      AGENT_OS_EXT_DB_STORE_PATH: z.string().min(1).optional(),
      AGENT_OS_EXT_DB_STORE_DATABASE_URL: z.string().min(1).optional(),
      /** Background retention sweep interval (ms). `0` disables. Default 60000. */
      AGENT_OS_EXT_DB_STORE_PRUNE_INTERVAL_MS: z.coerce
        .number()
        .int()
        .nonnegative()
        .optional(),
    },
    clientPrefix: 'AGENT_OS_EXT_DB_STORE_CLIENT',
    client: {},
    runtimeEnv: {
      AGENT_OS_EXT_DB_STORE_PORT: runtimeEnv.AGENT_OS_EXT_DB_STORE_PORT,
      AGENT_OS_EXT_DB_STORE_PATH: runtimeEnv.AGENT_OS_EXT_DB_STORE_PATH,
      AGENT_OS_EXT_DB_STORE_DATABASE_URL:
        runtimeEnv.AGENT_OS_EXT_DB_STORE_DATABASE_URL,
      AGENT_OS_EXT_DB_STORE_PRUNE_INTERVAL_MS:
        runtimeEnv.AGENT_OS_EXT_DB_STORE_PRUNE_INTERVAL_MS,
    },
    emptyStringAsUndefined: true,
  });
