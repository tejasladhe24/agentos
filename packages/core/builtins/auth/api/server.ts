import { CACHE_STORE_PORT } from '@agentos/core/builtins/cache-store/api/lib/constants';
import { keys } from './env';
import { AUTH_PORT } from './lib/constants';
import { createAuth } from './lib/create-auth';
import { handleAuthRequest } from './lib/handle-request';

const env = keys();

const port = env.AGENT_OS_EXT_AUTH_PORT ?? AUTH_PORT;

const cachePort =
  Number(Bun.env.AGENT_OS_EXT_CACHE_STORE_PORT) || CACHE_STORE_PORT;

const ctx = await createAuth({
  secret: env.AGENT_OS_EXT_AUTH_SECRET,
  databasePath: env.AGENT_OS_EXT_AUTH_DB,
  baseURL: env.AGENT_OS_EXT_AUTH_BASE_URL,
  permissionCache: {
    baseUrl: `http://127.0.0.1:${cachePort}`,
  },
});

const server = Bun.serve({
  port,
  async fetch(request) {
    return handleAuthRequest(ctx, request);
  },
});

console.log(
  `[agentos auth] listening on http://127.0.0.1:${server.port} (proxy /api/ext/auth/*)`,
);
