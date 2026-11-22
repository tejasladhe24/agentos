/**
 * Gateway host env (`AGENT_OS_DB_STORE_API_BASE`, …) for enable-state persistence.
 * Prefer peer db-store over looping through the gateway proxy (ticket 60).
 */

import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

type RuntimeEnv = Record<string, string | undefined>;

/** Default peer URL for builtin db-store (see CLI `BUILTIN_SERVERS`). */
export const DEFAULT_DB_STORE_API_BASE = 'http://127.0.0.1:6111';

/**
 * Gateway runtime env. Pass into app `createEnv({ extends: [gatewayKeys()] })`
 * when the host needs peer routing for platform control-plane state.
 */
export const gatewayKeys = (runtimeEnv: RuntimeEnv = Bun.env) =>
  createEnv({
    server: {
      /**
       * Direct db-store HTTP base (no `/api/ext/db-store` hop).
       * Defaults to the local builtin peer port.
       */
      AGENT_OS_DB_STORE_API_BASE: z.url().default(DEFAULT_DB_STORE_API_BASE),
    },
    clientPrefix: 'AGENT_OS_GATEWAY_CLIENT',
    client: {},
    runtimeEnv: {
      AGENT_OS_DB_STORE_API_BASE: runtimeEnv.AGENT_OS_DB_STORE_API_BASE,
    },
    emptyStringAsUndefined: true,
  });
