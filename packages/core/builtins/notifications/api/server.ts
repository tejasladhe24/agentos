import { keys } from './env';
import { NOTIFICATIONS_PORT } from './lib/constants';
import { createDbStoreClient } from './lib/db-store-client';
import { handleNotificationsRequest } from './lib/handle-request';
import { createNotifyStore } from './lib/notify-store';

const env = keys();

const port = env.AGENT_OS_EXT_NOTIFICATIONS_PORT ?? NOTIFICATIONS_PORT;
const dbHost = env.AGENT_OS_EXT_NOTIFICATIONS_DB_STORE_HOST ?? '127.0.0.1';
const dbPort = env.AGENT_OS_EXT_NOTIFICATIONS_DB_STORE_PORT ?? 6111;

const db = createDbStoreClient(`http://${dbHost}:${dbPort}`);
const store = createNotifyStore(db);

const server = Bun.serve({
  port,
  async fetch(request) {
    return handleNotificationsRequest(store, request);
  },
});

console.log(
  `[agentos notifications] listening on http://127.0.0.1:${server.port} (proxy /api/ext/notifications/*) db-store=http://${dbHost}:${dbPort}`,
);
