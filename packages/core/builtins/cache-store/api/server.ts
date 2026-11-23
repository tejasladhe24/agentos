import { keys } from './env';
import { CACHE_STORE_PORT } from './lib/constants';
import { createCacheStore } from './lib/create-store';
import { handleCacheStoreRequest } from './lib/handle-request';

const env = keys();

const port = env.AGENT_OS_EXT_CACHE_STORE_PORT ?? CACHE_STORE_PORT;

const cache = createCacheStore({
  redisUrl: env.AGENT_OS_EXT_CACHE_STORE_REDIS_URL,
});

const server = Bun.serve({
  port,
  async fetch(request) {
    return handleCacheStoreRequest(cache, request);
  },
});

console.log(
  `[agentos cache-store] listening on http://127.0.0.1:${server.port} (proxy /api/ext/cache-store/*) backend=${cache.backend}`,
);
