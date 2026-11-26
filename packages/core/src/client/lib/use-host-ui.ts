import type { HostAPIClient } from '@agentos/core/sdk';
import { useHost } from './use-host';

/** Shell UI controls exposed to extension iframes (e.g. right sidebar). */
export function useHostUi(): HostAPIClient['ui'] {
  return useHost().ui;
}
