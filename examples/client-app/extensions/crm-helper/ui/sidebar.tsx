import { useState, type FormEvent } from 'react';
import { useHostApi, useHostNotifications } from '@agentos/core/client';
import { Button } from '@agentos/ui/components/button';
import { Input } from '@agentos/ui/components/input';
import { Label } from '@agentos/ui/components/label';

type ContactRow = {
  id: string;
  data: {
    name?: string;
    email?: string;
    company?: string;
    [key: string]: unknown;
  };
};

export default function Sidebar() {
  const api = useHostApi();
  const notifications = useHostNotifications();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ContactRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.fetch('/tools/search_contacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: query.trim() || undefined, limit: 50 }),
      });
      if (!res.ok) {
        let message = `Search failed (${res.status})`;
        try {
          const body = JSON.parse(res.body) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          /* ignore */
        }
        if (res.status === 401) {
          message = 'Sign in required to search contacts';
        } else if (res.status === 502) {
          message =
            'CRM API unreachable (502). Run: bun ./examples/client-app/extensions/crm-helper/api/server.ts';
        }
        setItems([]);
        setError(message);
        void notifications.show(message, 'error');
        setSearched(true);
        return;
      }
      const body = JSON.parse(res.body) as { items?: ContactRow[] };
      setItems(Array.isArray(body.items) ? body.items : []);
      setSearched(true);
    } catch (err) {
      setItems([]);
      const message = err instanceof Error ? err.message : 'Search failed';
      setError(message);
      void notifications.show(message, 'error');
      setSearched(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-crm-helper-sidebar className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">Contacts</h2>
        <p className="text-muted-foreground text-xs">
          Look up CRM contacts via db-store.
        </p>
      </div>

      <form className="flex flex-col gap-3" onSubmit={onSearch}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="crm-contact-q">Name, email, or company</Label>
          <Input
            id="crm-contact-q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ada"
            autoComplete="off"
          />
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? 'Searching…' : 'Search'}
        </Button>
      </form>

      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}

      {searched && !error ? (
        items.length === 0 ? (
          <p className="text-muted-foreground text-xs">No contacts found.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="border-border rounded-md border px-3 py-2 text-xs"
              >
                <div className="font-medium">
                  {String(item.data.name ?? item.id)}
                </div>
                {item.data.email ? (
                  <div className="text-muted-foreground">
                    {String(item.data.email)}
                  </div>
                ) : null}
                {item.data.company ? (
                  <div className="text-muted-foreground">
                    {String(item.data.company)}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
