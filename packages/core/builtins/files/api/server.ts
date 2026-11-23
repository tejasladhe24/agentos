import { keys } from './env';
import { createBlobStore } from './lib/blob-store';
import { FILES_PORT } from './lib/constants';
import { handleFilesRequest } from './lib/handle-request';
import { createFilesObjectIndex } from './lib/object-index';
import { createFilesOrgSettingsStore } from './lib/org-settings';

const env = keys();

const port = env.AGENT_OS_EXT_FILES_PORT ?? FILES_PORT;

const store = await createBlobStore({
  path: env.AGENT_OS_EXT_FILES_PATH,
  s3: env.AGENT_OS_EXT_FILES_S3_BUCKET
    ? {
        bucket: env.AGENT_OS_EXT_FILES_S3_BUCKET,
        endpoint: env.AGENT_OS_EXT_FILES_S3_ENDPOINT,
        region: env.AGENT_OS_EXT_FILES_S3_REGION,
        accessKeyId: env.AGENT_OS_EXT_FILES_S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: env.AGENT_OS_EXT_FILES_S3_SECRET_ACCESS_KEY ?? '',
        sessionToken: env.AGENT_OS_EXT_FILES_S3_SESSION_TOKEN,
      }
    : undefined,
});

const dbHost =
  (Bun.env.AGENT_OS_EXT_FILES_DB_STORE_HOST as string | undefined) ??
  '127.0.0.1';
const dbPort = Number(
  (Bun.env.AGENT_OS_EXT_FILES_DB_STORE_PORT as string | undefined) ?? 6111,
);
const dbBase = `http://${dbHost}:${dbPort}`;
const index = createFilesObjectIndex(dbBase);
const settings = createFilesOrgSettingsStore(dbBase);

const server = Bun.serve({
  port,
  async fetch(request) {
    return handleFilesRequest(
      { store, runtimeEnv: Bun.env, index, settings },
      request,
    );
  },
});

console.log(
  `[agentos files] listening on http://127.0.0.1:${server.port} (proxy /api/ext/files/*) backend=${store.backend} label=${store.label}`,
);
