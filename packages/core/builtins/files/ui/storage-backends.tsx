import { useState } from 'react';
import { useHostApi, useHostNotifications } from '@agentos/core/client';
import {
  DotsThreeVerticalIcon,
  PlugsConnectedIcon,
  PlusIcon,
} from '@phosphor-icons/react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@agentos/ui/components/alert-dialog';
import { Badge } from '@agentos/ui/components/badge';
import { Button } from '@agentos/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@agentos/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@agentos/ui/components/dropdown-menu';
import {
  FieldDescription,
  FieldError,
  FieldLegend,
  FieldSet,
} from '@agentos/ui/components/field';
import { Input } from '@agentos/ui/components/input';
import { LoadingState } from '@agentos/ui/components/loading-state';

import {
  formatBytes,
  parseErrorBody,
  type FilesMount,
  type FilesMountsResponse,
} from './files-types';
import { AddStorageDialog } from './add-storage-dialog';
import { MountIcon } from './mount-icon';
import { broadcastMountsChanged } from './use-files-mounts';

type StorageBackendsProps = {
  data: FilesMountsResponse;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

function statusBadge(mount: FilesMount) {
  if (mount.status === 'connected') {
    return <Badge variant="secondary">Connected</Badge>;
  }
  return (
    <Badge variant="destructive" title={mount.statusMessage}>
      {mount.status === 'error' ? 'Error' : 'Disconnected'}
    </Badge>
  );
}

/** Settings › Files › Storage backends — org mounts list and management. */
export function StorageBackends({
  data,
  loading,
  error,
  reload,
}: StorageBackendsProps) {
  const api = useHostApi();
  const notifications = useHostNotifications();
  const [busy, setBusy] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FilesMount | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [removeTarget, setRemoveTarget] = useState<FilesMount | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const orgMounts = data.mounts.filter((m) => m.kind === 'org');
  const addable = data.providers.filter((p) => p.orgAddable);
  const canManage = data.canManage;

  async function mutate(
    path: string,
    init: { method: string; body?: unknown },
    success: string,
  ): Promise<{ ok: boolean; body: string }> {
    setBusy(true);
    const res = await api.fetch(path, {
      method: init.method,
      headers:
        init.body === undefined
          ? undefined
          : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    setBusy(false);
    if (!res.ok) return { ok: false, body: res.body };
    await notifications.show(success, 'info');
    broadcastMountsChanged();
    await reload();
    return { ok: true, body: res.body };
  }

  async function testMount(mount: FilesMount) {
    const res = await mutate(
      `/mounts/${encodeURIComponent(mount.id)}/test`,
      { method: 'POST' },
      `${mount.name}: connection checked`,
    );
    if (!res.ok) {
      await notifications.show(
        parseErrorBody(res.body, `Could not test ${mount.name}`),
        'error',
      );
    }
  }

  async function setDefault(mount: FilesMount) {
    const res = await mutate(
      `/mounts/${encodeURIComponent(mount.id)}`,
      { method: 'PATCH', body: { isDefault: true } },
      `${mount.name} is now the default storage`,
    );
    if (!res.ok) {
      await notifications.show(
        parseErrorBody(res.body, 'Could not set default storage'),
        'error',
      );
    }
  }

  async function submitRename() {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name) return;
    const res = await mutate(
      `/mounts/${encodeURIComponent(renameTarget.id)}`,
      { method: 'PATCH', body: { name } },
      'Storage renamed',
    );
    if (!res.ok) {
      await notifications.show(
        parseErrorBody(res.body, 'Could not rename storage'),
        'error',
      );
      return;
    }
    setRenameTarget(null);
  }

  async function submitRemove() {
    if (!removeTarget) return;
    const res = await mutate(
      `/mounts/${encodeURIComponent(removeTarget.id)}`,
      { method: 'DELETE' },
      `${removeTarget.name} disconnected`,
    );
    if (!res.ok) {
      setRemoveError(
        parseErrorBody(
          res.body,
          'Could not disconnect storage. Move or delete its files first.',
        ),
      );
      return;
    }
    setRemoveTarget(null);
  }

  return (
    <FieldSet data-setting-entry="storage-backends">
      <FieldLegend>Storage backends</FieldLegend>
      <FieldDescription>
        Org-wide storage mounted into Files. New uploads and agent outputs go to
        the default backend.
      </FieldDescription>
      {loading ? (
        <LoadingState size="sm">Loading…</LoadingState>
      ) : error ? (
        <FieldError>{error}</FieldError>
      ) : (
        <ul
          className="flex flex-col divide-y divide-border rounded-md border border-border"
          data-slot="files-storage-backends"
        >
          {orgMounts.map((mount) => (
            <li
              key={mount.id}
              className="flex items-center gap-3 px-3 py-2 text-sm"
              data-mount-id={mount.id}
            >
              <MountIcon
                provider={mount.provider}
                className="size-5 shrink-0 text-muted-foreground"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 font-medium">
                  <span className="truncate">{mount.name}</span>
                  {mount.isDefault ? (
                    <Badge variant="outline">Default</Badge>
                  ) : null}
                  {statusBadge(mount)}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {mount.provider}
                  {mount.usage
                    ? ` · ${mount.usage.files} file(s) · ${formatBytes(mount.usage.bytes)}`
                    : ''}
                  {mount.statusMessage ? ` · ${mount.statusMessage}` : ''}
                </span>
              </div>
              {canManage ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Actions for ${mount.name}`}
                        disabled={busy}
                      />
                    }
                  >
                    <DotsThreeVerticalIcon className="size-4" aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => void testMount(mount)}>
                      Test connection
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={mount.isDefault}
                      onClick={() => void setDefault(mount)}
                    >
                      Set as default
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        setRenameValue(mount.name);
                        setRenameTarget(mount);
                      }}
                    >
                      Rename
                    </DropdownMenuItem>
                    {mount.builtin ? null : (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => {
                            setRemoveError(null);
                            setRemoveTarget(mount);
                          }}
                        >
                          Disconnect
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAddOpen(true)}
          >
            <PlusIcon className="size-4" aria-hidden />
            Add storage
          </Button>
        </div>
      ) : null}

      <AddStorageDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        providers={addable}
        onAdded={async () => {
          broadcastMountsChanged();
          await reload();
        }}
      />

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename storage</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            aria-label="Storage name"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitRename();
            }}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRenameTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy || !renameValue.trim()}
              onClick={() => void submitRename()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disconnect {removeTarget?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Storage can only be disconnected once no files or records still
              reference it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeError ? <FieldError>{removeError}</FieldError> : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void submitRemove();
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FieldSet>
  );
}

/** Settings › Files › My connected drives — personal mounts (ticket 113). */
export function ConnectedDrives({ mounts }: { mounts: FilesMount[] }) {
  const personal = mounts.filter((m) => m.kind === 'personal');
  return (
    <FieldSet data-setting-entry="connected-drives">
      <FieldLegend>My connected drives</FieldLegend>
      <FieldDescription>
        Personal drives are visible only to you and never to other members or
        background agents.
      </FieldDescription>
      {personal.length ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {personal.map((mount) => (
            <li
              key={mount.id}
              className="flex items-center gap-3 px-3 py-2 text-sm"
            >
              <MountIcon provider={mount.provider} className="size-5" />
              <span className="flex-1 truncate">{mount.name}</span>
              {statusBadge(mount)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <PlugsConnectedIcon className="size-4" aria-hidden />
          Connecting personal drives is coming soon.
        </p>
      )}
    </FieldSet>
  );
}
