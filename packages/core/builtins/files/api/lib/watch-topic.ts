import { resolveExtApiBase } from '@agentos/core/api/http';

export type WatchTopicOptions = {
  env?: Record<string, string | undefined>;
  eventsApiBase?: string;
  signal?: AbortSignal;
  reconnectMs?: number;
};

/**
 * Follow one topic over the events SSE stream (fan-out, unlike the shared
 * outbox queue). Reconnects with a fixed delay until `signal` aborts.
 */
export function watchTopic(
  topic: string,
  onPayload: (payload: unknown) => Promise<void> | void,
  options: WatchTopicOptions = {},
): void {
  const base = (
    options.eventsApiBase ??
    resolveExtApiBase('events', 'AGENT_OS_EVENTS_API_BASE', options.env)
  ).replace(/\/+$/, '');
  const url = `${base}/subscribe?topic=${encodeURIComponent(topic)}`;
  const reconnectMs = options.reconnectMs ?? 5_000;

  const run = async (): Promise<void> => {
    while (!options.signal?.aborted) {
      try {
        const res = await fetch(url, { signal: options.signal });
        if (res.ok && res.body) {
          const decoder = new TextDecoder();
          const reader = res.body.getReader();
          let buffer = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              for (const line of frame.split('\n')) {
                if (!line.startsWith('data:')) continue;
                try {
                  const msg = JSON.parse(line.slice(5).trim()) as {
                    topic?: string;
                    payload?: unknown;
                  };
                  if (msg.topic === topic) await onPayload(msg.payload);
                } catch {
                  // ignore malformed frames / handler errors
                }
              }
            }
          }
        }
      } catch {
        // reconnect below
      }
      if (options.signal?.aborted) return;
      await Bun.sleep(reconnectMs);
    }
  };
  void run();
}
