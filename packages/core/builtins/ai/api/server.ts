import {
  createHttpIntegrationsBackend,
  createIntegrationsKit,
  createSessionOrgResolver,
  createSessionPermissionCheck,
  watchIntegrationChanges,
} from '@agentos/core/api/integrations';
import { stats as vectorStoreStats } from '@agentos/core/api/vector-store';

import { aiConfigFromEnv, keys } from './env';
import {
  createAiIntegrationDefinition,
  createAiModelResolver,
} from './lib/ai-integration';
import { handleAiIntegrationRoutes } from './lib/ai-integration-routes';
import { AI_PORT, DEFAULT_GATEWAY_URL } from './lib/constants';
import { createAiModels, getCachedAiModels } from './lib/create-model';
import { handleAiRequest } from './lib/handle-request';
import { createAuditUsageRecorder } from './lib/usage-attribution';

const env = keys();

const port = env.AGENT_OS_EXT_AI_PORT ?? AI_PORT;
const gatewayUrl = env.AGENT_OS_EXT_AI_GATEWAY_URL ?? DEFAULT_GATEWAY_URL;
const models = createAiModels(aiConfigFromEnv(env));

if (models.mode === 'mock' && env.AGENT_OS_EXT_AI_MODEL) {
  console.warn(
    '[agentos ai] AGENT_OS_EXT_AI_MODEL is set but AGENT_OS_EXT_AI_PROVIDER is not; using mock models',
  );
}

const kit = createIntegrationsKit(createHttpIntegrationsBackend());
watchIntegrationChanges(kit);

const resolveOrg = createSessionOrgResolver();
const checkPermission = createSessionPermissionCheck();
const definition = createAiIntegrationDefinition({
  platform: models,
  buildModels: getCachedAiModels,
});

const resolveModels = createAiModelResolver({
  kit,
  platform: models,
  buildModels: getCachedAiModels,
  resolveOrgId: async (request) => {
    const org = await resolveOrg(request);
    return org.ok ? org.orgId : null;
  },
});

const handleIntegrations = (request: Request) =>
  handleAiIntegrationRoutes(
    {
      kit,
      definition,
      platform: models,
      resolveOrg,
      checkPermission,
      countVectors: async (orgId) =>
        (await vectorStoreStats({ orgId })).vectors,
    },
    request,
  );

const recordUsage = createAuditUsageRecorder();

const server = Bun.serve({
  port,
  async fetch(request) {
    return handleAiRequest(
      { models, gatewayUrl, resolveModels, handleIntegrations, recordUsage },
      request,
    );
  },
});

console.log(
  `[agentos ai] listening on http://127.0.0.1:${server.port} (proxy /api/ext/ai/*) mode=${models.mode} provider=${models.provider} model=${models.model}`,
);
