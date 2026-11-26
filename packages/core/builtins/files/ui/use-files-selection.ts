import { useHostSharedState } from '@agentos/core/client';

import {
  FILES_SELECTION_STORAGE_KEY,
  FILES_SELECTION_TOPIC,
  type FilesListItem,
} from './files-types';

function parseSelection(value: unknown): FilesListItem[] {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as FilesListItem[]) : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? (value as FilesListItem[]) : [];
}

/**
 * Selected items shared across Files page + right-sidebar iframes.
 * Persists via host storage; live-syncs over the Shell event bus.
 */
export function useFilesSelection(): [
  FilesListItem[],
  (items: FilesListItem[]) => Promise<void>,
] {
  return useHostSharedState<FilesListItem[]>(FILES_SELECTION_STORAGE_KEY, [], {
    topic: FILES_SELECTION_TOPIC,
    parse: parseSelection,
  });
}
