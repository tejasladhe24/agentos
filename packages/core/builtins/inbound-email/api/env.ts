import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

import { DEFAULT_DB_STORE_PORT, INBOUND_EMAIL_PORT } from './lib/constants';

type RuntimeEnv = Record<string, string | undefined>;

/** inbound-email extension env (`AGENT_OS_EXT_INBOUND_EMAIL_*`). */
export const keys = (runtimeEnv: RuntimeEnv = Bun.env) =>
  createEnv({
    server: {
      AGENT_OS_EXT_INBOUND_EMAIL_PORT: z.coerce
        .number()
        .int()
        .positive()
        .default(INBOUND_EMAIL_PORT),
      AGENT_OS_EXT_INBOUND_EMAIL_DB_STORE_PORT: z.coerce
        .number()
        .int()
        .positive()
        .default(DEFAULT_DB_STORE_PORT),
      AGENT_OS_EXT_INBOUND_EMAIL_DB_STORE_HOST: z
        .string()
        .min(1)
        .default('127.0.0.1'),
      AGENT_OS_EXT_INBOUND_EMAIL_FILES_HOST: z
        .string()
        .min(1)
        .default('127.0.0.1'),
      AGENT_OS_EXT_INBOUND_EMAIL_FILES_PORT: z.coerce
        .number()
        .int()
        .positive()
        .default(6116),
      AGENT_OS_EXT_INBOUND_EMAIL_EVENTS_HOST: z
        .string()
        .min(1)
        .default('127.0.0.1'),
      AGENT_OS_EXT_INBOUND_EMAIL_EVENTS_PORT: z.coerce
        .number()
        .int()
        .positive()
        .default(6115),
      /** Platform default: `fixture` (local/tests) or `resend`. */
      AGENT_OS_EXT_INBOUND_EMAIL_PROVIDER: z
        .enum(['fixture', 'resend'])
        .default('fixture'),
      /** HMAC secret for fixture webhooks. */
      AGENT_OS_EXT_INBOUND_EMAIL_WEBHOOK_SECRET: z.string().min(1).optional(),
      /** Platform Resend API key (fetches received email content). */
      AGENT_OS_EXT_INBOUND_EMAIL_RESEND_API_KEY: z.string().min(1).optional(),
      /** Platform Resend webhook signing secret (`whsec_…`). */
      AGENT_OS_EXT_INBOUND_EMAIL_RESEND_SIGNING_SECRET: z
        .string()
        .min(1)
        .optional(),
      /**
       * Demo address map: `coi@inbound.example.com=org_demo,renewals@x=org_2`
       * (comma-separated; `=` or `:` separators).
       */
      AGENT_OS_EXT_INBOUND_EMAIL_ADDRESS_MAP: z.string().optional(),
    },
    clientPrefix: 'AGENT_OS_EXT_INBOUND_EMAIL_CLIENT',
    client: {},
    runtimeEnv: {
      AGENT_OS_EXT_INBOUND_EMAIL_PORT:
        runtimeEnv.AGENT_OS_EXT_INBOUND_EMAIL_PORT,
      AGENT_OS_EXT_INBOUND_EMAIL_DB_STORE_PORT:
        runtimeEnv.AGENT_OS_EXT_INBOUND_EMAIL_DB_STORE_PORT ??
        runtimeEnv.AGENT_OS_EXT_DB_STORE_PORT,
      AGENT_OS_EXT_INBOUND_EMAIL_DB_STORE_HOST:
        runtimeEnv.AGENT_OS_EXT_INBOUND_EMAIL_DB_STORE_HOST,
      AGENT_OS_EXT_INBOUND_EMAIL_FILES_HOST:
        runtimeEnv.AGENT_OS_EXT_INBOUND_EMAIL_FILES_HOST,
      AGENT_OS_EXT_INBOUND_EMAIL_FILES_PORT:
        runtimeEnv.AGENT_OS_EXT_INBOUND_EMAIL_FILES_PORT,
      AGENT_OS_EXT_INBOUND_EMAIL_EVENTS_HOST:
        runtimeEnv.AGENT_OS_EXT_INBOUND_EMAIL_EVENTS_HOST,
      AGENT_OS_EXT_INBOUND_EMAIL_EVENTS_PORT:
        runtimeEnv.AGENT_OS_EXT_INBOUND_EMAIL_EVENTS_PORT,
      AGENT_OS_EXT_INBOUND_EMAIL_PROVIDER:
        runtimeEnv.AGENT_OS_EXT_INBOUND_EMAIL_PROVIDER,
      AGENT_OS_EXT_INBOUND_EMAIL_WEBHOOK_SECRET:
        runtimeEnv.AGENT_OS_EXT_INBOUND_EMAIL_WEBHOOK_SECRET,
      AGENT_OS_EXT_INBOUND_EMAIL_RESEND_API_KEY:
        runtimeEnv.AGENT_OS_EXT_INBOUND_EMAIL_RESEND_API_KEY,
      AGENT_OS_EXT_INBOUND_EMAIL_RESEND_SIGNING_SECRET:
        runtimeEnv.AGENT_OS_EXT_INBOUND_EMAIL_RESEND_SIGNING_SECRET,
      AGENT_OS_EXT_INBOUND_EMAIL_ADDRESS_MAP:
        runtimeEnv.AGENT_OS_EXT_INBOUND_EMAIL_ADDRESS_MAP,
    },
    emptyStringAsUndefined: true,
  });
