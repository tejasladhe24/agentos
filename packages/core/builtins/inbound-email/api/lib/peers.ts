import type { EventsClient, FilesClient } from './types';

export function createFilesClient(baseUrl: string): FilesClient {
  const root = baseUrl.replace(/\/+$/, '');
  return {
    async putBlob(key, data, orgId) {
      const res = await fetch(`${root}/blobs/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/octet-stream',
          'x-agentos-org-id': orgId,
        },
        body: data,
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(
          `files putBlob failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      const body = (await res.json()) as { key?: string; bytes?: number };
      return {
        key: typeof body.key === 'string' ? body.key : key,
        bytes: typeof body.bytes === 'number' ? body.bytes : data.byteLength,
      };
    },
  };
}

export function createEventsClient(baseUrl: string): EventsClient {
  const root = baseUrl.replace(/\/+$/, '');
  return {
    async publish(topic, payload) {
      const res = await fetch(`${root}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic, payload }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(
          `events publish failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      return (await res.json()) as { ok: true; event: { id?: string } };
    },
  };
}

/** In-memory idempotency for unit tests (or when cache-store is down). */
export function createMemoryIdempotencyStore(): {
  get: (key: string) => Promise<unknown | null>;
  set: (key: string, value: unknown, ttl?: number) => Promise<void>;
} {
  const map = new Map<string, unknown>();
  return {
    async get(key) {
      return map.has(key) ? (map.get(key) ?? null) : null;
    },
    async set(key, value) {
      map.set(key, value);
    },
  };
}
