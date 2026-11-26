import { useHostSharedState } from '@agentos/core/client';

import { FILES_PREFIX_STORAGE_KEY, FILES_PREFIX_TOPIC } from './files-types';

function parsePrefix(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Shared browse prefix across Files page + sidebar iframes.
 * Persists via host storage; live-syncs over the Shell event bus.
 */
export function useFilesPrefix(): [string, (prefix: string) => Promise<void>] {
  return useHostSharedState<string>(FILES_PREFIX_STORAGE_KEY, '', {
    topic: FILES_PREFIX_TOPIC,
    parse: parsePrefix,
  });
}
