import { DEFAULT_DEV_AUTH_SECRET } from './constants';

type EnvLike = Record<string, string | undefined>;

/** True when AgentOS or host marks the process as production. */
export function isAuthProduction(env: EnvLike = Bun.env): boolean {
  return (
    env.AGENT_OS_GLOBAL_NODE_ENV === 'production' ||
    env.NODE_ENV === 'production'
  );
}

/** True when any resolved origin/base URL uses the https scheme. */
export function usesHttpsOrigin(
  ...urls: Array<string | undefined | null>
): boolean {
  return urls.some(
    (url) => typeof url === 'string' && url.startsWith('https:'),
  );
}

/**
 * Production must set a real secret (not the well-known local default).
 * Throws when running in production with a missing or default secret.
 */
export function assertProductionAuthSecret(
  secret: string | undefined,
  env: EnvLike = Bun.env,
): void {
  if (!isAuthProduction(env)) return;
  if (!secret || secret === DEFAULT_DEV_AUTH_SECRET) {
    throw new Error(
      'AGENT_OS_EXT_AUTH_SECRET is required in production and must not be the default development secret',
    );
  }
}

/** Deduped trusted origins; localhost Vite origins only outside production. */
export function buildTrustedOrigins(
  baseURL: string,
  appOrigin: string,
  production: boolean,
): string[] {
  const origins = [baseURL, appOrigin];
  if (!production) {
    origins.push('http://localhost:5173', 'http://127.0.0.1:5173');
  }
  return [...new Set(origins)];
}
