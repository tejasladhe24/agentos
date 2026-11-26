import { useShellStore } from '@agentos/core/shell/lib';

/**
 * Resolves right sidebar open state from an optional override or the store.
 */
export function useShellRightSidebarOpen(override?: boolean): boolean {
  const storeOpen = useShellStore((s) => s.rightSidebarOpen);
  return override ?? storeOpen;
}
