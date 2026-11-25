import { useEffect, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import {
  isFieldInvalid,
  toFieldErrors,
  useHostApi,
  useHostNavigation,
  useHostNotifications,
} from '@agentos/core/client';
import { IntegrationStatusInfo } from '@agentos/core/client/components/integration-card';
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
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
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
import { readDriveConnectResult, startDriveConnect } from './personal-drives';
import { broadcastMountsChanged } from './use-files-mounts';

type StorageBackendsProps = {
  data: FilesMountsResponse;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

function mountStatusMessage(mount: FilesMount): string {
  const label = mount.status === 'error' ? 'Error' : 'Disconnected';
  return mount.statusMessage ? `${label}: ${mount.statusMessage}` : label;
}

function mountStatusInfo(mount: FilesMount) {
  if (mount.status === 'connected') return null;
  return (
    <IntegrationStatusInfo
      message={mountStatusMessage(mount)}
      tone={mount.status === 'error' ? 'error' : 'warning'}
      slot="files-mount-status"
    />
  );
}

const renameStorageSchema = z.object({
  name: z.string().trim().min(1, 'Storage name is required'),
});

function connectedBadge(mount: FilesMount) {
  if (mount.status !== 'connected') return null;
  return <Badge variant="secondary">Connected</Badge>;
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
  const [renameError, setRenameError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<FilesMount | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const renameForm = useForm({
    defaultValues: { name: '' },
    validators: { onSubmit: renameStorageSchema },
    onSubmit: async ({ value }) => {
      if (!renameTarget) return;
      setRenameError(null);
      const res = await mutate(
        `/mounts/${encodeURIComponent(renameTarget.id)}`,
        { method: 'PATCH', body: { name: value.name.trim() } },
        'Storage renamed',
      );
      if (!res.ok) {
        setRenameError(parseErrorBody(res.body, 'Could not rename storage'));
        return;
      }
      setRenameTarget(null);
    },
  });

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
        <FieldGroup data-slot="files-storage-backends">
          {orgMounts.map((mount) => (
            <Field
              key={mount.id}
              orientation="horizontal"
              data-mount-id={mount.id}
            >
              <FieldContent>
                <FieldTitle className="relative">
                  {mountStatusInfo(mount)}
                  <MountIcon
                    provider={mount.provider}
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="truncate">{mount.name}</span>
                  {mount.isDefault ? (
                    <Badge variant="outline">Default</Badge>
                  ) : null}
                  {connectedBadge(mount)}
                </FieldTitle>
                <FieldDescription>
                  {mount.provider}
                  {mount.usage
                    ? ` · ${mount.usage.files} file(s) · ${formatBytes(mount.usage.bytes)}`
                    : ''}
                  {mount.statusMessage ? ` · ${mount.statusMessage}` : ''}
                </FieldDescription>
              </FieldContent>
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
                        setRenameError(null);
                        renameForm.reset({ name: mount.name });
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
            </Field>
          ))}
          {canManage ? (
            <Field orientation="horizontal" className="justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAddOpen(true)}
              >
                <PlusIcon className="size-4" aria-hidden />
                Add storage
              </Button>
            </Field>
          ) : null}
        </FieldGroup>
      )}

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
          if (!open) {
            setRenameTarget(null);
            setRenameError(null);
          }
        }}
      >
        <DialogContent>
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void renameForm.handleSubmit();
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename storage</DialogTitle>
            </DialogHeader>
            <renameForm.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => {
                const formDisabled = busy || isSubmitting;
                return (
                  <>
                    <renameForm.Field name="name">
                      {(field) => {
                        const invalid = isFieldInvalid(field.state.meta);
                        return (
                          <Field data-invalid={invalid || undefined}>
                            <FieldLabel htmlFor="storage-rename-input">
                              Storage name
                            </FieldLabel>
                            <Input
                              id="storage-rename-input"
                              name={field.name}
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) => {
                                field.handleChange(e.target.value);
                                if (renameError) setRenameError(null);
                              }}
                              aria-label="Storage name"
                              aria-invalid={invalid || undefined}
                              disabled={formDisabled}
                              autoFocus
                            />
                            {invalid ? (
                              <FieldError
                                errors={toFieldErrors(field.state.meta.errors)}
                              />
                            ) : null}
                          </Field>
                        );
                      }}
                    </renameForm.Field>
                    {renameError ? (
                      <FieldError>{renameError}</FieldError>
                    ) : null}
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={formDisabled}
                        onClick={() => setRenameTarget(null)}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" disabled={formDisabled}>
                        {isSubmitting ? 'Saving…' : 'Save'}
                      </Button>
                    </DialogFooter>
                  </>
                );
              }}
            </renameForm.Subscribe>
          </form>
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

function quotaLine(mount: FilesMount): string {
  if (!mount.quota) return '';
  const used = formatBytes(mount.quota.usedBytes);
  return mount.quota.limitBytes
    ? ` · ${used} of ${formatBytes(mount.quota.limitBytes)} used`
    : ` · ${used} used`;
}

type ConnectedDrivesProps = {
  data: FilesMountsResponse;
  loading: boolean;
  reload: () => Promise<void>;
};

/** Settings › Files › My connected drives — personal mounts (ticket 113). */
export function ConnectedDrives({
  data,
  loading,
  reload,
}: ConnectedDrivesProps) {
  const api = useHostApi();
  const navigation = useHostNavigation();
  const notifications = useHostNotifications();
  const [busy, setBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<FilesMount | null>(null);
  const personal = data.mounts.filter((m) => m.kind === 'personal');
  const providers = data.providers.filter((p) => p.personal);

  useEffect(() => {
    const result = readDriveConnectResult();
    if (!result) return;
    void notifications.show(
      result.status === 'connected'
        ? 'Drive connected'
        : (result.message ?? 'Could not connect the drive'),
      result.status === 'connected' ? 'success' : 'error',
    );
  }, [notifications]);

  async function connect(providerId: string, mountId?: string) {
    setBusy(true);
    const error = await startDriveConnect(api, navigation, providerId, mountId);
    setBusy(false);
    if (error) await notifications.show(error, 'error');
  }

  async function testMount(mount: FilesMount) {
    setBusy(true);
    const res = await api.fetch(
      `/mounts/${encodeURIComponent(mount.id)}/test`,
      { method: 'POST' },
    );
    setBusy(false);
    let ok = res.ok;
    try {
      ok = ok && (JSON.parse(res.body) as { ok?: boolean }).ok === true;
    } catch {
      ok = false;
    }
    await notifications.show(
      ok
        ? `${mount.name}: connected`
        : parseErrorBody(res.body, `${mount.name}: connection failed`),
      ok ? 'info' : 'error',
    );
    broadcastMountsChanged();
    await reload();
  }

  async function submitRemove() {
    if (!removeTarget) return;
    setBusy(true);
    const res = await api.fetch(
      `/mounts/${encodeURIComponent(removeTarget.id)}`,
      { method: 'DELETE' },
    );
    setBusy(false);
    if (!res.ok) {
      await notifications.show(
        parseErrorBody(res.body, 'Could not disconnect the drive'),
        'error',
      );
      return;
    }
    await notifications.show(`${removeTarget.name} disconnected`, 'info');
    setRemoveTarget(null);
    broadcastMountsChanged();
    await reload();
  }

  return (
    <FieldSet data-setting-entry="connected-drives">
      <FieldLegend>My connected drives</FieldLegend>
      <FieldDescription>
        Personal drives are visible only to you — never to admins, other
        members, or background jobs. Copy files into org storage to share them.
      </FieldDescription>
      {loading ? (
        <LoadingState size="sm">Loading…</LoadingState>
      ) : (
        <FieldGroup data-slot="files-connected-drives">
          {personal.length ? (
            personal.map((mount) => {
              const connected = mount.status === 'connected';
              const email =
                typeof mount.config?.email === 'string'
                  ? mount.config.email
                  : '';
              return (
                <Field
                  key={mount.id}
                  orientation="horizontal"
                  data-mount-id={mount.id}
                >
                  <FieldContent>
                    <FieldTitle className="relative">
                      {mountStatusInfo(mount)}
                      <MountIcon
                        provider={mount.provider}
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="truncate">{mount.name}</span>
                      {connectedBadge(mount)}
                    </FieldTitle>
                    <FieldDescription>
                      {email || mount.provider}
                      {quotaLine(mount)}
                      {!connected && mount.statusMessage
                        ? ` · ${mount.statusMessage}`
                        : ''}
                    </FieldDescription>
                  </FieldContent>
                  <div className="flex items-center gap-2">
                    {connected ? null : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void connect(mount.provider, mount.id)}
                      >
                        Reconnect
                      </Button>
                    )}
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
                          onClick={() => void connect(mount.provider, mount.id)}
                        >
                          Reconnect
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setRemoveTarget(mount)}
                        >
                          Disconnect
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </Field>
              );
            })
          ) : (
            <FieldDescription className="flex items-center gap-2">
              <PlugsConnectedIcon className="size-4" aria-hidden />
              No personal drives connected yet.
            </FieldDescription>
          )}
          {providers.length ? (
            <Field
              orientation="horizontal"
              className="flex-wrap justify-end gap-2"
            >
              {providers.map((provider) => (
                <Button
                  key={provider.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || !provider.connectable}
                  title={
                    provider.connectable
                      ? undefined
                      : `${provider.label} is not configured on this deployment`
                  }
                  onClick={() => void connect(provider.id)}
                  data-connect-provider={provider.id}
                >
                  <MountIcon provider={provider.id} className="size-4" />
                  Connect {provider.label}
                </Button>
              ))}
            </Field>
          ) : null}
        </FieldGroup>
      )}

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
              AgentOS forgets the connection and revokes its access. Files stay
              in your drive; copies already saved to org storage are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
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
