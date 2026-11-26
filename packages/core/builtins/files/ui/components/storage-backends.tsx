import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import {
  isFieldInvalid,
  toFieldErrors,
  useHostApi,
  useHostNotifications,
} from '@agentos/core/client';
import {} from '@agentos/core/client/components/integration-card';
import { DotsThreeVerticalIcon, PlusIcon } from '@phosphor-icons/react';
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
} from '../lib/files-types';
import { AddStorageDialog } from './add-storage-dialog';
import { MountIcon } from './mount-icon';
import { useNotifyMountsChanged } from '../lib/use-files-mounts';

import { connectedBadge, mountStatusInfo } from './mount-status';

type StorageBackendsProps = {
  data: FilesMountsResponse;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

const renameStorageSchema = z.object({
  name: z.string().trim().min(1, 'Storage name is required'),
});

/** Settings › Files › Storage backends — org mounts list and management. */
export function StorageBackends({
  data,
  loading,
  error,
  reload,
}: StorageBackendsProps) {
  const api = useHostApi();
  const notifications = useHostNotifications();
  const notifyMountsChanged = useNotifyMountsChanged();
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
    notifyMountsChanged();
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
          notifyMountsChanged();
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
