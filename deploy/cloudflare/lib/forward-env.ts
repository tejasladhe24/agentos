/**
 * Env keys from the portable deploy checklist ([deploy/README.md](../../README.md))
 * that this adapter forwards into the container on start.
 *
 * Secrets should be set with `wrangler secret put <NAME>` (or `.dev.vars` locally).
 * Non-secrets may live in `wrangler.jsonc` `vars`.
 */
export const CONTAINER_ENV_KEYS = [
  'PORT',
  'NODE_ENV',
  'AGENT_OS_GLOBAL_NODE_ENV',
  'AGENT_OS_GLOBAL_APP_ORIGIN',
  'AGENT_OS_EXT_AUTH_BASE_URL',
  'AGENT_OS_EXT_AUTH_SECRET',
  'AGENT_OS_EXT_AUTH_DB',
  'AGENT_OS_EXT_AUTH_SEED_DEMO',
  'AGENT_OS_EXT_DB_STORE_DATABASE_URL',
  'AGENT_OS_EXT_FILES_S3_BUCKET',
  'AGENT_OS_EXT_FILES_S3_ENDPOINT',
  'AGENT_OS_EXT_FILES_S3_REGION',
  'AGENT_OS_EXT_FILES_S3_ACCESS_KEY_ID',
  'AGENT_OS_EXT_FILES_S3_SECRET_ACCESS_KEY',
  'AGENT_OS_EXT_FILES_S3_SESSION_TOKEN',
  'AGENT_OS_EXT_FILES_GOOGLE_CLIENT_ID',
  'AGENT_OS_EXT_FILES_GOOGLE_CLIENT_SECRET',
  'AGENT_OS_EXT_FILES_MICROSOFT_CLIENT_ID',
  'AGENT_OS_EXT_FILES_MICROSOFT_CLIENT_SECRET',
  'AGENT_OS_EXT_FILES_MICROSOFT_TENANT',
  'AGENT_OS_EXT_AI_PROVIDER',
  'AGENT_OS_EXT_AI_API_KEY',
  'AGENT_OS_EXT_AI_MODEL',
  'AGENT_OS_EXT_AI_EMBEDDING_MODEL',
  'AGENT_OS_EXT_AI_IMAGE_MODEL',
  'AGENT_OS_EXT_AI_BASE_URL',
  'AGENT_OS_EXT_AI_ZERO_DATA_RETENTION',
  'AGENT_OS_EXT_AI_GATEWAY_URL',
  'AGENT_OS_EXT_INBOUND_EMAIL_PROVIDER',
  'AGENT_OS_EXT_INBOUND_EMAIL_CLOUDFLARE_SECRET',
  'AGENT_OS_EXT_INBOUND_EMAIL_DOMAIN',
  'AGENT_OS_EXT_INBOUND_EMAIL_RESEND_API_KEY',
  'AGENT_OS_EXT_INBOUND_EMAIL_RESEND_SIGNING_SECRET',
] as const;

export type ContainerEnvKey = (typeof CONTAINER_ENV_KEYS)[number];

/** Collect defined Worker env/secrets into a plain string map for `container.start({ env })`. */
export function collectContainerEnv(
  env: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {
    // Image listens on 8080; gateway sets AGENT_OS_GLOBAL_GATEWAY_URL itself.
    PORT: '8080',
    NODE_ENV: 'production',
    AGENT_OS_GLOBAL_NODE_ENV: 'production',
  };

  for (const key of CONTAINER_ENV_KEYS) {
    const value = env[key];
    if (typeof value === 'string' && value.length > 0) {
      out[key] = value;
    }
  }

  return out;
}
