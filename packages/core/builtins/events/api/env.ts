import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

import {
  DEFAULT_DB_STORE_PORT,
  DEFAULT_LEASE_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_TICK_MS,
  EVENTS_PORT,
} from './lib/constants';

type RuntimeEnv = Record<string, string | undefined>;

/** events extension env (`AGENT_OS_EXT_EVENTS_*`). Pass into app `createEnv({ extends: [keys()] })`. */
export const keys = (runtimeEnv: RuntimeEnv = Bun.env) =>
  createEnv({
    server: {
      AGENT_OS_EXT_EVENTS_PORT: z.coerce
        .number()
        .int()
        .positive()
        .default(EVENTS_PORT),
      /** Peer db-store port for durable outbox + jobs. */
      AGENT_OS_EXT_EVENTS_DB_STORE_PORT: z.coerce
        .number()
        .int()
        .positive()
        .default(DEFAULT_DB_STORE_PORT),
      AGENT_OS_EXT_EVENTS_DB_STORE_HOST: z.string().min(1).default('127.0.0.1'),
      AGENT_OS_EXT_EVENTS_LEASE_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(DEFAULT_LEASE_MS),
      AGENT_OS_EXT_EVENTS_MAX_ATTEMPTS: z.coerce
        .number()
        .int()
        .positive()
        .default(DEFAULT_MAX_ATTEMPTS),
      AGENT_OS_EXT_EVENTS_TICK_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(DEFAULT_TICK_MS),
    },
    clientPrefix: 'AGENT_OS_EXT_EVENTS_CLIENT',
    client: {},
    runtimeEnv: {
      AGENT_OS_EXT_EVENTS_PORT: runtimeEnv.AGENT_OS_EXT_EVENTS_PORT,
      AGENT_OS_EXT_EVENTS_DB_STORE_PORT:
        runtimeEnv.AGENT_OS_EXT_EVENTS_DB_STORE_PORT ??
        runtimeEnv.AGENT_OS_EXT_DB_STORE_PORT,
      AGENT_OS_EXT_EVENTS_DB_STORE_HOST:
        runtimeEnv.AGENT_OS_EXT_EVENTS_DB_STORE_HOST,
      AGENT_OS_EXT_EVENTS_LEASE_MS: runtimeEnv.AGENT_OS_EXT_EVENTS_LEASE_MS,
      AGENT_OS_EXT_EVENTS_MAX_ATTEMPTS:
        runtimeEnv.AGENT_OS_EXT_EVENTS_MAX_ATTEMPTS,
      AGENT_OS_EXT_EVENTS_TICK_MS: runtimeEnv.AGENT_OS_EXT_EVENTS_TICK_MS,
    },
    emptyStringAsUndefined: true,
  });
