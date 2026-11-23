import { keys } from './env';
import { DB_STORE_PORT, DEFAULT_PRUNE_INTERVAL_MS } from './lib/constants';
import { createDb } from './lib/create-db';
import { handleDbStoreRequest } from './lib/handle-request';
import { pruneAllPolicies } from './lib/retention';

const env = keys();

const port = env.AGENT_OS_EXT_DB_STORE_PORT ?? DB_STORE_PORT;

const ctx = await createDb({
  databaseUrl: env.AGENT_OS_EXT_DB_STORE_DATABASE_URL,
  databasePath: env.AGENT_OS_EXT_DB_STORE_PATH,
});

const pruneIntervalMs =
  env.AGENT_OS_EXT_DB_STORE_PRUNE_INTERVAL_MS ?? DEFAULT_PRUNE_INTERVAL_MS;

if (pruneIntervalMs > 0) {
  setInterval(() => {
    void pruneAllPolicies(ctx).catch((error) => {
      console.error('[agentos db-store] retention prune failed', error);
    });
  }, pruneIntervalMs);
}

const server = Bun.serve({
  port,
  async fetch(request) {
    return handleDbStoreRequest(ctx, request);
  },
});

console.log(
  `[agentos db-store] listening on http://127.0.0.1:${server.port} (proxy /api/ext/db-store/*) dialect=${ctx.dialect} pruneIntervalMs=${pruneIntervalMs}`,
);
