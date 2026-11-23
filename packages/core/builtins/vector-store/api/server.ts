import { keys } from './env';
import { VECTOR_STORE_PORT } from './lib/constants';
import { createVectorStore } from './lib/create-store';
import { handleVectorStoreRequest } from './lib/handle-request';

const env = keys();

const port = env.AGENT_OS_EXT_VECTOR_STORE_PORT ?? VECTOR_STORE_PORT;

const store = await createVectorStore({
  mode: env.AGENT_OS_EXT_VECTOR_STORE_MODE,
  databaseUrl: env.AGENT_OS_EXT_VECTOR_STORE_DATABASE_URL,
  dimensions: env.AGENT_OS_EXT_VECTOR_STORE_DIMENSIONS,
});

const server = Bun.serve({
  port,
  async fetch(request) {
    return handleVectorStoreRequest({ store, runtimeEnv: Bun.env }, request);
  },
});

console.log(
  `[agentos vector-store] listening on http://127.0.0.1:${server.port} (proxy /api/ext/vector-store/*) mode=${store.mode} dimensions=${store.dimensions}`,
);
