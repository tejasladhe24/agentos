/** Fixed builtin API servers for local `agentos dev`. */

export type BuiltinServer = {
  name: string;
  entry: string;
  port: number;
};

export const BUILTIN_SERVERS: readonly BuiltinServer[] = [
  { name: 'auth', entry: './builtins/auth/api/server.ts', port: 6110 },
  { name: 'db-store', entry: './builtins/db-store/api/server.ts', port: 6111 },
  {
    name: 'cache-store',
    entry: './builtins/cache-store/api/server.ts',
    port: 6112,
  },
  { name: 'ai', entry: './builtins/ai/api/server.ts', port: 6113 },
  { name: 'hitl', entry: './builtins/hitl/api/server.ts', port: 6114 },
  { name: 'events', entry: './builtins/events/api/server.ts', port: 6115 },
  { name: 'files', entry: './builtins/files/api/server.ts', port: 6116 },
  {
    name: 'notifications',
    entry: './builtins/notifications/api/server.ts',
    port: 6117,
  },
  { name: 'secrets', entry: './builtins/secrets/api/server.ts', port: 6118 },
  { name: 'audit', entry: './builtins/audit/api/server.ts', port: 6119 },
  {
    name: 'vector-store',
    entry: './builtins/vector-store/api/server.ts',
    port: 6120,
  },
  {
    name: 'inbound-email',
    entry: './builtins/inbound-email/api/server.ts',
    port: 6121,
  },
] as const;

/** Direct builtin bases so child APIs and Python kits skip the Vite hop. */
export function builtinApiEnv(
  gatewayUrl = Bun.env.AGENT_OS_GLOBAL_GATEWAY_URL ?? 'http://127.0.0.1:5173',
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const s of BUILTIN_SERVERS) {
    const key = `AGENT_OS_${s.name.toUpperCase().replace(/-/g, '_')}_API_BASE`;
    env[key] = `http://127.0.0.1:${s.port}`;
  }
  env.AGENT_OS_AUTH_API_BASE = 'http://127.0.0.1:6110';
  env.AGENT_OS_DB_STORE_API_BASE = 'http://127.0.0.1:6111';
  env.AGENT_OS_CACHE_STORE_API_BASE = 'http://127.0.0.1:6112';
  env.AGENT_OS_AI_API_BASE = 'http://127.0.0.1:6113';
  env.AGENT_OS_HITL_API_BASE = 'http://127.0.0.1:6114';
  env.AGENT_OS_GLOBAL_GATEWAY_URL = gatewayUrl;
  return env;
}
