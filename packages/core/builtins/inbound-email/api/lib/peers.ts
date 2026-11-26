import { eventsServiceHeaders } from '@agentos/core/api/events';
import { DEFAULT_MOUNT_ALIAS, toFileRef } from '@agentos/core/api/files-ref';

import type { EventsClient, FilesClient } from './types';

export function createFilesClient(baseUrl: string): FilesClient {
  const root = baseUrl.replace(/\/+$/, '');
  return {
    async putBlob(path, data, orgId) {
      const url = `${root}/blobs/${encodeURIComponent(path)}?mount=${DEFAULT_MOUNT_ALIAS}`;
      const res = await fetch(url, {
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
      const body = (await res.json()) as {
        key?: string;
        bytes?: number;
        ref?: string;
        mountId?: string;
      };
      const key = typeof body.key === 'string' ? body.key : path;
      return {
        key,
        bytes: typeof body.bytes === 'number' ? body.bytes : data.byteLength,
        ref: typeof body.ref === 'string' ? body.ref : toFileRef(key, orgId),
        ...(typeof body.mountId === 'string' ? { mountId: body.mountId } : {}),
      };
    },
  };
}

export function createEventsClient(baseUrl: string): EventsClient {
  const root = baseUrl.replace(/\/+$/, '');
  return {
    async publish(topic, payload, options) {
      const res = await fetch(`${root}/publish`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Service token authenticates us to events; the org header scopes
          // the event so only that tenant's subscribers receive it.
          ...eventsServiceHeaders(Bun.env, options?.orgId),
        },
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
