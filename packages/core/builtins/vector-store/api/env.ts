import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

import { DEFAULT_DIMENSIONS, VECTOR_STORE_PORT } from './lib/constants';

type RuntimeEnv = Record<string, string | undefined>;

/** vector-store extension env (`AGENT_OS_EXT_VECTOR_STORE_*`). */
export const keys = (runtimeEnv: RuntimeEnv = Bun.env) =>
  createEnv({
    server: {
      AGENT_OS_EXT_VECTOR_STORE_PORT: z.coerce
        .number()
        .int()
        .positive()
        .default(VECTOR_STORE_PORT),
      /**
       * `memory` | `pgvector` | `auto` (default).
       * `auto` → pgvector when DATABASE_URL set, else memory.
       */
      AGENT_OS_EXT_VECTOR_STORE_MODE: z
        .enum(['memory', 'pgvector', 'auto'])
        .default('auto'),
      /** Postgres URL for pgvector mode. Builtin-only — never a customer DATABASE_URL. */
      AGENT_OS_EXT_VECTOR_STORE_DATABASE_URL: z.string().min(1).optional(),
      /** Embedding dimension; must match `ai.embed` output. */
      AGENT_OS_EXT_VECTOR_STORE_DIMENSIONS: z.coerce
        .number()
        .int()
        .positive()
        .max(16_384)
        .default(DEFAULT_DIMENSIONS),
    },
    clientPrefix: 'AGENT_OS_EXT_VECTOR_STORE_CLIENT',
    client: {},
    runtimeEnv: {
      AGENT_OS_EXT_VECTOR_STORE_PORT: runtimeEnv.AGENT_OS_EXT_VECTOR_STORE_PORT,
      AGENT_OS_EXT_VECTOR_STORE_MODE: runtimeEnv.AGENT_OS_EXT_VECTOR_STORE_MODE,
      AGENT_OS_EXT_VECTOR_STORE_DATABASE_URL:
        runtimeEnv.AGENT_OS_EXT_VECTOR_STORE_DATABASE_URL,
      AGENT_OS_EXT_VECTOR_STORE_DIMENSIONS:
        runtimeEnv.AGENT_OS_EXT_VECTOR_STORE_DIMENSIONS,
    },
    emptyStringAsUndefined: true,
  });
