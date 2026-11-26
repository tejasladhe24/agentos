import { publish } from '@agentos/core/api/events';

import { keys } from './env';
import { createApprovalsStore } from './lib/approvals-store';
import { HITL_PORT } from './lib/constants';
import { createDbStoreClient } from './lib/db-store-client';
import { handleHitlRequest } from './lib/handle-request';
import { resolveSessionOrgId } from './lib/resolve-org';

const env = keys();

const port = env.AGENT_OS_EXT_HITL_PORT ?? HITL_PORT;
const dbHost = env.AGENT_OS_EXT_HITL_DB_STORE_HOST ?? '127.0.0.1';
const dbPort = env.AGENT_OS_EXT_HITL_DB_STORE_PORT ?? 6111;

const db = createDbStoreClient(`http://${dbHost}:${dbPort}`);
const store = createApprovalsStore(db);

const server = Bun.serve({
  port,
  async fetch(request) {
    return handleHitlRequest(store, request, {
      resolveOrgId: (req) => resolveSessionOrgId(req),
      publishResolved: async (payload, orgId) => {
        await publish('hitl.resolved', payload, undefined, { orgId });
      },
      publishRequested: async (payload, orgId) => {
        await publish('hitl.requested', payload, undefined, { orgId });
      },
    });
  },
});

console.log(
  `[agentos hitl] listening on http://127.0.0.1:${server.port} (proxy /api/ext/hitl/*) db-store=http://${dbHost}:${dbPort}`,
);
