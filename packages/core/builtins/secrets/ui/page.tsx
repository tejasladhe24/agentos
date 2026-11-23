import { useEffect, useState } from 'react';
import { useHostApi, useHostNotifications } from '@agentos/core/client';

import { SecretsManager } from './components/secrets-manager';
import {
  deleteVaultSecret,
  fetchHealth,
  fetchSecretList,
  putVaultSecret,
  revealVaultSecret,
} from './lib/api';
import type { SecretListItem, SecretsHealth } from './lib/types';

/**
 * Secrets secondary Activity Bar page — org vault manager (ticket 98).
 */
export default function SecretsPage() {
  const api = useHostApi();
  const notifications = useHostNotifications();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [health, setHealth] = useState<SecretsHealth | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [keys, setKeys] = useState<SecretListItem[]>([]);
  const [filter, setFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [rotateKey, setRotateKey] = useState<string | null>(null);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const nextHealth = await fetchHealth((path, init) =>
        api.fetch(path, init),
      );
      setHealth(nextHealth);

      const listed = await fetchSecretList((path, init) =>
        api.fetch(path, init),
      );
      if (!listed.ok) {
        setKeys([]);
        setOrgId(null);
        setCanWrite(false);
        if (listed.status === 403 || listed.status === 401) {
          setForbidden(true);
          setError(
            listed.status === 401
              ? 'Sign in required to manage secrets'
              : listed.message,
          );
        } else {
          setError(listed.message);
        }
        return;
      }
      setOrgId(listed.data.orgId);
      setCanWrite(listed.data.canWrite);
      setKeys(listed.data.keys);
    } catch (err) {
      setKeys([]);
      setError(err instanceof Error ? err.message : 'Failed to load secrets');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === 'visible') void load();
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  async function onCreate(input: {
    key: string;
    value: string;
    expiresAt?: string;
  }) {
    await putVaultSecret((path, init) => api.fetch(path, init), input.key, {
      value: input.value,
      expiresAt: input.expiresAt,
    });
    await notifications.show(`Secret “${input.key}” created`, 'info');
    await load();
  }

  async function onRotate(input: {
    key: string;
    value: string;
    expiresAt?: string;
  }) {
    await putVaultSecret((path, init) => api.fetch(path, init), input.key, {
      value: input.value,
      expiresAt: input.expiresAt,
    });
    await notifications.show(`Secret “${input.key}” rotated`, 'info');
    setRotateKey(null);
    await load();
  }

  async function onDelete(key: string) {
    await deleteVaultSecret((path, init) => api.fetch(path, init), key);
    await notifications.show(`Secret “${key}” deleted`, 'info');
    setDeleteKey(null);
    await load();
  }

  async function onReveal(key: string): Promise<string> {
    return revealVaultSecret((path, init) => api.fetch(path, init), key);
  }

  return (
    <SecretsManager
      loading={loading}
      error={error}
      forbidden={forbidden}
      health={health}
      orgId={orgId}
      canWrite={canWrite}
      keys={keys}
      filter={filter}
      onFilterChange={setFilter}
      onRefresh={() => void load()}
      createOpen={createOpen}
      onCreateOpenChange={setCreateOpen}
      rotateKey={rotateKey}
      onRotateKeyChange={setRotateKey}
      deleteKey={deleteKey}
      onDeleteKeyChange={setDeleteKey}
      onCreate={onCreate}
      onRotate={onRotate}
      onDelete={onDelete}
      onReveal={onReveal}
    />
  );
}
