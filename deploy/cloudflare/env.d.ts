/** Worker bindings + vars/secrets forwarded into the AgentOS container. */
interface Env {
  AGENT_OS_CONTAINER: DurableObjectNamespace;

  /** Public HTTPS origin of the Shell (trustedOrigins, cookies, reset links). */
  AGENT_OS_GLOBAL_APP_ORIGIN?: string;
  /** Better Auth baseURL as seen by the browser / gateway. */
  AGENT_OS_EXT_AUTH_BASE_URL?: string;
  /** Auth secret (≥32 chars). Prefer `wrangler secret put`. */
  AGENT_OS_EXT_AUTH_SECRET?: string;
  /** Postgres URL for auth (Neon / RDS / Cloud SQL). Prefer secret. */
  AGENT_OS_EXT_AUTH_DB?: string;
  AGENT_OS_EXT_AUTH_SEED_DEMO?: string;
  AGENT_OS_GLOBAL_NODE_ENV?: string;
  NODE_ENV?: string;
  PORT?: string;

  /** db-store Postgres URL. Prefer secret. */
  AGENT_OS_EXT_DB_STORE_DATABASE_URL?: string;

  AGENT_OS_EXT_FILES_S3_BUCKET?: string;
  AGENT_OS_EXT_FILES_S3_ENDPOINT?: string;
  AGENT_OS_EXT_FILES_S3_REGION?: string;
  AGENT_OS_EXT_FILES_S3_ACCESS_KEY_ID?: string;
  AGENT_OS_EXT_FILES_S3_SECRET_ACCESS_KEY?: string;
  AGENT_OS_EXT_FILES_S3_SESSION_TOKEN?: string;
  AGENT_OS_EXT_FILES_GOOGLE_CLIENT_ID?: string;
  AGENT_OS_EXT_FILES_GOOGLE_CLIENT_SECRET?: string;

  AGENT_OS_EXT_AI_PROVIDER?: string;
  AGENT_OS_EXT_AI_API_KEY?: string;
  AGENT_OS_EXT_AI_MODEL?: string;
  AGENT_OS_EXT_AI_EMBEDDING_MODEL?: string;
  AGENT_OS_EXT_AI_IMAGE_MODEL?: string;
  AGENT_OS_EXT_AI_BASE_URL?: string;
  AGENT_OS_EXT_AI_ZERO_DATA_RETENTION?: string;
  AGENT_OS_EXT_AI_GATEWAY_URL?: string;

  /** `fixture` | `resend` | `cloudflare` (Email Routing via this Worker's `email()`). */
  AGENT_OS_EXT_INBOUND_EMAIL_PROVIDER?: string;
  /** HMAC secret shared by `email()` and the inbound-email builtin. Prefer secret. */
  AGENT_OS_EXT_INBOUND_EMAIL_CLOUDFLARE_SECRET?: string;
  /** Platform inbound domain, e.g. `in.example.com` (orgs get `<slug>@` there). */
  AGENT_OS_EXT_INBOUND_EMAIL_DOMAIN?: string;
  AGENT_OS_EXT_INBOUND_EMAIL_RESEND_API_KEY?: string;
  AGENT_OS_EXT_INBOUND_EMAIL_RESEND_SIGNING_SECRET?: string;
}
