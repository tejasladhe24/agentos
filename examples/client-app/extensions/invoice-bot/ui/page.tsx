import { useEffect, useState } from 'react';
import { useHostApi, useHostNotifications } from '@agentos/core/client';
import { Badge } from '@agentos/ui/components/badge';
import { Button } from '@agentos/ui/components/button';
import { LoadingState } from '@agentos/ui/components/loading-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@agentos/ui/components/table';

type InvoiceRow = {
  id: string;
  data: {
    vendor?: string;
    amount?: number;
    currency?: string;
    dueDate?: string;
    status?: string;
    approvalId?: string;
    [key: string]: unknown;
  };
  createdAt?: string;
  updatedAt?: string;
};

function statusVariant(
  status: string | undefined,
): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case 'pending_approval':
      return 'secondary';
    case 'parsed':
      return 'outline';
    case 'rejected':
      return 'destructive';
    default:
      return 'default';
  }
}

function formatAmount(amount: unknown, currency: unknown): string {
  const n = typeof amount === 'number' ? amount : Number(amount);
  const code = typeof currency === 'string' && currency ? currency : 'USD';
  if (!Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
    }).format(n);
  } catch {
    return `${code} ${n}`;
  }
}

export default function Page() {
  const api = useHostApi();
  const notifications = useHostNotifications();
  const [items, setItems] = useState<InvoiceRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.fetch('/invoices?limit=50', { method: 'GET' });
      if (!res.ok) {
        let message = `Failed to load invoices (${res.status})`;
        try {
          const body = JSON.parse(res.body) as {
            error?: string;
            detail?: { error?: string };
          };
          if (body.error) message = body.error;
          else if (body.detail?.error) message = body.detail.error;
        } catch {
          /* ignore */
        }
        if (res.status === 401) {
          message =
            'Sign in required to view invoices (demo: admin@example.com / password123)';
        } else if (res.status === 502) {
          message =
            'Invoice API unreachable (502). Restart `bun dev` (starts invoice-bot on 6102) or see services/invoice-bot/README.md.';
        } else if (res.status === 503) {
          message =
            'Auth/db-store unreachable from invoice-bot. Set AGENT_OS_AUTH_API_BASE=http://127.0.0.1:6110 (and DB/HITL bases) when starting uvicorn.';
        }
        setItems([]);
        setError(message);
        void notifications.show(message, 'error');
        return;
      }
      const body = JSON.parse(res.body) as { items?: InvoiceRow[] };
      setItems(Array.isArray(body.items) ? body.items : []);
    } catch (err) {
      setItems([]);
      const message =
        err instanceof Error ? err.message : 'Failed to load invoices';
      setError(message);
      void notifications.show(message, 'error');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div data-invoice-bot-page className="flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-sm font-semibold tracking-tight">Invoices</h1>
          <p className="text-muted-foreground text-xs">
            Parsed invoices from db-store via the Python invoice-bot service.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void load()}
        >
          {busy ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}

      {busy && items.length === 0 ? (
        <LoadingState data-slot="invoice-bot-loading">
          Loading invoices…
        </LoadingState>
      ) : null}

      {!error && !busy && items.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No invoices yet. Ask the agent to parse an invoice, or call{' '}
          <code className="text-foreground">parse_invoice</code>.
        </p>
      ) : null}

      {items.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vendor</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Id</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">
                  {String(item.data.vendor ?? '—')}
                </TableCell>
                <TableCell>
                  {formatAmount(item.data.amount, item.data.currency)}
                </TableCell>
                <TableCell>{String(item.data.dueDate ?? '—')}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(item.data.status)}>
                    {String(item.data.status ?? 'unknown')}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground font-mono text-[11px]">
                  {item.id}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}
