import { useEffect, useState } from 'react';
import { useHostApi, useHostNotifications } from '@agentos/core/client';
import { Label } from '@agentos/ui/components/label';
import { RadioGroup, RadioGroupItem } from '@agentos/ui/components/radio-group';
import { LoadingState } from '@agentos/ui/components/loading-state';

type RetentionValue = '15' | '30' | 'never';

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
 * Files prefs inside the platform Settings page (bin auto-delete retention).
 */
export function FilesSettingsSection() {
  const api = useHostApi();
  const notifications = useHostNotifications();
  const [value, setValue] = useState<RetentionValue>('30');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      const res = await api.fetch('/api/ext/files/org-settings');
      if (cancelled) return;
      if (!res.ok) {
        setError('Could not load Files settings.');
        setLoading(false);
        return;
      }
      try {
        const data = JSON.parse(res.body) as {
          binRetentionDays?: number | null;
        };
        setValue(toValue(data.binRetentionDays));
      } catch {
        setError('Invalid Files settings response.');
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function onChange(next: RetentionValue) {
    setValue(next);
    setSaving(true);
    const res = await api.fetch('/api/ext/files/org-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ binRetentionDays: fromValue(next) }),
    });
    setSaving(false);
    if (!res.ok) {
      await notifications.show('Failed to save Files settings', 'error');
      return;
    }
    await notifications.show('Files settings saved', 'info');
  }

  return (
    <section
      data-slot="settings-files"
      className="flex max-w-xl flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold tracking-tight">Files</h2>
        <p className="text-sm text-muted-foreground">
          Choose how long deleted files stay in Bin before they are permanently
          removed.
        </p>
      </div>
      {loading ? (
        <LoadingState size="sm">Loading…</LoadingState>
      ) : error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : (
        <RadioGroup
          value={value}
          onValueChange={(v) => {
            if (v === '15' || v === '30' || v === 'never') {
              void onChange(v);
            }
          }}
          disabled={saving}
          className="gap-3"
          aria-label="Bin auto-delete"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="15" id="files-retention-15" />
            <Label htmlFor="files-retention-15">15 days</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="30" id="files-retention-30" />
            <Label htmlFor="files-retention-30">30 days</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="never" id="files-retention-never" />
            <Label htmlFor="files-retention-never">Don&apos;t delete</Label>
          </div>
        </RadioGroup>
      )}
    </section>
  );
}
