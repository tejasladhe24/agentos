import type { OAuthStoredTokens } from '@agentos/core/api/oauth';
import { deleteSecret, getSecret, putSecret } from '@agentos/core/api/secrets';

/**
 * OAuth tokens of personal mounts, stored as user-owned secrets (ticket 104):
 * only the owner — or a peer acting for them — can read them.
 */
export type PersonalTokenStore = {
  get: (
    orgId: string,
    userId: string,
    mountId: string,
  ) => Promise<OAuthStoredTokens | undefined>;
  put: (
    orgId: string,
    userId: string,
    mountId: string,
    tokens: OAuthStoredTokens,
  ) => Promise<void>;
  delete: (orgId: string, userId: string, mountId: string) => Promise<void>;
};

export function personalTokenKey(mountId: string): string {
  return `files/mounts/${mountId}/oauth`;
}

function parseTokens(value: string): OAuthStoredTokens | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<OAuthStoredTokens>;
    return typeof parsed.accessToken === 'string'
      ? (parsed as OAuthStoredTokens)
      : undefined;
  } catch {
    return undefined;
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && /\(404\)/.test(error.message);
}

export function createVaultPersonalTokenStore(
  env: Record<string, string | undefined> = Bun.env,
): PersonalTokenStore {
  return {
    async get(orgId, userId, mountId) {
      try {
        const secret = await getSecret(personalTokenKey(mountId), env, {
          orgId,
          ownerUserId: userId,
        });
        return parseTokens(secret.value);
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw error;
      }
    },
    async put(orgId, userId, mountId, tokens) {
      await putSecret(
        personalTokenKey(mountId),
        { value: JSON.stringify(tokens), expiresAt: tokens.expiresAt },
        env,
        { orgId, ownerUserId: userId },
      );
    },
    async delete(orgId, userId, mountId) {
      try {
        await deleteSecret(personalTokenKey(mountId), env, {
          orgId,
          ownerUserId: userId,
        });
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    },
  };
}

export function createMemoryPersonalTokenStore(): PersonalTokenStore & {
  entries: Map<string, OAuthStoredTokens>;
} {
  const entries = new Map<string, OAuthStoredTokens>();
  const id = (orgId: string, userId: string, mountId: string) =>
    `${orgId}:${userId}:${mountId}`;
  return {
    entries,
    async get(orgId, userId, mountId) {
      const tokens = entries.get(id(orgId, userId, mountId));
      return tokens ? { ...tokens } : undefined;
    },
    async put(orgId, userId, mountId, tokens) {
      entries.set(id(orgId, userId, mountId), { ...tokens });
    },
    async delete(orgId, userId, mountId) {
      entries.delete(id(orgId, userId, mountId));
    },
  };
}
