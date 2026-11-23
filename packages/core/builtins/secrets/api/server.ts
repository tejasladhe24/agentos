import { keys } from './env';
import { SECRETS_PORT } from './lib/constants';
import { createSecretsDbStoreClient } from './lib/db-store-client';
import { handleSecretsRequest } from './lib/handle-request';

const env = keys();

const port = env.AGENT_OS_EXT_SECRETS_PORT ?? SECRETS_PORT;
const dbHost = env.AGENT_OS_EXT_SECRETS_DB_STORE_HOST ?? '127.0.0.1';
const dbPort = env.AGENT_OS_EXT_SECRETS_DB_STORE_PORT ?? 6111;
const db = createSecretsDbStoreClient(`http://${dbHost}:${dbPort}`);

const server = Bun.serve({
  port,
  async fetch(request) {
    return handleSecretsRequest({ runtimeEnv: Bun.env, db }, request);
  },
});

console.log(
  `[agentos secrets] listening on http://127.0.0.1:${server.port} (proxy /api/ext/secrets/*)`,
);
