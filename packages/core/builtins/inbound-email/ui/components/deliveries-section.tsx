import { useEffect, useState } from 'react';
import {
  parseHostJson,
  extensionPath,
  useHostApi,
  useHostNotifications,
} from '@agentos/core/client';
import { Badge } from '@agentos/ui/components/badge';
import { Button } from '@agentos/ui/components/button';
import { ScrollArea } from '@agentos/ui/components/scroll-area';
import { Separator } from '@agentos/ui/components/separator';

import { deliverySourceLabel, type DeliveryEntry } from '../lib/email-types';

function statusVariant(
  status: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'sent') return 'secondary';
  if (status === 'failed') return 'destructive';
  return 'outline';
}

export function DeliveriesSection() {
  const api = useHostApi();
  const notifications = useHostNotifications();
  const [items, setItems] = useState<DeliveryEntry[]>([]);
  const [selected, setSelected] = useState<DeliveryEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    setError(null);
    const result = parseHostJson<{ notifications?: DeliveryEntry[] }>(
      await api.fetch(
        extensionPath('notifications', '/deliveries?channel=email&limit=50'),
      ),
      'Failed to load deliveries',
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      void notifications.show(result.error, 'error');
      setItems([]);
      return;
    }
    setItems(result.data.notifications ?? []);
  }

  async function openDelivery(id: string) {
    const result = parseHostJson<{ notification: DeliveryEntry }>(
      await api.fetch(
        extensionPath('notifications', `/deliveries/${encodeURIComponent(id)}`),
      ),
      'Failed to load delivery',
    );
    if (!result.ok) {
      setError(result.error);
      void notifications.show(result.error, 'error');
      return;
    }
    setSelected(result.data.notification);
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-4"
      aria-label="Deliveries"
    >
      <header className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Sent / deliveries</h2>
          <p className="text-sm text-muted-foreground">
            Recent email deliveries for the active org.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void refresh()}
          disabled={busy}
        >
          Refresh
        </Button>
      </header>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,16rem)_1fr]">
        <ScrollArea className="h-[min(28rem,60vh)] rounded-md border">
          <ul className="flex flex-col p-1">
            {items.length === 0 && !busy ? (
              <li className="px-3 py-6 text-sm text-muted-foreground">
                No email deliveries yet. Use Compose to send one.
              </li>
            ) : null}
            {items.map((item) => (
              <li key={item.id}>
                <Button
                  type="button"
                  variant={selected?.id === item.id ? 'secondary' : 'ghost'}
                  className="h-auto w-full flex-col items-start gap-0.5 px-3 py-2 text-left"
                  onClick={() => void openDelivery(item.id)}
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {item.subject || item.message.slice(0, 40)}
                    </span>
                    <Badge
                      variant={statusVariant(item.status)}
                      className="shrink-0 text-[10px]"
                    >
                      {item.status}
                    </Badge>
                  </span>
                  <span className="w-full truncate text-xs text-muted-foreground">
                    {item.to ?? '—'} · {new Date(item.at).toLocaleString()}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </ScrollArea>

        <div className="rounded-md border p-4">
          {!selected ? (
            <p className="text-sm text-muted-foreground">
              Select a delivery for details.
            </p>
          ) : (
            <div className="flex flex-col gap-3 text-sm">
              <div>
                <h3 className="font-semibold">
                  {selected.subject || '(no subject)'}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {selected.id} · {selected.status}
                  {selected.provider ? ` · ${selected.provider}` : ''}
                </p>
              </div>
              <Separator />
              <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-sm">
                <dt className="text-muted-foreground">To</dt>
                <dd>{selected.to ?? '—'}</dd>
                {deliverySourceLabel(selected.source) ? (
                  <>
                    <dt className="text-muted-foreground">Sent via</dt>
                    <dd data-slot="delivery-source">
                      {deliverySourceLabel(selected.source)}
                      {selected.provider ? ` (${selected.provider})` : ''}
                    </dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">At</dt>
                <dd>{new Date(selected.at).toLocaleString()}</dd>
                {selected.sentAt ? (
                  <>
                    <dt className="text-muted-foreground">Sent</dt>
                    <dd>{new Date(selected.sentAt).toLocaleString()}</dd>
                  </>
                ) : null}
                {selected.templateId ? (
                  <>
                    <dt className="text-muted-foreground">Template</dt>
                    <dd>{selected.templateId}</dd>
                  </>
                ) : null}
                {selected.error ? (
                  <>
                    <dt className="text-muted-foreground">Error</dt>
                    <dd className="text-destructive">{selected.error}</dd>
                  </>
                ) : null}
              </dl>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm">
                {selected.message}
              </pre>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
