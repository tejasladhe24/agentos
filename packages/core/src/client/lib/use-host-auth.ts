import type { HostAPIClient } from '@agentos/core/sdk';
import { useHost } from './use-host';

/** Host authorization checks (`auth.can(permission)`). */
export function useHostAuth(): HostAPIClient['auth'] {
  return useHost().auth;
}
