import { keys } from './env';
import { AUDIT_PORT } from './lib/constants';
import { createDbStoreClient } from './lib/db-store-client';
import { handleAuditRequest } from './lib/handle-request';

const env = keys();

const port = env.AGENT_OS_EXT_AUDIT_PORT ?? AUDIT_PORT;
const dbHost = env.AGENT_OS_EXT_AUDIT_DB_STORE_HOST ?? '127.0.0.1';
const dbPort = env.AGENT_OS_EXT_AUDIT_DB_STORE_PORT ?? 6111;

const db = createDbStoreClient(`http://${dbHost}:${dbPort}`);

const server = Bun.serve({
  port,
  async fetch(request) {
    return handleAuditRequest({ db, runtimeEnv: Bun.env }, request);
  },
});

console.log(
  `[agentos audit] listening on http://127.0.0.1:${server.port} (proxy /api/ext/audit/*) db-store=http://${dbHost}:${dbPort}`,
);
