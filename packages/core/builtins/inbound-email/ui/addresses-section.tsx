import { useEffect, useState } from 'react';
import { useHostApi, useHostNotifications } from '@agentos/core/client';
import { Button } from '@agentos/ui/components/button';
import { Input } from '@agentos/ui/components/input';
import { Label } from '@agentos/ui/components/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@agentos/ui/components/table';

import { parseErrorBody, type InboundAddress } from './email-types';

export function AddressesSection({ canProvision }: { canProvision: boolean }) {
  const api = useHostApi();
  const toast = useHostNotifications();
  const [addresses, setAddresses] = useState<InboundAddress[]>([]);
  const [health, setHealth] = useState<{
    provider?: string;
    backend?: string;
  } | null>(null);
  const [address, setAddress] = useState('');
  const [purpose, setPurpose] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    setError(null);
    const [listRes, healthRes] = await Promise.all([
      api.fetch('/addresses'),
      api.fetch('/health'),
    ]);
    setBusy(false);
    if (!listRes.ok) {
      setError(parseErrorBody(listRes.body, 'Failed to load addresses'));
      setAddresses([]);
    } else {
      const body = JSON.parse(listRes.body) as { addresses: InboundAddress[] };
      setAddresses(body.addresses ?? []);
    }
    if (healthRes.ok) {
      setHealth(
        JSON.parse(healthRes.body) as {
          provider?: string;
          backend?: string;
        },
      );
    }
  }

  async function onProvision(event: React.FormEvent) {
    event.preventDefault();
    if (!canProvision) return;
    setBusy(true);
    setError(null);
    const res = await api.fetch('/addresses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        address: address.trim(),
        purpose: purpose.trim() || undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(parseErrorBody(res.body, 'Provision failed'));
      return;
    }
    setAddress('');
    setPurpose('');
    await toast.show('Inbound address provisioned', 'success');
    await refresh();
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section className="flex flex-col gap-4" aria-label="Addresses">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Inbound addresses</h2>
          <p className="text-sm text-muted-foreground">
            Provision per-org receive addresses
            {health?.provider ? ` · provider ${health.provider}` : ''}
            {health?.backend ? ` · ${health.backend}` : ''}.
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

      {canProvision ? (
        <form
          className="flex max-w-lg flex-col gap-3 rounded-md border p-4"
          onSubmit={(e) => void onProvision(e)}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="addr">Address</Label>
            <Input
              id="addr"
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="coi@inbound.example.com"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="purpose">Purpose (optional)</Label>
            <Input
              id="purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="coi"
            />
          </div>
          <Button type="submit" disabled={busy}>
            Provision
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          Provisioning requires <code>email.send</code>.
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Address</TableHead>
            <TableHead>Purpose</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {addresses.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-muted-foreground">
                No addresses for this org.
              </TableCell>
            </TableRow>
          ) : (
            addresses.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">
                  {row.address}
                </TableCell>
                <TableCell>{row.purpose ?? '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(row.createdAt).toLocaleString()}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </section>
  );
}
