import { useCallback, useRef, useState } from 'react';
import { CloudArrowUpIcon } from '@phosphor-icons/react';
import { Button } from '@agentos/ui/components/button';
import { cn } from '@agentos/ui/lib/utils';

import type { UploadProgressItem } from './files-types';

export type FilesUploadZoneProps = {
  disabled?: boolean;
  progress: UploadProgressItem[];
  onUploadFiles: (files: File[]) => void | Promise<void>;
};

export function FilesUploadZone({
  disabled = false,
  progress,
  onUploadFiles,
}: FilesUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const pickFiles = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList?.length || disabled) return;
      void onUploadFiles(Array.from(fileList));
    },
    [disabled, onUploadFiles],
  );

  return (
    <section
      data-slot="files-upload-zone"
      className="flex flex-col gap-2"
      onDragEnter={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="sr-only"
        aria-label="Choose files to upload"
        disabled={disabled}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-4 text-center transition-colors',
          dragOver && 'border-primary bg-primary/5',
          disabled && 'opacity-50',
        )}
      >
        <CloudArrowUpIcon
          className="size-8 text-muted-foreground"
          aria-hidden
        />
        <p className="text-sm text-muted-foreground">
          Drag files here or use the picker to upload into the current folder.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={pickFiles}
        >
          Choose files
        </Button>
      </div>
      {progress.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs" aria-live="polite">
          {progress.map((item) => (
            <li
              key={item.id}
              className={cn(
                'flex items-center justify-between gap-2 rounded px-2 py-1',
                item.status === 'error' && 'text-destructive',
                item.status === 'done' && 'text-muted-foreground',
              )}
            >
              <span className="truncate">{item.name}</span>
              <span className="shrink-0 capitalize">{item.status}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
