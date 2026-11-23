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
      /** Peer db-store port for durable inbox / deliveries. */
      AGENT_OS_EXT_NOTIFICATIONS_DB_STORE_PORT: z.coerce
        .number()
        .int()
        .positive()
        .default(DEFAULT_DB_STORE_PORT),
      AGENT_OS_EXT_NOTIFICATIONS_DB_STORE_HOST: z
        .string()
        .min(1)
        .default('127.0.0.1'),
      /** `log` (default), `resend`, or `cloudflare` (Email Sending REST). */
      AGENT_OS_EXT_NOTIFICATIONS_EMAIL_PROVIDER: z
        .enum(['log', 'resend', 'cloudflare'])
        .default('log'),
      /** Resend API key, or Cloudflare API token (Email Sending Write). */
      AGENT_OS_EXT_NOTIFICATIONS_EMAIL_API_KEY: z.string().min(1).optional(),
      AGENT_OS_EXT_NOTIFICATIONS_EMAIL_FROM: z.string().min(1).optional(),
      /** Cloudflare account id — required when EMAIL_PROVIDER=cloudflare. */
      AGENT_OS_EXT_NOTIFICATIONS_EMAIL_ACCOUNT_ID: z.string().min(1).optional(),
      /** `log` (default) or `twilio`. */
      AGENT_OS_EXT_NOTIFICATIONS_SMS_PROVIDER: z
        .enum(['log', 'twilio'])
        .default('log'),
      AGENT_OS_EXT_NOTIFICATIONS_SMS_ACCOUNT_SID: z.string().min(1).optional(),
      AGENT_OS_EXT_NOTIFICATIONS_SMS_AUTH_TOKEN: z.string().min(1).optional(),
      AGENT_OS_EXT_NOTIFICATIONS_SMS_FROM: z.string().min(1).optional(),
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
      AGENT_OS_EXT_NOTIFICATIONS_EMAIL_PROVIDER:
        runtimeEnv.AGENT_OS_EXT_NOTIFICATIONS_EMAIL_PROVIDER,
      AGENT_OS_EXT_NOTIFICATIONS_EMAIL_API_KEY:
        runtimeEnv.AGENT_OS_EXT_NOTIFICATIONS_EMAIL_API_KEY,
      AGENT_OS_EXT_NOTIFICATIONS_EMAIL_FROM:
        runtimeEnv.AGENT_OS_EXT_NOTIFICATIONS_EMAIL_FROM,
      AGENT_OS_EXT_NOTIFICATIONS_EMAIL_ACCOUNT_ID:
        runtimeEnv.AGENT_OS_EXT_NOTIFICATIONS_EMAIL_ACCOUNT_ID,
      AGENT_OS_EXT_NOTIFICATIONS_SMS_PROVIDER:
        runtimeEnv.AGENT_OS_EXT_NOTIFICATIONS_SMS_PROVIDER,
      AGENT_OS_EXT_NOTIFICATIONS_SMS_ACCOUNT_SID:
        runtimeEnv.AGENT_OS_EXT_NOTIFICATIONS_SMS_ACCOUNT_SID,
      AGENT_OS_EXT_NOTIFICATIONS_SMS_AUTH_TOKEN:
        runtimeEnv.AGENT_OS_EXT_NOTIFICATIONS_SMS_AUTH_TOKEN,
      AGENT_OS_EXT_NOTIFICATIONS_SMS_FROM:
        runtimeEnv.AGENT_OS_EXT_NOTIFICATIONS_SMS_FROM,
    },
    emptyStringAsUndefined: true,
  });
