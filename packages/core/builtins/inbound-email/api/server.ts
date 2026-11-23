import { keys } from './env';
import { createAddressDb, createAddressStore } from './lib/address-store';
import { INBOUND_EMAIL_PORT } from './lib/constants';
import { handleInboundEmailRequest } from './lib/handle-request';
import { parseAddressMap } from './lib/http';
import { createMessageDb } from './lib/message-store';
import {
  createEventsClient,
  createFilesClient,
  createMemoryIdempotencyStore,
} from './lib/peers';
import { createInboundProvider } from './lib/providers/create-provider';

const env = keys();

const port = env.AGENT_OS_EXT_INBOUND_EMAIL_PORT ?? INBOUND_EMAIL_PORT;
const dbHost = env.AGENT_OS_EXT_INBOUND_EMAIL_DB_STORE_HOST ?? '127.0.0.1';
const dbPort = env.AGENT_OS_EXT_INBOUND_EMAIL_DB_STORE_PORT ?? 6111;
const filesHost = env.AGENT_OS_EXT_INBOUND_EMAIL_FILES_HOST ?? '127.0.0.1';
const filesPort = env.AGENT_OS_EXT_INBOUND_EMAIL_FILES_PORT ?? 6116;
const eventsHost = env.AGENT_OS_EXT_INBOUND_EMAIL_EVENTS_HOST ?? '127.0.0.1';
const eventsPort = env.AGENT_OS_EXT_INBOUND_EMAIL_EVENTS_PORT ?? 6115;

const dbBase = `http://${dbHost}:${dbPort}`;
const addresses = createAddressStore(
  createAddressDb(dbBase),
  parseAddressMap(env.AGENT_OS_EXT_INBOUND_EMAIL_ADDRESS_MAP),
);
const messages = createMessageDb(dbBase);
const files = createFilesClient(`http://${filesHost}:${filesPort}`);
const events = createEventsClient(`http://${eventsHost}:${eventsPort}`);
const provider = createInboundProvider({
  provider: env.AGENT_OS_EXT_INBOUND_EMAIL_PROVIDER,
  webhookSecret: env.AGENT_OS_EXT_INBOUND_EMAIL_WEBHOOK_SECRET,
  mailgunSigningKey: env.AGENT_OS_EXT_INBOUND_EMAIL_MAILGUN_SIGNING_KEY,
});

const deps = {
  addresses,
  messages,
  files,
  events,
  provider,
  idempotency: createMemoryIdempotencyStore(),
};

const server = Bun.serve({
  port,
  async fetch(request) {
    return handleInboundEmailRequest(deps, request);
  },
});

console.log(
  `[agentos inbound-email] listening on http://127.0.0.1:${server.port} (proxy /api/ext/inbound-email/*) provider=${provider.name} db-store=${dbBase}`,
);
