import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

import { DEFAULT_DB_STORE_PORT, HITL_PORT } from './lib/constants';

type RuntimeEnv = Record<string, string | undefined>;

/** hitl extension env (`AGENT_OS_EXT_HITL_*`). Pass into app `createEnv({ extends: [keys()] })`. */
export const keys = (runtimeEnv: RuntimeEnv = Bun.env) =>
  createEnv({
    server: {
      AGENT_OS_EXT_HITL_PORT: z.coerce
        .number()
        .int()
        .positive()
        .default(HITL_PORT),
      /** Peer db-store port for durable approvals. */
      AGENT_OS_EXT_HITL_DB_STORE_PORT: z.coerce
        .number()
        .int()
        .positive()
        .default(DEFAULT_DB_STORE_PORT),
      AGENT_OS_EXT_HITL_DB_STORE_HOST: z.string().min(1).default('127.0.0.1'),
    },
    clientPrefix: 'AGENT_OS_EXT_HITL_CLIENT',
    client: {},
    runtimeEnv: {
      AGENT_OS_EXT_HITL_PORT: runtimeEnv.AGENT_OS_EXT_HITL_PORT,
      AGENT_OS_EXT_HITL_DB_STORE_PORT:
        runtimeEnv.AGENT_OS_EXT_HITL_DB_STORE_PORT ??
        runtimeEnv.AGENT_OS_EXT_DB_STORE_PORT,
      AGENT_OS_EXT_HITL_DB_STORE_HOST:
        runtimeEnv.AGENT_OS_EXT_HITL_DB_STORE_HOST,
    },
    emptyStringAsUndefined: true,
  });
