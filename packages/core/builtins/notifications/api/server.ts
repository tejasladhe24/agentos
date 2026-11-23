import { keys } from './env';
import { NOTIFICATIONS_PORT } from './lib/constants';
import { createDbStoreClient } from './lib/db-store-client';
import { handleNotificationsRequest } from './lib/handle-request';
import { createNotifyStore } from './lib/notify-store';
import { createProviders } from './lib/providers/create-providers';

const env = keys();

const port = env.AGENT_OS_EXT_NOTIFICATIONS_PORT ?? NOTIFICATIONS_PORT;
const dbHost = env.AGENT_OS_EXT_NOTIFICATIONS_DB_STORE_HOST ?? '127.0.0.1';
const dbPort = env.AGENT_OS_EXT_NOTIFICATIONS_DB_STORE_PORT ?? 6111;

const db = createDbStoreClient(`http://${dbHost}:${dbPort}`);
const store = createNotifyStore(db);
const providers = createProviders({
  emailProvider: env.AGENT_OS_EXT_NOTIFICATIONS_EMAIL_PROVIDER,
  emailApiKey: env.AGENT_OS_EXT_NOTIFICATIONS_EMAIL_API_KEY,
  emailFrom: env.AGENT_OS_EXT_NOTIFICATIONS_EMAIL_FROM,
  emailAccountId: env.AGENT_OS_EXT_NOTIFICATIONS_EMAIL_ACCOUNT_ID,
  smsProvider: env.AGENT_OS_EXT_NOTIFICATIONS_SMS_PROVIDER,
  smsAccountSid: env.AGENT_OS_EXT_NOTIFICATIONS_SMS_ACCOUNT_SID,
  smsAuthToken: env.AGENT_OS_EXT_NOTIFICATIONS_SMS_AUTH_TOKEN,
  smsFrom: env.AGENT_OS_EXT_NOTIFICATIONS_SMS_FROM,
});

const server = Bun.serve({
  port,
  async fetch(request) {
    return handleNotificationsRequest(store, request, providers);
  },
});

console.log(
  `[agentos notifications] listening on http://127.0.0.1:${server.port} (proxy /api/ext/notifications/*) db-store=http://${dbHost}:${dbPort} email=${providers.email.name} sms=${providers.sms.name}`,
);
