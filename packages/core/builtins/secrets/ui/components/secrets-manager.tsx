import { Separator } from '@agentos/ui/components/separator';
import { LoadingState } from '@agentos/ui/components/loading-state';

import type { SecretListItem, SecretsHealth } from '../lib/types';
import { MasterKeyBanner } from './master-key-banner';
import { SecretCreateDialog } from './secret-create-dialog';
import { SecretDeleteDialog } from './secret-delete-dialog';
import { SecretsTable } from './secrets-table';
import { SecretsToolbar } from './secrets-toolbar';

export type SecretsManagerProps = {
  loading: boolean;
  error: string | null;
  forbidden: boolean;
  health: SecretsHealth | null;
  orgId: string | null;
  canWrite: boolean;
  keys: SecretListItem[];
  filter: string;
  onFilterChange: (value: string) => void;
  onRefresh: () => void;
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  rotateKey: string | null;
  onRotateKeyChange: (key: string | null) => void;
  deleteKey: string | null;
  onDeleteKeyChange: (key: string | null) => void;
  onCreate: (input: {
    key: string;
    value: string;
    expiresAt?: string;
  }) => Promise<void>;
  onRotate: (input: {
    key: string;
    value: string;
    expiresAt?: string;
  }) => Promise<void>;
  onDelete: (key: string) => Promise<void>;
  onReveal: (key: string) => Promise<string>;
};

export function SecretsManager({
  loading,
  error,
  forbidden,
  health,
  orgId,
  canWrite,
  keys,
  filter,
  onFilterChange,
  onRefresh,
  createOpen,
  onCreateOpenChange,
  rotateKey,
  onRotateKeyChange,
  deleteKey,
  onDeleteKeyChange,
  onCreate,
  onRotate,
  onDelete,
  onReveal,
}: SecretsManagerProps) {
  const masterKeyOk = health?.masterKey === true;
  const canMutate = canWrite && masterKeyOk;
  const filtered = keys.filter((item) =>
    item.key.toLowerCase().startsWith(filter.trim().toLowerCase()),
  );

  return (
    <div
      className="flex h-full min-h-full flex-col gap-4 bg-background p-6 text-foreground"
      data-slot="secrets-page"
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Secrets</h1>
        <p className="text-sm text-muted-foreground">
          Per-organization credential vault. Values stay encrypted at rest;
          reveal only when needed.
          {orgId ? (
            <>
              {' '}
              Active org:{' '}
              <span className="font-mono text-foreground">{orgId}</span>
            </>
          ) : null}
        </p>
      </div>
      <Separator />

      {health && !masterKeyOk ? <MasterKeyBanner /> : null}

      {forbidden ? (
        <p
          className="text-sm text-destructive"
          data-slot="secrets-forbidden"
          role="alert"
        >
          {error ?? 'Missing secrets.read permission'}
        </p>
      ) : null}

      {!forbidden && error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {loading && !forbidden ? (
        <LoadingState>Loading secrets…</LoadingState>
      ) : null}

      {!loading && !forbidden ? (
        <>
          <SecretsToolbar
            filter={filter}
            onFilterChange={onFilterChange}
            canCreate={canMutate}
            onCreate={() => onCreateOpenChange(true)}
            onRefresh={onRefresh}
          />
          <SecretsTable
            keys={filtered}
            canWrite={canMutate}
            onReveal={onReveal}
            onRotate={(key) => onRotateKeyChange(key)}
            onDelete={(key) => onDeleteKeyChange(key)}
          />
        </>
      ) : null}

      <SecretCreateDialog
        open={createOpen}
        onOpenChange={onCreateOpenChange}
        mode="create"
        onSubmit={onCreate}
      />
      <SecretCreateDialog
        key={rotateKey ?? 'rotate-closed'}
        open={rotateKey !== null}
        onOpenChange={(open) => {
          if (!open) onRotateKeyChange(null);
        }}
        mode="rotate"
        initialKey={rotateKey ?? ''}
        onSubmit={onRotate}
      />
      <SecretDeleteDialog
        open={deleteKey !== null}
        secretKey={deleteKey}
        onOpenChange={(open) => {
          if (!open) onDeleteKeyChange(null);
        }}
        onConfirm={onDelete}
      />
    </div>
  );
}
