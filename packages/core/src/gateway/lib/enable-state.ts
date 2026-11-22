import type { ScannedExtension } from '@agentos/core/vite/lib/types';

/** In-memory enable/disable map for customer extensions (gateway process). */
export type ExtensionEnableState = {
  /** Explicit overrides; missing keys default to enabled. */
  readonly enabledById: Map<string, boolean>;
  isEnabled(extension: ScannedExtension): boolean;
  setEnabled(extensionId: string, enabled: boolean): void;
};

/** True when the extension must stay enabled (driven builtins / non-toggleable). */
export function isLockedExtension(extension: ScannedExtension): boolean {
  return (
    extension.driven || extension.kind === 'builtin' || !extension.toggleable
  );
}

/** Create an empty enable map (defaults: all extensions enabled). */
export function createExtensionEnableState(): ExtensionEnableState {
  const enabledById = new Map<string, boolean>();

  return {
    enabledById,
    isEnabled(extension) {
      if (isLockedExtension(extension)) {
        return true;
      }
      const explicit = enabledById.get(extension.id);
      return explicit !== false;
    },
    setEnabled(extensionId, enabled) {
      enabledById.set(extensionId, enabled);
    },
  };
}

export type ApplyEnableResult =
  | { ok: true; id: string; enabled: boolean }
  | { ok: false; status: number; error: string };

/**
 * Apply enable/disable against shared gateway state.
 * Rejects disable when `driven: true` (and builtin / non-toggleable).
 */
export function applyExtensionEnable(
  extension: ScannedExtension,
  enabled: boolean,
  state: ExtensionEnableState,
): ApplyEnableResult {
  if (!enabled && isLockedExtension(extension)) {
    return {
      ok: false,
      status: 403,
      error: extension.driven
        ? `Cannot disable driven extension: ${extension.id}`
        : `Cannot disable ${extension.kind} extension: ${extension.id}`,
    };
  }

  if (isLockedExtension(extension)) {
    // Locked extensions stay enabled; ignore redundant enable=true.
    state.setEnabled(extension.id, true);
  } else {
    state.setEnabled(extension.id, enabled);
  }

  return {
    ok: true,
    id: extension.id,
    enabled: state.isEnabled(extension),
  };
}

/** Extract boolean `enabled` from a JSON body, or undefined if invalid. */
export function parseEnabledFlag(body: unknown): boolean | undefined {
  if (
    typeof body === 'object' &&
    body !== null &&
    'enabled' in body &&
    typeof (body as { enabled: unknown }).enabled === 'boolean'
  ) {
    return (body as { enabled: boolean }).enabled;
  }
  return undefined;
}
