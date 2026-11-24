import {
  createHttpIntegrationsBackend,
  createIntegrationsKit,
  watchIntegrationChanges,
} from '@agentos/core/api/integrations';

import { keys } from './env';
import { createBlobStore, PLATFORM_STORAGE_PROVIDERS } from './lib/blob-store';
import { FILES_PORT } from './lib/constants';
import { createGoogleDriveProvider } from './lib/google-drive-provider';
import { handleFilesRequest } from './lib/handle-request';
import { createIntegrationsMountStore } from './lib/mount-store';
import { createFilesObjectIndex } from './lib/object-index';
import { createFilesOrgSettingsStore } from './lib/org-settings';
import { purgeUserMounts } from './lib/personal-mount-routes';
import { createVaultPersonalTokenStore } from './lib/personal-tokens';
import { createOneDriveProvider } from './lib/onedrive-provider';
import { createS3MountProvider } from './lib/s3-mount-provider';
import { storageProviders } from './lib/storage-providers';
import {
  createUploadThingProvider,
  createVercelBlobProvider,
} from './lib/upload-service-providers';
import { watchTopic } from './lib/watch-topic';

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

for (const provider of [
  ...PLATFORM_STORAGE_PROVIDERS,
  createS3MountProvider(),
  createUploadThingProvider(),
  createVercelBlobProvider(),
  createGoogleDriveProvider(),
  createOneDriveProvider(),
]) {
  if (!storageProviders.get(provider.id)) storageProviders.register(provider);
}

const dbHost =
  (Bun.env.AGENT_OS_EXT_FILES_DB_STORE_HOST as string | undefined) ??
  '127.0.0.1';
const dbPort = Number(
  (Bun.env.AGENT_OS_EXT_FILES_DB_STORE_PORT as string | undefined) ?? 6111,
);
const dbBase = `http://${dbHost}:${dbPort}`;
const index = createFilesObjectIndex(dbBase);
const settings = createFilesOrgSettingsStore(dbBase);
const integrations = createIntegrationsKit(
  createHttpIntegrationsBackend({ dbStoreApiBase: dbBase }),
);
watchIntegrationChanges(integrations);
const mounts = createIntegrationsMountStore(integrations);

const ctx = {
  store,
  runtimeEnv: Bun.env,
  index,
  settings,
  mounts,
  providers: storageProviders,
  tokens: createVaultPersonalTokenStore(Bun.env),
};

watchTopic('secrets.user_purged', async (payload) => {
  const { orgId, userId } = (payload ?? {}) as {
    orgId?: unknown;
    userId?: unknown;
  };
  if (typeof orgId === 'string' && typeof userId === 'string') {
    await purgeUserMounts(ctx, orgId, userId);
  }
});

const server = Bun.serve({
  port,
  async fetch(request) {
    return handleFilesRequest(ctx, request);
  },
});

console.log(
  `[agentos files] listening on http://127.0.0.1:${server.port} (proxy /api/ext/files/*) backend=${store.backend} label=${store.label}`,
);
