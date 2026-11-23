import { useEffect, useState } from 'react';
import { useHostApi } from '@agentos/core/client';
import { Badge } from '@agentos/ui/components/badge';
import { Button } from '@agentos/ui/components/button';
import { Input } from '@agentos/ui/components/input';
import { ScrollArea } from '@agentos/ui/components/scroll-area';
import { Separator } from '@agentos/ui/components/separator';

import {
  filesBlobUrl,
  parseErrorBody,
  type InboundMessage,
} from './email-types';

export function InboxSection() {
  const api = useHostApi();
  const [messages, setMessages] = useState<InboundMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InboundMessage | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHtml, setShowHtml] = useState(false);

  async function refresh() {
    setBusy(true);
    setError(null);
    const params = new URLSearchParams({ limit: '50' });
    if (query.trim()) params.set('q', query.trim());
    const res = await api.fetch(`/messages?${params.toString()}`);
    setBusy(false);
    if (!res.ok) {
      setError(parseErrorBody(res.body, 'Failed to load inbox'));
      setMessages([]);
      return;
    }
    const body = JSON.parse(res.body) as { messages: InboundMessage[] };
    setMessages(body.messages ?? []);
  }

  async function openMessage(id: string) {
    setSelectedId(id);
    setShowHtml(false);
    const res = await api.fetch(`/messages/${encodeURIComponent(id)}`);
    if (!res.ok) {
      setError(parseErrorBody(res.body, 'Failed to load message'));
      setDetail(null);
      return;
    }
    const body = JSON.parse(res.body) as { message: InboundMessage };
    setDetail(body.message);
    if (!body.message.readAt) {
      void api.fetch(`/messages/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ read: true }),
      });
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4" aria-label="Inbox">
      <header className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <label htmlFor="inbox-q" className="text-xs text-muted-foreground">
            Search
          </label>
          <Input
            id="inbox-q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="From, subject…"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void refresh();
            }}
          />
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

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,14rem)_1fr]">
        <ScrollArea className="h-[min(28rem,60vh)] rounded-md border">
          <ul className="flex flex-col p-1">
            {messages.length === 0 && !busy ? (
              <li className="px-3 py-6 text-sm text-muted-foreground">
                No inbound messages yet. Send a fixture webhook or wait for
                Mailgun.
              </li>
            ) : null}
            {messages.map((m) => (
              <li key={m.id}>
                <Button
                  type="button"
                  variant={selectedId === m.id ? 'secondary' : 'ghost'}
                  className="h-auto w-full flex-col items-start gap-0.5 px-3 py-2 text-left"
                  onClick={() => void openMessage(m.id)}
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {m.subject || '(no subject)'}
                    </span>
                    {!m.readAt ? (
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        new
                      </Badge>
                    ) : null}
                  </span>
                  <span className="w-full truncate text-xs text-muted-foreground">
                    {m.from} · {m.attachments.length} att.
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </ScrollArea>

        <div className="min-h-0 rounded-md border p-4">
          {!detail ? (
            <p className="text-sm text-muted-foreground">
              Select a message to read.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <h2 className="text-base font-semibold">
                  {detail.subject || '(no subject)'}
                </h2>
                <p className="text-xs text-muted-foreground">
                  From {detail.from} → {detail.to.join(', ')} ·{' '}
                  {new Date(detail.receivedAt).toLocaleString()}
                </p>
              </div>
              <Separator />
              {detail.html ? (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={!showHtml ? 'secondary' : 'ghost'}
                    onClick={() => setShowHtml(false)}
                  >
                    Plain text
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={showHtml ? 'secondary' : 'ghost'}
                    onClick={() => setShowHtml(true)}
                  >
                    HTML
                  </Button>
                </div>
              ) : null}
              {showHtml && detail.html ? (
                <iframe
                  title="Email HTML body"
                  sandbox=""
                  srcDoc={detail.html}
                  className="h-64 w-full rounded-md border bg-background"
                />
              ) : (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm">
                  {detail.text || '(no text body)'}
                </pre>
              )}
              {detail.attachments.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">Attachments</h3>
                  <ul className="flex flex-col gap-1">
                    {detail.attachments.map((att) => (
                      <li key={att.key}>
                        <a
                          className="text-sm text-primary underline-offset-2 hover:underline"
                          href={filesBlobUrl(att.key)}
                          download={att.filename}
                        >
                          {att.filename} ({att.bytes} bytes)
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
