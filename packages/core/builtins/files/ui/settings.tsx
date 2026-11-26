import { SettingsPage } from '@agentos/core/client/components/settings-page';
import { useEffect, useState } from 'react';
import {
  useHostApi,
  useHostNotifications,
  useSettingsTarget,
} from '@agentos/core/client';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from '@agentos/ui/components/field';
import { LoadingState } from '@agentos/ui/components/loading-state';
import { RadioGroup, RadioGroupItem } from '@agentos/ui/components/radio-group';

import { ConnectedDrives, StorageBackends } from './storage-backends';
import { useFilesMounts } from './use-files-mounts';

type RetentionValue = '15' | '30' | 'never';

const RETENTION_OPTIONS: ReadonlyArray<{
  value: RetentionValue;
  id: string;
  title: string;
  description: string;
}> = [
  {
    value: '15',
    id: 'files-retention-15',
    title: '15 days',
    description: 'Permanently delete items 15 days after moving to Bin.',
  },
  {
    value: '30',
    id: 'files-retention-30',
    title: '30 days',
    description: 'Permanently delete items 30 days after moving to Bin.',
  },
  {
    value: 'never',
    id: 'files-retention-never',
    title: "Don't delete",
    description: 'Keep deleted items in Bin until manually emptied.',
  },
];

function toValue(days: number | null | undefined): RetentionValue {
  if (days === 15) return '15';
  if (days === null) return 'never';
  return '30';
}

function fromValue(value: RetentionValue): number | null {
  if (value === '15') return 15;
  if (value === 'never') return null;
  return 30;
}

/**
 * Files extension settings view — mounted by the Shell Settings host.
 */
export default function FilesSettings() {
  useSettingsTarget();
  const api = useHostApi();
  const notifications = useHostNotifications();
  const [value, setValue] = useState<RetentionValue>('30');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounts = useFilesMounts({ usage: true, reportErrors: true });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      let res: Awaited<ReturnType<typeof api.fetch>>;
      try {
        res = await api.fetch('/org-settings');
      } catch {
        if (cancelled) return;
        const message =
          'Could not reach Files settings. Reload the page to retry.';
        setError(message);
        void notifications.show(message, 'error');
        setLoading(false);
        return;
      }
      if (cancelled) return;
      if (!res.ok) {
        const message = 'Could not load Files settings.';
        setError(message);
        void notifications.show(message, 'error');
        setLoading(false);
        return;
      }
      try {
        const data = JSON.parse(res.body) as {
          binRetentionDays?: number | null;
        };
        setValue(toValue(data.binRetentionDays));
      } catch {
        const message = 'Invalid Files settings response.';
        setError(message);
        void notifications.show(message, 'error');
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, notifications]);

  async function onChange(next: RetentionValue) {
    setValue(next);
    setSaving(true);
    const res = await api
      .fetch('/org-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ binRetentionDays: fromValue(next) }),
      })
      .catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      await notifications.show('Failed to save Files settings', 'error');
      return;
    }
    await notifications.show('Files settings saved', 'info');
  }

  return (
    <SettingsPage data-slot="settings-files">
      <FieldGroup className="gap-8">
        {mounts.loading || mounts.data.canManage ? (
          <>
            <StorageBackends
              data={mounts.data}
              loading={mounts.loading}
              error={mounts.error}
              reload={mounts.reload}
            />
            <FieldSeparator />
          </>
        ) : null}
        <ConnectedDrives
          data={mounts.data}
          loading={mounts.loading}
          reload={mounts.reload}
        />
        <FieldSeparator />
        <FieldSet data-setting-entry="bin-retention">
          <FieldLegend>Bin auto-delete</FieldLegend>
          <FieldDescription>
            Choose how long deleted files stay in Bin before they are
            permanently removed.
          </FieldDescription>
          {loading ? (
            <LoadingState size="sm">Loading…</LoadingState>
          ) : error ? (
            <FieldError>{error}</FieldError>
          ) : (
            <RadioGroup
              value={value}
              onValueChange={(v) => {
                if (v === '15' || v === '30' || v === 'never') {
                  void onChange(v);
                }
              }}
              disabled={saving}
              aria-label="Bin auto-delete"
            >
              {RETENTION_OPTIONS.map((option) => (
                <FieldLabel key={option.value} htmlFor={option.id}>
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldTitle>{option.title}</FieldTitle>
                      <FieldDescription>{option.description}</FieldDescription>
                    </FieldContent>
                    <RadioGroupItem value={option.value} id={option.id} />
                  </Field>
                </FieldLabel>
              ))}
            </RadioGroup>
          )}
        </FieldSet>
      </FieldGroup>
    </SettingsPage>
  );
}
