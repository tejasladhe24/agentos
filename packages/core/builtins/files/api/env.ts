import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

import { FILES_PORT } from './lib/constants';

type RuntimeEnv = Record<string, string | undefined>;

/** files extension env (`AGENT_OS_EXT_FILES_*`). Pass into app `createEnv({ extends: [keys()] })`. */
export const keys = (runtimeEnv: RuntimeEnv = Bun.env) =>
  createEnv({
    server: {
      AGENT_OS_EXT_FILES_PORT: z.coerce
        .number()
        .int()
        .positive()
        .default(FILES_PORT),
      /** Local filesystem root (default: OS temp `agentos-files`). Ignored when S3 bucket is set. */
      AGENT_OS_EXT_FILES_PATH: z.string().min(1).optional(),
      /** When set, use S3-compatible backend (R2 / AWS S3 / GCS) instead of local disk. */
      AGENT_OS_EXT_FILES_S3_BUCKET: z.string().min(1).optional(),
      AGENT_OS_EXT_FILES_S3_ENDPOINT: z.string().url().optional(),
      AGENT_OS_EXT_FILES_S3_REGION: z.string().min(1).optional(),
      AGENT_OS_EXT_FILES_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
      AGENT_OS_EXT_FILES_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
      AGENT_OS_EXT_FILES_S3_SESSION_TOKEN: z.string().min(1).optional(),
      /** Platform Google OAuth app for personal Google Drive mounts. */
      AGENT_OS_EXT_FILES_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
      AGENT_OS_EXT_FILES_GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
      /** Platform Microsoft Entra app for personal OneDrive / SharePoint mounts. */
      AGENT_OS_EXT_FILES_MICROSOFT_CLIENT_ID: z.string().min(1).optional(),
      AGENT_OS_EXT_FILES_MICROSOFT_CLIENT_SECRET: z.string().min(1).optional(),
      AGENT_OS_EXT_FILES_MICROSOFT_TENANT: z.string().min(1).optional(),
    },
    clientPrefix: 'AGENT_OS_EXT_FILES_CLIENT',
    client: {},
    runtimeEnv: {
      AGENT_OS_EXT_FILES_PORT: runtimeEnv.AGENT_OS_EXT_FILES_PORT,
      AGENT_OS_EXT_FILES_PATH: runtimeEnv.AGENT_OS_EXT_FILES_PATH,
      AGENT_OS_EXT_FILES_S3_BUCKET: runtimeEnv.AGENT_OS_EXT_FILES_S3_BUCKET,
      AGENT_OS_EXT_FILES_S3_ENDPOINT: runtimeEnv.AGENT_OS_EXT_FILES_S3_ENDPOINT,
      AGENT_OS_EXT_FILES_S3_REGION: runtimeEnv.AGENT_OS_EXT_FILES_S3_REGION,
      AGENT_OS_EXT_FILES_S3_ACCESS_KEY_ID:
        runtimeEnv.AGENT_OS_EXT_FILES_S3_ACCESS_KEY_ID,
      AGENT_OS_EXT_FILES_S3_SECRET_ACCESS_KEY:
        runtimeEnv.AGENT_OS_EXT_FILES_S3_SECRET_ACCESS_KEY,
      AGENT_OS_EXT_FILES_S3_SESSION_TOKEN:
        runtimeEnv.AGENT_OS_EXT_FILES_S3_SESSION_TOKEN,
      AGENT_OS_EXT_FILES_GOOGLE_CLIENT_ID:
        runtimeEnv.AGENT_OS_EXT_FILES_GOOGLE_CLIENT_ID,
      AGENT_OS_EXT_FILES_GOOGLE_CLIENT_SECRET:
        runtimeEnv.AGENT_OS_EXT_FILES_GOOGLE_CLIENT_SECRET,
      AGENT_OS_EXT_FILES_MICROSOFT_CLIENT_ID:
        runtimeEnv.AGENT_OS_EXT_FILES_MICROSOFT_CLIENT_ID,
      AGENT_OS_EXT_FILES_MICROSOFT_CLIENT_SECRET:
        runtimeEnv.AGENT_OS_EXT_FILES_MICROSOFT_CLIENT_SECRET,
      AGENT_OS_EXT_FILES_MICROSOFT_TENANT:
        runtimeEnv.AGENT_OS_EXT_FILES_MICROSOFT_TENANT,
    },
    emptyStringAsUndefined: true,
  });
