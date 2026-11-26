import { useHostSharedState } from '@agentos/core/client';

import { FILES_MOUNT_STORAGE_KEY, FILES_MOUNT_TOPIC } from './files-types';

/** `''` = nothing chosen yet → callers fall back to the org default mount. */
function parseMountId(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Selected mount shared across Files page + sidebar iframes (browse root).
 * Persists via host storage; live-syncs over the Shell event bus.
 */
export function useFilesMount(): [string, (mountId: string) => Promise<void>] {
  return useHostSharedState<string>(FILES_MOUNT_STORAGE_KEY, '', {
    topic: FILES_MOUNT_TOPIC,
    parse: parseMountId,
  });
}
