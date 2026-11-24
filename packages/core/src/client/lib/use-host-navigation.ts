import type { HostAPIClient } from '@agentos/core/sdk';
import { useHost } from './use-host';

/** Open external URLs (new tab, or the Shell tab for OAuth consent). */
export function useHostNavigation(): HostAPIClient['navigation'] {
  return useHost().navigation;
}
