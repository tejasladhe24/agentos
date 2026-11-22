/**
 * Durable extension enable-state via builtin db-store (ticket 60).
 * Gateway talks HTTP only — never SQL (ADR 004).
 */

import { dbStore, type CollectionClient } from '@agentos/core/api/store';

import type { ExtensionEnableState } from './enable-state';
import { gatewayKeys } from './env';

/** Platform collection for gateway control-plane docs. */
export const ENABLE_STATE_COLLECTION = 'agentos_gateway';

/** Single document holding customer enable overrides. */
export const ENABLE_STATE_DOC_ID = 'extension-enable';

/** Explicit enable overrides; missing keys default to enabled. */
export type EnableOverrides = Record<string, boolean>;

/** Load/save contract used by the gateway enable handlers. */
export type EnableStatePersister = {
  load(): Promise<EnableOverrides>;
  save(overrides: EnableOverrides): Promise<void>;
};

/** Parse `data.enabledById` from a db-store document (tolerant). */
export function parseEnableOverrides(data: unknown): EnableOverrides {
  if (typeof data !== 'object' || data === null) {
    return {};
  }
  const raw = (data as { enabledById?: unknown }).enabledById;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {};
  }
  const out: EnableOverrides = {};
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value === 'boolean') {
      out[id] = value;
    }
  }
  return out;
}

/** Serialize an in-memory Map to a plain override record. */
export function serializeEnableOverrides(
  enabledById: Map<string, boolean>,
): EnableOverrides {
  const out: EnableOverrides = {};
  for (const [id, enabled] of enabledById) {
    out[id] = enabled;
  }
  return out;
}

/** Copy overrides into the Map (does not clear unspecified keys). */
export function applyEnableOverrides(
  state: ExtensionEnableState,
  overrides: EnableOverrides,
): void {
  for (const [id, enabled] of Object.entries(overrides)) {
    state.setEnabled(id, enabled);
  }
}

/**
 * Create a persister backed by db-store HTTP.
 * Uses {@link gatewayKeys} peer base by default (`AGENT_OS_DB_STORE_API_BASE`).
 */
export function createDbStoreEnableStatePersister(
  collection: CollectionClient = dbStore.collection(ENABLE_STATE_COLLECTION, {
    apiBase: gatewayKeys().AGENT_OS_DB_STORE_API_BASE,
  }),
): EnableStatePersister {
  return {
    async load() {
      // `where` filters document `data`, not row id — find by DocumentRow.id.
      const { items } = await collection.query({});
      const doc = items.find((item) => item.id === ENABLE_STATE_DOC_ID);
      if (!doc) {
        return {};
      }
      return parseEnableOverrides(doc.data);
    },

    async save(overrides) {
      const data = { enabledById: overrides };
      const { items } = await collection.query({});
      const exists = items.some((item) => item.id === ENABLE_STATE_DOC_ID);
      if (exists) {
        await collection.update({
          id: ENABLE_STATE_DOC_ID,
          data,
          merge: false,
        });
        return;
      }
      await collection.insert({ id: ENABLE_STATE_DOC_ID, data });
    },
  };
}

/** In-memory persister for unit tests (survives across state instances). */
export function createMemoryEnableStatePersister(
  initial: EnableOverrides = {},
): EnableStatePersister & { snapshot: () => EnableOverrides } {
  let stored: EnableOverrides = { ...initial };
  return {
    async load() {
      return { ...stored };
    },
    async save(overrides) {
      stored = { ...overrides };
    },
    snapshot() {
      return { ...stored };
    },
  };
}

/**
 * Load overrides from the persister into `state`.
 * On failure: leave state unchanged and warn (fail open → all enabled).
 */
export async function hydrateExtensionEnableState(
  state: ExtensionEnableState,
  persister: EnableStatePersister,
): Promise<void> {
  try {
    const overrides = await persister.load();
    applyEnableOverrides(state, overrides);
  } catch (err) {
    console.warn(
      '[agentos] enable-state hydrate failed; defaults (all enabled):',
      err,
    );
  }
}

/** Persist the current Map via the persister (throws on failure). */
export async function persistExtensionEnableState(
  state: ExtensionEnableState,
  persister: EnableStatePersister,
): Promise<void> {
  await persister.save(serializeEnableOverrides(state.enabledById));
}

const HYDRATE_ATTEMPTS = 8;
const HYDRATE_DELAY_MS = 250;

/**
 * Retry hydrate until db-store is reachable (or attempts exhausted).
 * @returns `true` when load succeeded (safe to enable write-through).
 */
export async function hydrateExtensionEnableStateWithRetry(
  state: ExtensionEnableState,
  persister: EnableStatePersister,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<boolean> {
  const attempts = options.attempts ?? HYDRATE_ATTEMPTS;
  const delayMs = options.delayMs ?? HYDRATE_DELAY_MS;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const overrides = await persister.load();
      applyEnableOverrides(state, overrides);
      return true;
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        await Bun.sleep(delayMs);
      }
    }
  }
  console.warn(
    '[agentos] enable-state hydrate failed after retries; defaults (all enabled):',
    lastError,
  );
  return false;
}

/**
 * Wrap a persister so `save` is a no-op until `arm()` (after successful hydrate).
 * Avoids 502 toggles when db-store is not running (Vite unit tests / early boot).
 */
export function createArmableEnableStatePersister(
  inner: EnableStatePersister,
): EnableStatePersister & { arm: () => void; isArmed: () => boolean } {
  let armed = false;
  return {
    arm() {
      armed = true;
    },
    isArmed() {
      return armed;
    },
    load() {
      return inner.load();
    },
    async save(overrides) {
      if (!armed) return;
      await inner.save(overrides);
    },
  };
}
