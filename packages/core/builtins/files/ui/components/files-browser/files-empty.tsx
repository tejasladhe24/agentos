import { FolderIcon } from '@phosphor-icons/react';

import { formatBytes, type FilesSection } from '../../lib/files-types';

export function FilesEmpty({
  section,
  searchActive,
  maxFileSize,
}: {
  section: FilesSection;
  searchActive: boolean;
  maxFileSize?: number;
}) {
  const copy =
    section === 'bin'
      ? {
          title: 'Bin is empty',
          hint: 'Deleted files show up here until they are restored or auto-deleted.',
        }
      : section === 'storage'
        ? {
            title: 'No files yet',
            hint: 'Upload files to any mounted storage to see usage.',
          }
        : {
            title: searchActive
              ? 'No files match your search.'
              : 'This folder is empty.',
            hint: maxFileSize
              ? `Drop files here or use Upload (max ${formatBytes(maxFileSize)} each).`
              : 'Drop files here or use Upload.',
          };

  return (
    <div
      data-slot="files-empty"
      className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground"
    >
      <FolderIcon className="size-10 opacity-60" aria-hidden />
      <p>{copy.title}</p>
      <p className="text-xs">{copy.hint}</p>
    </div>
  );
}
