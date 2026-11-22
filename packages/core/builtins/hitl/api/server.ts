import { keys } from './env';
import { createApprovalsStore } from './lib/approvals-store';
import { HITL_PORT } from './lib/constants';
import { createDbStoreClient } from './lib/db-store-client';
import { handleHitlRequest } from './lib/handle-request';

const env = keys();

const port = env.AGENT_OS_EXT_HITL_PORT ?? HITL_PORT;
const dbHost = env.AGENT_OS_EXT_HITL_DB_STORE_HOST ?? '127.0.0.1';
const dbPort = env.AGENT_OS_EXT_HITL_DB_STORE_PORT ?? 6111;

const db = createDbStoreClient(`http://${dbHost}:${dbPort}`);
const store = createApprovalsStore(db);

const server = Bun.serve({
  port,
  async fetch(request) {
    return handleHitlRequest(store, request);
  },
});

console.log(
  `[agentos hitl] listening on http://127.0.0.1:${server.port} (proxy /api/ext/hitl/*) db-store=http://${dbHost}:${dbPort}`,
);
