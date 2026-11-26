import { useHostSharedState } from '@agentos/core/client';

import {
  FILES_SECTION_STORAGE_KEY,
  FILES_SECTION_TOPIC,
  type FilesSection,
} from './files-types';

function parseSection(value: unknown): FilesSection {
  if (value === 'bin' || value === 'storage' || value === 'files') return value;
  return 'files';
}

/**
 * Shared Files nav section (My Files / Bin / Storage) across page + sidebar.
 */
export function useFilesSection(): [
  FilesSection,
  (section: FilesSection) => Promise<void>,
] {
  return useHostSharedState<FilesSection>(FILES_SECTION_STORAGE_KEY, 'files', {
    topic: FILES_SECTION_TOPIC,
    parse: parseSection,
  });
}
