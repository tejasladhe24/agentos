import { useShellStore } from '@agentos/core/shell/lib';

/**
 * Resolves the active global right sheet extension id from an optional
 * override (tests / controlled hosts) or the shell store.
 */
export function useShellActiveRightSheet(
  override?: string | null,
): string | null {
  const storeActive = useShellStore((s) => s.activeRightSheet);
  return override !== undefined ? override : storeActive;
}
