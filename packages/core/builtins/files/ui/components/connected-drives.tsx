import { useEffect, useState } from 'react';
import {} from '@tanstack/react-form';
import {} from 'zod';
import {
  useHostApi,
  useHostNavigation,
  useHostNotifications,
} from '@agentos/core/client';
import {} from '@agentos/core/client/components/integration-card';
import {
  DotsThreeVerticalIcon,
  PlugsConnectedIcon,
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
import {} from '@agentos/ui/components/badge';
import { Button } from '@agentos/ui/components/button';
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
  FieldGroup,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '@agentos/ui/components/field';
import {} from '@agentos/ui/components/input';
import { LoadingState } from '@agentos/ui/components/loading-state';

import {
  parseErrorBody,
  type FilesMount,
  type FilesMountsResponse,
} from '../lib/files-types';
import {} from './add-storage-dialog';
import { MountIcon } from './mount-icon';
import {
  readDriveConnectResult,
  startDriveConnect,
} from '../lib/personal-drives';
import { useNotifyMountsChanged } from '../lib/use-files-mounts';
import { connectedBadge, mountStatusInfo, quotaLine } from './mount-status';

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
  const notifyMountsChanged = useNotifyMountsChanged();
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
    notifyMountsChanged();
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
    notifyMountsChanged();
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
